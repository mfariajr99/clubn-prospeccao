import { describe, expect, it } from "vitest";
import { setup, validLead } from "./helpers";

describe("cadastro individual de lead", () => {
  it("cadastra e normaliza os dados", async () => {
    const { agent } = setup();
    const res = await agent.post("/api/leads").send(validLead());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      establishment_name: "Café Teste Fictício",
      city: "São Paulo",
      state: "SP",
      whatsapp: "5511900001234",
      digital_presence_url: "https://www.instagram.com/cafe.teste.ficticio/",
      digital_presence_type: "instagram",
      registration_status: "prospect",
      contact_status: "not_contacted",
      source: "manual",
      created_by: 1,
    });
    expect(res.body.links).toHaveLength(1);
  });

  it("valida campos obrigatórios com mensagens claras", async () => {
    const { agent, db } = setup();
    const res = await agent.post("/api/leads").send({ establishment_name: "", whatsapp: "", city: "", state: "" });
    expect(res.status).toBe(422);
    expect(res.body.details.fields).toMatchObject({
      establishment_name: expect.any(String),
      whatsapp: "WhatsApp não informado.",
      city: "Cidade não informada.",
      state: "Estado não informado.",
    });
    expect((db.prepare("SELECT COUNT(*) c FROM leads").get() as { c: number }).c).toBe(0);
  });

  it("rejeita WhatsApp inválido, estado desconhecido e URL perigosa", async () => {
    const { agent } = setup();
    const res = await agent.post("/api/leads").send(validLead({ whatsapp: "123", state: "Narnia", digital_presence_url: "javascript:alert(1)" }));
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.details.fields).sort()).toEqual(["digital_presence_url", "state", "whatsapp"]);
  });

  it("aceita link de plataforma desconhecida", async () => {
    const { agent } = setup();
    const res = await agent.post("/api/leads").send(validLead({ digital_presence_url: "https://perfil.plataforma-nova.example/abc" }));
    expect(res.status).toBe(201);
    expect(res.body.digital_presence_type).toBe("site");
  });

  it("impede WhatsApp duplicado e pede confirmação para possível duplicidade", async () => {
    const { agent } = setup();
    await agent.post("/api/leads").send(validLead()).expect(201);
    const samePhone = await agent.post("/api/leads").send(validLead({ establishment_name: "Outro Nome", whatsapp: "+55 11 90000-1234" }));
    expect(samePhone.status).toBe(409);
    const sameName = await agent.post("/api/leads").send(validLead({ whatsapp: "(11) 90000-9999" }));
    expect(sameName.status).toBe(409);
    expect(sameName.body.details.possible_duplicate).toBe(true);
    const confirmed = await agent.post("/api/leads").send({ ...validLead({ whatsapp: "(11) 90000-9999" }), allow_possible_duplicate: true });
    expect(confirmed.status).toBe(201);
  });

  it("edita um lead e corrige um WhatsApp inválido", async () => {
    const { agent, db } = setup();
    db.prepare(
      "INSERT INTO leads (establishment_name, name_key, city, state, whatsapp, whatsapp_valid, created_by) VALUES ('Legado', 'legado|x|SP', 'X', 'SP', '999', 0, 1)",
    ).run();
    const res = await agent.put("/api/leads/1").send(validLead({ establishment_name: "Legado", whatsapp: "11 90000-5555" }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ whatsapp: "5511900005555", whatsapp_valid: 1 });
  });
});

