import { describe, expect, it } from "vitest";
import { setup, validLead } from "./helpers";

async function seedLeads(agent: ReturnType<typeof setup>["agent"]) {
  const a = (await agent.post("/api/leads").send(validLead())).body;
  const b = (await agent.post("/api/leads").send(validLead({ establishment_name: "Academia Fictícia", segment: "Academia", whatsapp: "11 90000-2222" }))).body;
  return [a, b];
}

describe("campanhas", () => {
  it("cria campanha com leads selecionados", async () => {
    const { agent } = setup();
    const [a, b] = await seedLeads(agent);
    const res = await agent.post("/api/campaigns").send({ name: "Campanha A", description: "Desc", message_template: "Olá, {{nome_estabelecimento}} de {{cidade}}!", message_template_2: "Mensagem dois para {{cidade}}", message_template_3: "Mensagem três para {{cidade}}", lead_ids: [a.id, b.id], status: "ready" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Campanha A", status: "ready", lead_count: 2, contacted_count: 0, opened_count: 0, created_by_name: "Thomaz" });
  });

  it("recusa variáveis desconhecidas na mensagem", async () => {
    const { agent } = setup();
    const res = await agent.post("/api/campaigns").send({ name: "Campanha B", message_template: "Olá {{nome}} {{cidade}}", message_template_2: "Mensagem dois para {{cidade}}", message_template_3: "Mensagem três para {{cidade}}" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("{{nome}}");
  });

  it("não deixa 'pronta para iniciar' sem leads", async () => {
    const { agent } = setup();
    const res = await agent.post("/api/campaigns").send({ name: "Vazia", message_template: "Olá {{cidade}}", message_template_2: "Mensagem dois para {{cidade}}", message_template_3: "Mensagem três para {{cidade}}", status: "ready" });
    expect(res.status).toBe(400);
  });

  it("seleciona leads por filtro (segmento)", async () => {
    const { agent } = setup();
    await seedLeads(agent);
    const res = await agent.post("/api/campaigns").send({ name: "Academias", message_template: "Olá {{segmento}}", message_template_2: "Mensagem dois para {{cidade}}", message_template_3: "Mensagem três para {{cidade}}", lead_filter: { segment: "Academia" } });
    expect(res.body.lead_count).toBe(1);
  });

  it("controla transições: iniciar, pausar, continuar, concluir; edição somente quando permitido", async () => {
    const { agent } = setup();
    const [a] = await seedLeads(agent);
    const c = (await agent.post("/api/campaigns").send({ name: "Fluxo", message_template: "Olá {{cidade}}", message_template_2: "Mensagem dois para {{cidade}}", message_template_3: "Mensagem três para {{cidade}}", lead_ids: [a.id] })).body;
    expect((await agent.post(`/api/campaigns/${c.id}/status`).send({ status: "in_progress" })).body.status).toBe("in_progress");
    const edit = await agent.put(`/api/campaigns/${c.id}`).send({ name: "Novo", message_template: "Oi {{cidade}}", message_template_2: "Mensagem dois para {{cidade}}", message_template_3: "Mensagem três para {{cidade}}" });
    expect(edit.status).toBe(409);
    expect((await agent.post(`/api/campaigns/${c.id}/status`).send({ status: "paused" })).body.status).toBe("paused");
    const editPaused = await agent.put(`/api/campaigns/${c.id}`).send({ name: "Novo nome", message_template: "Oi {{cidade}}", message_template_2: "Mensagem dois para {{cidade}}", message_template_3: "Mensagem três para {{cidade}}" });
    expect(editPaused.status).toBe(200);
    expect(editPaused.body).toMatchObject({ name: "Novo nome", status: "paused" });
    expect((await agent.post(`/api/campaigns/${c.id}/status`).send({ status: "in_progress" })).body.status).toBe("in_progress");
    expect((await agent.post(`/api/campaigns/${c.id}/status`).send({ status: "completed" })).body.status).toBe("completed");
    expect((await agent.post(`/api/campaigns/${c.id}/status`).send({ status: "in_progress" })).status).toBe(409);
    expect((await agent.post(`/api/campaigns/${c.id}/leads`).send({ lead_ids: [a.id] })).status).toBe(409);
  });

  it("não inicia campanha sem leads", async () => {
    const { agent } = setup();
    const c = (await agent.post("/api/campaigns").send({ name: "Sem leads", message_template: "Olá {{cidade}}", message_template_2: "Mensagem dois para {{cidade}}", message_template_3: "Mensagem três para {{cidade}}" })).body;
    expect((await agent.post(`/api/campaigns/${c.id}/status`).send({ status: "in_progress" })).status).toBe(400);
  });

  it("duplica campanha com leads zerados (inclusão não é contato)", async () => {
    const { agent } = setup();
    const [a, b] = await seedLeads(agent);
    const c = (await agent.post("/api/campaigns").send({ name: "Original", message_template: "Olá {{cidade}}", message_template_2: "Mensagem dois para {{cidade}}", message_template_3: "Mensagem três para {{cidade}}", lead_ids: [a.id, b.id] })).body;
    await agent.post(`/api/campaigns/${c.id}/status`).send({ status: "in_progress" });
    await agent.post(`/api/leads/${a.id}/contact-status`).send({ status: "interested", campaign_id: c.id }).expect(200);
    const copy = (await agent.post(`/api/campaigns/${c.id}/duplicate`)).body;
    expect(copy).toMatchObject({ name: "Original (cópia)", status: "draft", lead_count: 2, contacted_count: 0, interested_count: 0 });
    const original = (await agent.get(`/api/campaigns/${c.id}`)).body;
    expect(original).toMatchObject({ contacted_count: 1, interested_count: 1 });
  });

  it("lista leads da campanha com filtro por status do contato e resultados", async () => {
    const { agent } = setup();
    const [a, b] = await seedLeads(agent);
    const c = (await agent.post("/api/campaigns").send({ name: "Lista", message_template: "Olá {{cidade}}", message_template_2: "Mensagem dois para {{cidade}}", message_template_3: "Mensagem três para {{cidade}}", lead_ids: [a.id, b.id] })).body;
    await agent.post(`/api/campaigns/${c.id}/status`).send({ status: "in_progress" });
    await agent.post(`/api/leads/${b.id}/whatsapp-opened`).send({ campaign_id: c.id }).expect(200);
    const opened = (await agent.get(`/api/campaigns/${c.id}/leads?contact_status=whatsapp_opened`)).body;
    expect(opened.items.map((l: { id: number }) => l.id)).toEqual([b.id]);
    expect(opened.items[0]).toMatchObject({ campaign_contact_status: "whatsapp_opened", campaign_id: c.id });
    const notContacted = (await agent.get(`/api/campaigns/${c.id}/leads?contact_status=not_contacted`)).body;
    expect(notContacted.total).toBe(1);
    const results = (await agent.get(`/api/campaigns/${c.id}/results`)).body;
    expect(results.byStatus).toEqual(expect.arrayContaining([{ status: "whatsapp_opened", total: 1 }, { status: "not_contacted", total: 1 }]));
    // "WhatsApp aberto" does not count as contacted
    expect(results.campaign).toMatchObject({ opened_count: 1, contacted_count: 0 });
  });

  it("remove lead da campanha", async () => {
    const { agent } = setup();
    const [a] = await seedLeads(agent);
    const c = (await agent.post("/api/campaigns").send({ name: "Remover", message_template: "Olá {{cidade}}", message_template_2: "Mensagem dois para {{cidade}}", message_template_3: "Mensagem três para {{cidade}}", lead_ids: [a.id] })).body;
    await agent.delete(`/api/campaigns/${c.id}/leads/${a.id}`).expect(204);
    expect((await agent.get(`/api/campaigns/${c.id}`)).body.lead_count).toBe(0);
  });
});

describe("sem fila de mensagens", () => {
  it("não existe tabela, rota ou worker de envio de mensagens", async () => {
    const { agent, db } = setup();
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    expect(tables.filter((t) => /queue|outbox|message|dispatch|schedul|job/i.test(t))).toEqual([]);
    for (const path of ["/api/messages", "/api/messages/send", "/api/queue", "/api/campaigns/1/send", "/api/campaigns/1/dispatch"]) {
      expect((await agent.post(path).send({})).status).toBe(404);
    }
  });

  it("o dashboard usa dados reais", async () => {
    const { agent } = setup();
    const empty = (await agent.get("/api/dashboard")).body;
    expect(empty).toMatchObject({ total_leads: 0, contacted: 0, campaigns_in_progress: 0 });
    const [a] = await seedLeads(agent);
    const c = (await agent.post("/api/campaigns").send({ name: "Métricas", message_template: "Olá {{cidade}}", message_template_2: "Mensagem dois para {{cidade}}", message_template_3: "Mensagem três para {{cidade}}", lead_ids: [a.id] })).body;
    await agent.post(`/api/campaigns/${c.id}/status`).send({ status: "in_progress" });
    await agent.post(`/api/leads/${a.id}/contact-status`).send({ status: "partnership", campaign_id: c.id });
    const m = (await agent.get("/api/dashboard")).body;
    expect(m).toMatchObject({ total_leads: 2, total_prospects: 2, with_presence: 2, campaigns_in_progress: 1, contacted: 1, interested: 1, partnerships: 1 });
    expect(m.conversion_by_campaign[0]).toMatchObject({ name: "Métricas", total: 1, contacted: 1, partnerships: 1 });
  });
});
