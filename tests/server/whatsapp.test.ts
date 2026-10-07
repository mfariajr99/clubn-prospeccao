import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { ensureDefaultUser, openDatabase, runMigrations } from "../../server/db/connection";
import { PreviewService } from "../../server/services/preview/previewService";
import { WhatsAppManager, type WaDriver, type WaDriverEvents } from "../../server/whatsapp/manager";
import { validLead } from "./helpers";

/** Fake WhatsApp: no network. Records sent messages; the test drives the events. */
function fakeDriver() {
  const sent: { jid: string; text: string }[] = [];
  const handles: { events: WaDriverEvents; dir: string }[] = [];
  const noWhatsApp = new Set<string>();
  const driver: WaDriver = async (dir, events) => {
    handles.push({ events, dir });
    setTimeout(() => {
      // already linked: opens directly; otherwise shows a QR
      if (fs.existsSync(path.join(dir, "creds.json"))) events.onOpen({ id: "5511988887777:3@s.whatsapp.net", name: "Thomaz" });
      else events.onQr("2@fake-qr-payload");
    }, 5);
    return {
      requestPairingCode: async () => "ABCD1234",
      resolve: async (phone) => (noWhatsApp.has(phone) ? null : `${phone}@s.whatsapp.net`),
      sendText: async (jid, text) => {
        sent.push({ jid, text });
        return { id: `msg-${sent.length}` };
      },
      logout: async () => undefined,
      end: () => undefined,
    };
  };
  /** Simulates the phone scanning the QR / typing the code. */
  const link = () => {
    const h = handles[handles.length - 1];
    fs.writeFileSync(path.join(h.dir, "creds.json"), JSON.stringify({ me: { id: "5511988887777:3@s.whatsapp.net" } }));
    h.events.onOpen({ id: "5511988887777:3@s.whatsapp.net", name: "Thomaz" });
  };
  return { driver, sent, link, handles, noWhatsApp };
}

function setup() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  ensureDefaultUser(db);
  const fake = fakeDriver();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clubn-wa-test-"));
  const whatsapp = new WhatsAppManager(dir, fake.driver);
  const agent = request(createApp({ db, previews: new PreviewService(db), whatsapp }));
  return { db, agent, fake, dir, whatsapp };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function campaignWithLeads(agent: ReturnType<typeof setup>["agent"], n = 2) {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push((await agent.post("/api/leads").send(validLead({ establishment_name: `Café ${i}`, whatsapp: `11 90000-10${10 + i}` }))).body.id);
  const c = (
    await agent.post("/api/campaigns").send({
      name: "Teste WhatsApp",
      message_template: "Mensagem um para {{nome_estabelecimento}}",
      message_template_2: "Mensagem dois para {{nome_estabelecimento}}",
      message_template_3: "Mensagem três para {{nome_estabelecimento}}",
      lead_ids: ids,
      status: "ready",
    })
  ).body;
  await agent.post(`/api/campaigns/${c.id}/status`).send({ status: "in_progress" }).expect(200);
  return { campaignId: c.id as number, ids };
}