describe("evento WhatsApp aberto e status manual", () => {
  async function withCampaign(status = "in_progress") {
    const ctx = setup();
    const lead = (await ctx.agent.post("/api/leads").send(validLead())).body;
    const campaign = (await ctx.agent.post("/api/campaigns").send({ name: "Teste", message_template: "Olá {{nome_estabelecimento}}", message_template_2: "Mensagem dois para {{cidade}}", message_template_3: "Mensagem três para {{cidade}}", lead_ids: [lead.id], status: "ready" })).body;
    if (status === "in_progress") await ctx.agent.post(`/api/campaigns/${campaign.id}/status`).send({ status: "in_progress" }).expect(200);
    return { ...ctx, lead, campaign };
  }

  it("registra apenas 'WhatsApp aberto' e nunca 'Mensagem enviada'", async () => {
    const { agent, db, lead, campaign } = await withCampaign();
    const res = await agent.post(`/api/leads/${lead.id}/whatsapp-opened`).set("X-User-Id", "1").send({ campaign_id: campaign.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ previous: "not_contacted", current: "whatsapp_opened" });
    const cl = db.prepare("SELECT * FROM campaign_leads WHERE lead_id = ?").get(lead.id) as Record<string, unknown>;
    expect(cl.contact_status).toBe("whatsapp_opened");
    expect(cl.whatsapp_opened_at).toBeTruthy();
    const history = db.prepare("SELECT * FROM contact_history WHERE lead_id = ?").all(lead.id) as Record<string, unknown>[];
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ event_type: "whatsapp_opened", new_status: "whatsapp_opened", changed_by: 1, campaign_id: campaign.id });
    // Opening again never escalates to "message_sent".
    await agent.post(`/api/leads/${lead.id}/whatsapp-opened`).send({ campaign_id: campaign.id });
    const statuses = (db.prepare("SELECT new_status FROM contact_history").all() as { new_status: string }[]).map((r) => r.new_status);
    expect(statuses).not.toContain("message_sent");
    expect((db.prepare("SELECT contact_status FROM leads WHERE id = ?").get(lead.id) as { contact_status: string }).contact_status).toBe("whatsapp_opened");
  });

  it("não rebaixa status já avançados ao abrir o WhatsApp de novo", async () => {
    const { agent, db, lead, campaign } = await withCampaign();
    await agent.post(`/api/leads/${lead.id}/contact-status`).send({ status: "interested", campaign_id: campaign.id }).expect(200);
    const res = await agent.post(`/api/leads/${lead.id}/whatsapp-opened`).send({ campaign_id: campaign.id });
    expect(res.body.current).toBe("interested");
    expect((db.prepare("SELECT contact_status FROM campaign_leads").get() as { contact_status: string }).contact_status).toBe("interested");
  });

  it("exige campanha em andamento para registrar contato", async () => {
    const { agent, lead, campaign } = await withCampaign("ready");
    const res = await agent.post(`/api/leads/${lead.id}/whatsapp-opened`).send({ campaign_id: campaign.id });
    expect(res.status).toBe(409);
  });

  it("status manual registra anterior, novo, usuário, data, campanha e observação", async () => {
    const { agent, db, lead, campaign } = await withCampaign();
    db.prepare("INSERT INTO users (name, email) VALUES ('Bruno', 'bruno@x.local')").run();
    const res = await agent.post(`/api/leads/${lead.id}/contact-status`).set("X-User-Id", "4").send({ status: "message_sent", campaign_id: campaign.id, notes: "Enviei a proposta" });
    expect(res.status).toBe(200);
    const history = (await agent.get(`/api/leads/${lead.id}/history`)).body;
    expect(history[0]).toMatchObject({
      previous_status: "not_contacted",
      new_status: "message_sent",
      changed_by: 4,
      changed_by_name: "Bruno",
      campaign_id: campaign.id,
      campaign_name: "Teste",
      notes: "Enviei a proposta",
    });
    expect(history[0].changed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("rejeita status desconhecido", async () => {
    const { agent, lead } = await withCampaign();
    expect((await agent.post(`/api/leads/${lead.id}/contact-status`).send({ status: "sent_automatically" })).status).toBe(400);
  });
});

describe("consulta de leads", () => {
  it("filtra por segmento, cidade, estado, presença e busca", async () => {
    const { agent } = setup();
    await agent.post("/api/leads").send(validLead()).expect(201);
    await agent.post("/api/leads").send(validLead({ establishment_name: "Academia Beta", segment: "Academia", city: "Recife", state: "PE", whatsapp: "81 90000-1111", digital_presence_url: "" })).expect(201);
    await agent.post("/api/leads").send(validLead({ establishment_name: "Bistrô Gama", segment: "Restaurante", city: "Recife", state: "pe", whatsapp: "81 90000-2222", digital_presence_url: "https://gama.example.com" })).expect(201);
    const bySegment = (await agent.get("/api/leads?segment=academia")).body;
    expect(bySegment.items.map((l: { establishment_name: string }) => l.establishment_name)).toEqual(["Academia Beta"]);
    expect((await agent.get("/api/leads?city=Recife&state=PE")).body.total).toBe(2);
    expect((await agent.get("/api/leads?presence=without")).body.total).toBe(1);
    expect((await agent.get("/api/leads?presence=site")).body.total).toBe(1);
    expect((await agent.get("/api/leads?q=gama")).body.total).toBe(1);
    expect((await agent.get("/api/leads?q=900002222")).body.total).toBe(1);
    const page = (await agent.get("/api/leads?pageSize=2&page=2&sort=name&dir=asc")).body;
    expect(page).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(page.items[0].establishment_name).toBe("Café Teste Fictício");
  });

  it("avaliação manual: geral e por campanha coexistem; filtro e ordenação por potencial", async () => {
    const { agent } = setup();
    const a = (await agent.post("/api/leads").send(validLead())).body;
    const b = (await agent.post("/api/leads").send(validLead({ establishment_name: "Outro", whatsapp: "11 90000-3333" }))).body;
    const campaign = (await agent.post("/api/campaigns").send({ name: "Camp", message_template: "Olá {{cidade}}", message_template_2: "Mensagem dois para {{cidade}}", message_template_3: "Mensagem três para {{cidade}}", lead_ids: [a.id] })).body;
    const general = await agent.put(`/api/leads/${a.id}/evaluations`).send({
      potential_level: "high",
      score: 5,
      digital_presence_quality: "high",
      checklist_data: { active_profile: true, invented_key: true },
      notes: "Ótimo perfil",
    });
    expect(general.status).toBe(200);
    expect(general.body).toMatchObject({ potential_level: "high", score: 5, evaluator_user_id: 1, evaluator_name: "Thomaz", campaign_id: null });
    expect(general.body.checklist_data).toEqual({ active_profile: true });
    await agent.put(`/api/leads/${a.id}/evaluations`).send({ potential_level: "medium", score: 3, campaign_id: campaign.id }).expect(200);
    const evaluations = (await agent.get(`/api/leads/${a.id}/evaluations`)).body;
    expect(evaluations).toHaveLength(2);
    // updating the general one keeps a single general evaluation
    await agent.put(`/api/leads/${a.id}/evaluations`).send({ potential_level: "high", score: 4 }).expect(200);
    expect((await agent.get(`/api/leads/${a.id}/evaluations`)).body).toHaveLength(2);

    expect((await agent.get("/api/leads?potential=high")).body.items.map((l: { id: number }) => l.id)).toEqual([a.id]);
    expect((await agent.get("/api/leads?potential=none")).body.items.map((l: { id: number }) => l.id)).toEqual([b.id]);
    const sorted = (await agent.get("/api/leads?sort=potential&dir=desc")).body.items;
    expect(sorted[0].id).toBe(a.id);
    expect(sorted[0].potential_level).toBe("high");
    // invalid score
    expect((await agent.put(`/api/leads/${a.id}/evaluations`).send({ potential_level: "high", score: 9 })).status).toBe(400);
  });
});
