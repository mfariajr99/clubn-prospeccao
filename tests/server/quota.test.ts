import { describe, expect, it } from "vitest";
import { DAILY_LIMIT, emptyQuota, registerSend, viewQuota, type QuotaState } from "../../shared/sendQuota";
import { pickTemplate } from "../../src/lib/whatsapp";
import { setup, validLead } from "./helpers";

const MIN = 60_000;
const t0 = new Date("2026-09-23T12:00:00.000Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

function sendMany(state: QuotaState, n: number, now: Date) {
  const types: number[] = [];
  let s = state;
  for (let i = 0; i < n; i++) {
    const r = registerSend(s, now);
    if (!r.ok) throw new Error(`blocked at ${i}`);
    types.push(r.messageType);
    s = r.state;
  }
  return { state: s, types };
}

describe("regra de envios por operador (sessões e pausas)", () => {
  it("sessão 1: 30 envios alternando mensagens 1-2-3, depois pausa de 90 min", () => {
    const { state, types } = sendMany(emptyQuota(), 30, t0);
    expect(types.slice(0, 6)).toEqual([1, 2, 3, 1, 2, 3]);
    expect(state.lockedUntil).toBe(at(90 * MIN).toISOString());
    expect(registerSend(state, at(89 * MIN)).ok).toBe(false); // still paused
    const v = viewQuota(state, at(90 * MIN));
    expect(v).toMatchObject({ locked: false, session: 2, sessionCount: 0, sessionLimit: 15, totalCount: 30, nextMessageType: 1 });
  });

  it("ciclo completo 30/15/30/15 = 90 com pausas de 90, 90 e 120 min e retorno à sessão 1 após 24h", () => {
    let s = sendMany(emptyQuota(), 30, t0).state; // S1
    let now = at(90 * MIN);
    s = sendMany(s, 15, now).state; // S2
    expect(s.lockedUntil).toBe(new Date(now.getTime() + 90 * MIN).toISOString());
    now = new Date(now.getTime() + 90 * MIN);
    expect(viewQuota(s, now).session).toBe(3);
    s = sendMany(s, 30, now).state; // S3
    expect(s.lockedUntil).toBe(new Date(now.getTime() + 120 * MIN).toISOString());
    now = new Date(now.getTime() + 120 * MIN);
    expect(viewQuota(s, now)).toMatchObject({ session: 4, sessionLimit: 15, totalCount: 75 });
    s = sendMany(s, 15, now).state; // S4
    expect(s.totalCount).toBe(DAILY_LIMIT);
    // locked until 24h after the first send of the cycle
    expect(s.lockedUntil).toBe(at(24 * 60 * MIN).toISOString());
    expect(registerSend(s, at(23 * 60 * MIN)).ok).toBe(false);
    expect(viewQuota(s, at(24 * 60 * MIN))).toMatchObject({ session: 1, sessionCount: 0, totalCount: 0, locked: false });
  });

  it("o ciclo de 24h reinicia mesmo sem atingir 90 envios", () => {
    const s = sendMany(emptyQuota(), 10, t0).state;
    expect(viewQuota(s, at(24 * 60 * MIN + 1))).toMatchObject({ session: 1, totalCount: 0 });
  });

  it("alterna os textos da campanha e usa a mensagem 1 quando 2/3 não existem", () => {
    expect(pickTemplate(["A", "B", "C"], 2)).toBe("B");
    expect(pickTemplate(["A", "", null], 3)).toBe("A");
    expect(pickTemplate([null], 2)).toContain("Club’n");
  });
});

describe("API: contador por operador", () => {
  it("bloqueia o 31º envio da sessão 1, por operador, sem registrar nada", async () => {
    const { agent, db } = setup();
    const lead = (await agent.post("/api/leads").send(validLead())).body;
    const types: number[] = [];
    for (let i = 0; i < 30; i++) {
      const r = await agent.post(`/api/leads/${lead.id}/whatsapp-opened`).set("X-User-Id", "1").send({});
      expect(r.status).toBe(200);
      types.push(r.body.message_type);
    }
    expect(types.slice(0, 4)).toEqual([1, 2, 3, 1]);
    const blocked = await agent.post(`/api/leads/${lead.id}/whatsapp-opened`).set("X-User-Id", "1").send({});
    expect(blocked.status).toBe(429);
    expect(blocked.body.details.quota).toMatchObject({ locked: true, session: 1, sessionCount: 30, totalCount: 30 });
    expect((db.prepare("SELECT COUNT(*) c FROM contact_history WHERE changed_by = 1").get() as { c: number }).c).toBe(30);

    // header counter for operator 1 and an independent counter for operator 2
    expect((await agent.get("/api/quota").set("X-User-Id", "1")).body).toMatchObject({ locked: true, totalCount: 30 });
    expect((await agent.get("/api/quota").set("X-User-Id", "2")).body).toMatchObject({ locked: false, totalCount: 0, session: 1 });
    expect((await agent.post(`/api/leads/${lead.id}/whatsapp-opened`).set("X-User-Id", "2").send({})).status).toBe(200);
  });

  it("operadores padrão da equipe", async () => {
    const { agent } = setup();
    const names = (await agent.get("/api/users")).body.map((u: { name: string }) => u.name);
    expect(names).toEqual(["Lucas", "Marcos", "Thomaz"]);
  });

  it("campanha exige as 3 mensagens e a duplicação copia todas", async () => {
    const { agent } = setup();
    expect((await agent.post("/api/campaigns").send({ name: "Só uma", message_template: "Olá {{cidade}}" })).status).toBe(400);
    const c = (await agent.post("/api/campaigns").send({ name: "Três", message_template: "Um {{cidade}}", message_template_2: "Dois {{cidade}}", message_template_3: "Três {{cidade}}" })).body;
    expect(c).toMatchObject({ message_template_2: "Dois {{cidade}}", message_template_3: "Três {{cidade}}" });
    const copy = (await agent.post(`/api/campaigns/${c.id}/duplicate`)).body;
    expect(copy).toMatchObject({ message_template: "Um {{cidade}}", message_template_2: "Dois {{cidade}}", message_template_3: "Três {{cidade}}" });
    const bad = await agent.post("/api/campaigns").send({ name: "Var", message_template: "Um", message_template_2: "Dois {{x}}", message_template_3: "Três" });
    expect(bad.status).toBe(400);
  });
});