describe("WhatsApp conectado (conexão própria por operador)", () => {
  it("conecta por QR Code e mostra o número conectado", async () => {
    const { agent, fake } = setup();
    expect((await agent.get("/api/whatsapp/status").set("X-User-Id", "1")).body.state).toBe("disconnected");
    const started = await agent.post("/api/whatsapp/connect").set("X-User-Id", "1").send({ method: "qr" });
    expect(started.body.state).toBe("qr");
    expect(started.body.qr).toMatch(/^data:image\/png;base64,/);
    fake.link();
    const status = (await agent.get("/api/whatsapp/status").set("X-User-Id", "1")).body;
    expect(status).toMatchObject({ state: "connected", phone: "5511988887777", qr: null });
    // each operator has their own connection
    expect((await agent.get("/api/whatsapp/status").set("X-User-Id", "2")).body.state).toBe("disconnected");
  });

  it("conecta por código de conexão (número com DDI) e valida o número", async () => {
    const { agent } = setup();
    expect((await agent.post("/api/whatsapp/connect").set("X-User-Id", "1").send({ method: "code", phone: "11 9" })).status).toBe(422);
    const res = await agent.post("/api/whatsapp/connect").set("X-User-Id", "1").send({ method: "code", phone: "+55 (11) 98888-7777" });
    expect(res.body).toMatchObject({ state: "pairing", pairing_code: "ABCD-1234", qr: null });
  });

  it("envia 1 mensagem por clique, alternando 1-2-3, e marca 'Mensagem enviada'", async () => {
    const { agent, fake, db } = setup();
    const { campaignId, ids } = await campaignWithLeads(agent, 2);
    // not connected yet: clear error, nothing recorded
    const notConnected = await agent.post(`/api/leads/${ids[0]}/whatsapp-send`).set("X-User-Id", "1").send({ campaign_id: campaignId });
    expect(notConnected.status).toBe(409);
    expect(notConnected.body.details.code).toBe("WA_NOT_CONNECTED");
    expect(fake.sent).toHaveLength(0);

    await agent.post("/api/whatsapp/connect").set("X-User-Id", "1").send({ method: "qr" });
    fake.link();
    const r1 = await agent.post(`/api/leads/${ids[0]}/whatsapp-send`).set("X-User-Id", "1").send({ campaign_id: campaignId });
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ sent: true, message_type: 1, previous: "not_contacted", current: "message_sent", quota: { sessionCount: 1 } });
    const r2 = await agent.post(`/api/leads/${ids[1]}/whatsapp-send`).set("X-User-Id", "1").send({ campaign_id: campaignId });
    expect(r2.body.message_type).toBe(2);
    expect(fake.sent).toEqual([
      { jid: "5511900001010@s.whatsapp.net", text: "Mensagem um para Café 0" },
      { jid: "5511900001011@s.whatsapp.net", text: "Mensagem dois para Café 1" },
    ]);
    const history = db.prepare("SELECT event_type, new_status, message_type FROM contact_history ORDER BY id").all();
    expect(history).toEqual([
      { event_type: "whatsapp_sent", new_status: "message_sent", message_type: 1 },
      { event_type: "whatsapp_sent", new_status: "message_sent", message_type: 2 },
    ]);
    expect((db.prepare("SELECT contact_status FROM campaign_leads WHERE lead_id = ?").get(ids[0]) as { contact_status: string }).contact_status).toBe("message_sent");
  });

  it("respeita a pausa da sessão e não envia para número sem WhatsApp", async () => {
    const { agent, fake, db } = setup();
    const { campaignId, ids } = await campaignWithLeads(agent, 1);
    await agent.post("/api/whatsapp/connect").set("X-User-Id", "1").send({ method: "qr" });
    fake.link();
    fake.noWhatsApp.add("5511900001010");
    const noWa = await agent.post(`/api/leads/${ids[0]}/whatsapp-send`).set("X-User-Id", "1").send({ campaign_id: campaignId });
    expect(noWa.status).toBe(422);
    expect((db.prepare("SELECT COUNT(*) c FROM contact_history").get() as { c: number }).c).toBe(0);
    fake.noWhatsApp.clear();

    db.prepare("INSERT INTO operator_send_quota (user_id, cycle_started_at, session_index, session_count, total_count, locked_until) VALUES (1, ?, 0, 30, 30, ?)").run(
      new Date().toISOString(),
      new Date(Date.now() + 3600_000).toISOString(),
    );
    const paused = await agent.post(`/api/leads/${ids[0]}/whatsapp-send`).set("X-User-Id", "1").send({ campaign_id: campaignId });
    expect(paused.status).toBe(429);
    expect(paused.body.details.quota.locked).toBe(true);
    expect(fake.sent).toHaveLength(0);
  });

  it("sessão salva reconecta sozinha e desconectar apaga a sessão", async () => {
    const { agent, fake, dir } = setup();
    await agent.post("/api/whatsapp/connect").set("X-User-Id", "1").send({ method: "qr" });
    fake.link();
    // a new manager (e.g. after a redeploy) restores the saved session
    const again = new WhatsAppManager(dir, fake.driver);
    again.restoreAll();
    await wait(30);
    expect(again.status(WhatsAppManager.key("main", 1)).state).toBe("connected");
    const off = await agent.post("/api/whatsapp/disconnect").set("X-User-Id", "1");
    expect(off.body.state).toBe("disconnected");
    expect(fs.existsSync(path.join(dir, "main", "user-1"))).toBe(false);
  });
});
