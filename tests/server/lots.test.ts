import { describe, expect, it } from "vitest";
import { lotAt, lotWindow } from "../../shared/campaignRule";
import { setup, validLead } from "./helpers";

const body = (extra: Record<string, unknown> = {}) => ({
  name: "Lotes",
  message_template: "Mensagem um {{cidade}}",
  message_template_2: "Mensagem dois {{cidade}}",
  message_template_3: "Mensagem três {{cidade}}",
  status: "ready",
  ...extra,
});

async function leads(agent: ReturnType<typeof setup>["agent"], n: number) {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push((await agent.post("/api/leads").send(validLead({ establishment_name: `Lead ${i}`, whatsapp: `11 9${String(10000000 + i)}` }))).body.id);
  return ids;
}

describe("lotes: a base dividida em grupos, um grupo a cada 12h", () => {
  it("janelas dos lotes", () => {
    const start = "2026-10-08T12:00:00.000Z";
    expect(lotWindow(start, 12, 1)).toEqual({ start, end: "2026-10-09T00:00:00.000Z" });
    expect(lotWindow(start, 12, 3).start).toBe("2026-10-09T12:00:00.000Z");
    expect(lotAt(start, 12, new Date("2026-10-08T23:59:00Z"))).toBe(1);
    expect(lotAt(start, 12, new Date("2026-10-09T00:00:00Z"))).toBe(2);
  });

  it("divide 7 leads em lotes de 3 a cada 12h e a regra vira 3 a cada 12h", async () => {
    const { agent } = setup();
    const ids = await leads(agent, 7);
    const start = new Date(Date.now() + 3600_000).toISOString();
    const c = (await agent.post("/api/campaigns").send(body({ lead_ids: ids, batch_size: 3, batch_hours: 12, scheduled_start_at: start }))).body;
    expect(c).toMatchObject({ batch_size: 3, batch_hours: 12, send_limit: 3, send_window_hours: 12 });
    expect(c.lots).toMatchObject({ total_lots: 3, current: null, gap_minutes: 240 });
    expect(c.lots.lots.map((l: { total: number }) => l.total)).toEqual([3, 3, 1]);
    expect(c.scheduled_end_at).toBe(lotWindow(start, 12, 3).end);
    const lot2 = (await agent.get(`/api/campaigns/${c.id}/leads`).query({ lot: "2" })).body;
    expect(lot2.items.map((l: { id: number }) => l.id)).toEqual(ids.slice(3, 6));
    expect(lot2.items[0].batch_number).toBe(2);
  });

  it("lead de lote futuro não pode ser contatado; lote aberto sim", async () => {
    const { agent, db } = setup();
    const ids = await leads(agent, 4);
    const start = new Date(Date.now() - 3600_000).toISOString(); // lot 1 open now
    const c = (await agent.post("/api/campaigns").send(body({ lead_ids: ids, batch_size: 2, batch_hours: 12, scheduled_start_at: start }))).body;
    expect((await agent.get(`/api/campaigns/${c.id}`)).body).toMatchObject({ status: "in_progress", lots: { current: 1 } });
    await agent.post(`/api/leads/${ids[0]}/whatsapp-opened`).send({ campaign_id: c.id }).expect(200);
    const future = await agent.post(`/api/leads/${ids[2]}/whatsapp-opened`).send({ campaign_id: c.id });
    expect(future.status).toBe(429);
    expect(future.body.error).toContain("lote 2");
    const current = (await agent.get(`/api/campaigns/${c.id}/leads`).query({ lot: "current" })).body;
    expect(current.items.map((l: { id: number }) => l.id)).toEqual(ids.slice(0, 2));
    // suggested spacing: 12h / 2 = 6h after the last send
    const lots = (await agent.get(`/api/campaigns/${c.id}`)).body.lots;
    expect(lots.gap_minutes).toBe(360);
    expect(Date.parse(lots.suggested_next_at)).toBeGreaterThan(Date.now() + 5 * 3600_000);
    expect((db.prepare("SELECT COUNT(*) c FROM contact_history").get() as { c: number }).c).toBe(1);
  });

  it("leads já em outra campanha aberta não entram nos lotes e o filtro 'disponíveis' os esconde", async () => {
    const { agent } = setup();
    const ids = await leads(agent, 3);
    await agent.post("/api/campaigns").send(body({ name: "Outra", lead_ids: [ids[0]] })).expect(201);
    expect((await agent.get("/api/leads").query({ available: "1" })).body.total).toBe(2);
    const start = new Date(Date.now() + 3600_000).toISOString();
    const c = (await agent.post("/api/campaigns").send(body({ lead_ids: ids, batch_size: 30, batch_hours: 12, scheduled_start_at: start }))).body;
    expect(c.lead_count).toBe(2);
    expect((await agent.get("/api/leads").query({ available: "1" })).body.total).toBe(0);
  });

  it("exige o início do primeiro lote", async () => {
    const { agent } = setup();
    const ids = await leads(agent, 1);
    const res = await agent.post("/api/campaigns").send(body({ lead_ids: ids, batch_size: 30, batch_hours: 12 }));
    expect(res.status).toBe(422);
    expect(res.body.details.fields.scheduled_start_at).toBeTruthy();
  });
});
