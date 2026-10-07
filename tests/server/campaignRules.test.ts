import { describe, expect, it } from "vitest";
import { brWeekRange, buildRuleView, describeRule, ruleCapacity } from "../../shared/campaignRule";
import { phoneVariants, storeWhatsAppMessage } from "../../server/services/inbox";
import { setup, validLead } from "./helpers";

const campaignBody = (extra: Record<string, unknown> = {}) => ({
  name: "Regra",
  message_template: "Mensagem um {{cidade}}",
  message_template_2: "Mensagem dois {{cidade}}",
  message_template_3: "Mensagem três {{cidade}}",
  status: "ready",
  ...extra,
});

async function leads(agent: ReturnType<typeof setup>["agent"], n: number) {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push((await agent.post("/api/leads").send(validLead({ establishment_name: `Lead ${i}`, whatsapp: `11 90000-${String(2000 + i)}` }))).body.id);
  return ids;
}

describe("regra de disparo por campanha", () => {
  it("calcula uso, vagas e próxima liberação", () => {
    const now = new Date("2026-10-07T15:00:00Z");
    const times = ["2026-10-07T10:00:00Z", "2026-10-07T11:00:00Z"];
    const v = buildRuleView({ send_limit: 2, send_window_hours: 6 }, times, now);
    expect(v).toMatchObject({ used: 2, remaining: 0, next_slot_at: "2026-10-07T16:00:00.000Z", phase: "open" });
    expect(v.blocked_reason).toContain("13:00"); // Brasília time
    expect(describeRule(30, 6)).toBe("Até 30 mensagens a cada 6 horas");
    expect(describeRule(90, 24)).toBe("Até 90 mensagens por dia");
    expect(ruleCapacity({ limit: 30, window_hours: 6, remaining: 10, next_slot_at: null }, now, new Date(now.getTime() + 24 * 3600_000))).toBe(130);
  });

  it("bloqueia o envio quando a regra da campanha é atingida (30 em 6h → exemplo com 2)", async () => {
    const { agent } = setup();
    const ids = await leads(agent, 3);
    const c = (await agent.post("/api/campaigns").send(campaignBody({ lead_ids: ids, send_limit: 2, send_window_hours: 6 }))).body;
    expect(c.rule).toMatchObject({ limit: 2, window_hours: 6, used: 0, remaining: 2 });
    await agent.post(`/api/campaigns/${c.id}/status`).send({ status: "in_progress" }).expect(200);
    await agent.post(`/api/leads/${ids[0]}/whatsapp-opened`).send({ campaign_id: c.id }).expect(200);
    await agent.post(`/api/leads/${ids[1]}/whatsapp-opened`).send({ campaign_id: c.id }).expect(200);
    const blocked = await agent.post(`/api/leads/${ids[2]}/whatsapp-opened`).send({ campaign_id: c.id });
    expect(blocked.status).toBe(429);
    expect(blocked.body.details.campaign_rule).toMatchObject({ used: 2, remaining: 0 });
    expect((await agent.get(`/api/campaigns/${c.id}`)).body.rule.blocked_reason).toContain("Regra da campanha atingida");
  });

  it("valida a regra e o período do agendamento", async () => {
    const { agent } = setup();
    const ids = await leads(agent, 1);
    const half = await agent.post("/api/campaigns").send(campaignBody({ lead_ids: ids, send_limit: 30 }));
    expect(half.status).toBe(422);
    const tooMany = await agent.post("/api/campaigns").send(campaignBody({ lead_ids: ids, send_limit: 5000, send_window_hours: 6 }));
    expect(tooMany.status).toBe(422);
    const bad = await agent.post("/api/campaigns").send(
      campaignBody({ lead_ids: ids, send_limit: 30, send_window_hours: 6, scheduled_start_at: "2030-01-02T10:00:00Z", scheduled_end_at: "2030-01-01T10:00:00Z" }),
    );
    expect(bad.status).toBe(422);
    expect(bad.body.details.fields.scheduled_end_at).toBeTruthy();
  });

  it("campanha agendada: bloqueada antes do início, inicia sozinha no horário e encerra no fim", async () => {
    const { agent, db } = setup();
    const ids = await leads(agent, 2);
    const future = new Date(Date.now() + 3600_000).toISOString();
    const c = (await agent.post("/api/campaigns").send(campaignBody({ lead_ids: ids, send_limit: 30, send_window_hours: 6, scheduled_start_at: future }))).body;
    expect(c).toMatchObject({ status: "ready", rule: { phase: "scheduled" } });
    // still scheduled: status unchanged and nothing can be sent
    expect((await agent.get(`/api/campaigns/${c.id}`)).body.status).toBe("ready");
    // time passes: start moved to the past
    db.prepare("UPDATE campaigns SET scheduled_start_at = ?, scheduled_end_at = ? WHERE id = ?").run(
      new Date(Date.now() - 60_000).toISOString(),
      new Date(Date.now() + 3600_000).toISOString(),
      c.id,
    );
    const started = (await agent.get(`/api/campaigns/${c.id}`)).body;
    expect(started).toMatchObject({ status: "in_progress", rule: { phase: "open" } });
    expect(started.started_at).toBeTruthy();
    await agent.post(`/api/leads/${ids[0]}/whatsapp-opened`).send({ campaign_id: c.id }).expect(200);
    db.prepare("UPDATE campaigns SET scheduled_end_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), c.id);
    expect((await agent.get(`/api/campaigns/${c.id}`)).body.status).toBe("completed");
    // nothing is ever sent by the schedule itself
    expect((db.prepare("SELECT COUNT(*) c FROM contact_history").get() as { c: number }).c).toBe(1);
  });
});

describe("visão geral: acompanhamento das campanhas e meta de 20% de retorno", () => {
  it("mostra campanhas ativas, previsão da semana e retornos por campanha", async () => {
    const { agent } = setup();
    const ids = await leads(agent, 5);
    const c = (await agent.post("/api/campaigns").send(campaignBody({ lead_ids: ids, send_limit: 2, send_window_hours: 24 }))).body;
    await agent.post(`/api/campaigns/${c.id}/status`).send({ status: "in_progress" }).expect(200);
    await agent.post(`/api/leads/${ids[0]}/whatsapp-opened`).send({ campaign_id: c.id }).expect(200);
    await agent.post(`/api/leads/${ids[0]}/contact-status`).send({ status: "replied", campaign_id: c.id }).expect(200);
    const t = (await agent.get("/api/dashboard")).body.tracking;
    expect(t).toMatchObject({ reply_goal: 0.2, active_campaigns: 1, sent_this_week: 1, sent_total: 1, replied_total: 1 });
    const row = t.campaigns.find((x: { id: number }) => x.id === c.id);
    expect(row).toMatchObject({ total: 5, pending: 4, sent: 1, replied: 1, sent_this_week: 1 });
    expect(row.planned_this_week).toBeGreaterThanOrEqual(2);
    expect(row.planned_this_week).toBeLessThanOrEqual(5);
    const { start, end } = brWeekRange(new Date("2026-10-07T15:00:00Z")); // Wednesday
    expect(start.toISOString()).toBe("2026-10-05T03:00:00.000Z"); // Monday 00:00 in Brasília
    expect(end.toISOString()).toBe("2026-10-12T03:00:00.000Z");
  });
});

describe("Mensagens (caixa de entrada do WhatsApp)", () => {
  it("guarda as conversas por operador, liga ao lead e marca 'Respondeu'", async () => {
    const { agent, db } = setup();
    const ids = await leads(agent, 1); // whatsapp 5511900002000
    const c = (await agent.post("/api/campaigns").send(campaignBody({ lead_ids: ids }))).body;
    await agent.post(`/api/campaigns/${c.id}/status`).send({ status: "in_progress" }).expect(200);
    await agent.post(`/api/leads/${ids[0]}/whatsapp-opened`).set("X-User-Id", "1").send({ campaign_id: c.id }).expect(200);
    expect(phoneVariants("551190002000")).toContain("5511990002000");

    // reply arrives as a privacy id (@lid) with the phone in the alternate id
    storeWhatsAppMessage(db, 1, { id: "A1", chatJid: "123@lid", phoneJid: "5511900002000@s.whatsapp.net", fromMe: false, text: "Oi! Tenho interesse", pushName: "Dono", timestamp: Date.now() });
    storeWhatsAppMessage(db, 1, { id: "A1", chatJid: "123@lid", fromMe: false, text: "Oi! Tenho interesse", timestamp: Date.now() }); // duplicate ignored
    storeWhatsAppMessage(db, 2, { id: "B1", chatJid: "5521900000000@s.whatsapp.net", fromMe: false, text: "outro operador", timestamp: Date.now() });

    const inbox = (await agent.get("/api/inbox").set("X-User-Id", "1")).body;
    expect(inbox.unread).toBe(1);
    expect(inbox.conversations).toEqual([
      expect.objectContaining({ chat_jid: "123@lid", lead_id: ids[0], lead_name: "Lead 0", contact_name: "Dono", last_body: "Oi! Tenho interesse", unread: 1 }),
    ]);
    const messages = (await agent.get("/api/inbox/messages").query({ jid: "123@lid" }).set("X-User-Id", "1")).body;
    expect(messages).toHaveLength(1);
    expect((await agent.get("/api/inbox/unread").set("X-User-Id", "1")).body.unread).toBe(0);
    // funnel updated by the reply
    expect((db.prepare("SELECT contact_status FROM campaign_leads WHERE lead_id = ?").get(ids[0]) as { contact_status: string }).contact_status).toBe("replied");
    expect((db.prepare("SELECT contact_status FROM leads WHERE id = ?").get(ids[0]) as { contact_status: string }).contact_status).toBe("replied");
  });
});
