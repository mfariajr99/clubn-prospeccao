import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { ensureDefaultUser, openDatabase, runMigrations } from "../../server/db/connection";
import { PreviewService } from "../../server/services/preview/previewService";
import { validLead } from "./helpers";

function setup() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  ensureDefaultUser(db);
  const agent = request(createApp({ db, previews: new PreviewService(db), auth: { password: "senha-master", secret: "teste" } }));
  return { db, agent };
}

const cookieOf = (res: request.Response) => String(res.headers["set-cookie"][0]).split(";")[0];

async function loginAdmin(agent: ReturnType<typeof setup>["agent"]) {
  const res = await agent.post("/api/auth/login").send({ login: "admin", password: "senha-master" });
  expect(res.status).toBe(200);
  return cookieOf(res);
}

const campaign = (name: string, lead_ids: number[]) => ({
  name,
  message_template: "Olá {{nome_estabelecimento}}",
  message_template_2: "Oi, tudo bem em {{cidade}}?",
  message_template_3: "Bom dia, {{nome_estabelecimento}}!",
  lead_ids,
  status: "ready",
});

describe("usuários independentes (clientes)", () => {
  it("admin cria um cliente que entra com login e senha e começa do zero", async () => {
    const { agent } = setup();
    const admin = await loginAdmin(agent);
    // the master workspace has data
    await agent.post("/api/leads").set("Cookie", admin).send(validLead()).expect(201);

    const created = await agent.post("/api/admin/clients").set("Cookie", admin).send({ name: "Agência Exemplo", login: "Agencia.Exemplo", password: "cliente-123" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Agência Exemplo", login: "agencia.exemplo", active: true, metrics: { leads: 0, campaigns: 0 } });
    expect(JSON.stringify(created.body)).not.toContain("cliente-123");

    expect((await agent.post("/api/auth/login").send({ login: "agencia.exemplo", password: "errada" })).status).toBe(401);
    const login = await agent.post("/api/auth/login").send({ login: "AGENCIA.EXEMPLO", password: "cliente-123" });
    expect(login.status).toBe(200);
    const client = cookieOf(login);

    const status = (await agent.get("/api/auth/status").set("Cookie", client)).body;
    expect(status).toMatchObject({ authenticated: true, role: "client", account: { name: "Agência Exemplo", login: "agencia.exemplo" } });
    // starts from zero: no leads, only its own operator
    expect((await agent.get("/api/leads").set("Cookie", client)).body.total).toBe(0);
    expect((await agent.get("/api/users").set("Cookie", client)).body.map((u: { name: string }) => u.name)).toEqual(["Agência Exemplo"]);
  });

  it("cada cliente só vê os próprios dados e não cria logins nem acessa a área do admin", async () => {
    const { agent } = setup();
    const admin = await loginAdmin(agent);
    await agent.post("/api/admin/clients").set("Cookie", admin).send({ name: "Cliente A", login: "cliente-a", password: "senha-a-123" }).expect(201);
    await agent.post("/api/admin/clients").set("Cookie", admin).send({ name: "Cliente B", login: "cliente-b", password: "senha-b-123" }).expect(201);
    const a = cookieOf(await agent.post("/api/auth/login").send({ login: "cliente-a", password: "senha-a-123" }));
    const b = cookieOf(await agent.post("/api/auth/login").send({ login: "cliente-b", password: "senha-b-123" }));

    const leadA = (await agent.post("/api/leads").set("Cookie", a).send(validLead())).body;
    // same WhatsApp is allowed in another client's database
    await agent.post("/api/leads").set("Cookie", b).send(validLead()).expect(201);
    const campA = (await agent.post("/api/campaigns").set("Cookie", a).send(campaign("Campanha A", [leadA.id]))).body;

    expect((await agent.get("/api/campaigns").set("Cookie", b)).body.total).toBe(0);
    expect((await agent.get("/api/campaigns").set("Cookie", admin)).body.total).toBe(0);
    expect((await agent.get("/api/leads").set("Cookie", admin)).body.total).toBe(0);
    expect((await agent.get(`/api/campaigns/${campA.id}`).set("Cookie", a)).status).toBe(200);

    expect((await agent.get("/api/admin/clients").set("Cookie", a)).status).toBe(403);
    expect((await agent.post("/api/admin/clients").set("Cookie", a).send({ name: "X", login: "xyz", password: "12345678" })).status).toBe(403);
    expect((await agent.post("/api/users").set("Cookie", a).send({ name: "Outro", email: "outro@x.com" })).status).toBe(403);
    expect((await agent.post("/api/users").set("Cookie", admin).send({ name: "Novo operador", email: "novo@x.com" })).status).toBe(201);
  });

  it("admin acompanha os clientes só com números", async () => {
    const { agent } = setup();
    const admin = await loginAdmin(agent);
    const created = (await agent.post("/api/admin/clients").set("Cookie", admin).send({ name: "Cliente C", login: "cliente-c", password: "senha-c-123" })).body;
    const c = cookieOf(await agent.post("/api/auth/login").send({ login: "cliente-c", password: "senha-c-123" }));
    const lead = (await agent.post("/api/leads").set("Cookie", c).send(validLead())).body;
    const lead2 = (await agent.post("/api/leads").set("Cookie", c).send(validLead({ establishment_name: "Outro", whatsapp: "11 90000-4444" }))).body;
    const camp = (await agent.post("/api/campaigns").set("Cookie", c).send(campaign("Campanha C", [lead.id, lead2.id]))).body;
    await agent.post(`/api/campaigns/${camp.id}/status`).set("Cookie", c).send({ status: "in_progress" }).expect(200);
    await agent.post(`/api/leads/${lead.id}/whatsapp-opened`).set("Cookie", c).send({ campaign_id: camp.id }).expect(200);
    await agent.post(`/api/leads/${lead.id}/contact-status`).set("Cookie", c).send({ status: "interested", campaign_id: camp.id }).expect(200);

    const list = (await agent.get("/api/admin/clients").set("Cookie", admin)).body;
    expect(list[0]).toMatchObject({
      login: "cliente-c",
      metrics: { leads: 2, campaigns: 1, campaigns_in_progress: 1, whatsapp_opened: 1, contacted: 1, replied: 1, interested: 1, sends_today: 1 },
    });
    expect(list[0].last_login_at).toBeTruthy();
    const detail = (await agent.get(`/api/admin/clients/${created.id}`).set("Cookie", admin)).body;
    expect(detail.campaigns).toEqual([
      expect.objectContaining({ name: "Campanha C", status: "in_progress", total: 2, whatsapp_opened: 1, contacted: 1, replied: 1, interested: 1, partnerships: 0 }),
    ]);
    // numbers only: no lead names, phones or message texts
    const raw = JSON.stringify(detail);
    expect(raw).not.toContain("Café Teste");
    expect(raw).not.toContain("5511900001234");
    expect(raw).not.toContain("Olá");
  });

  it("bloquear ou trocar a senha encerra o acesso do cliente; logins são únicos e validados", async () => {
    const { agent } = setup();
    const admin = await loginAdmin(agent);
    const created = (await agent.post("/api/admin/clients").set("Cookie", admin).send({ name: "Cliente D", login: "cliente-d", password: "senha-d-123" })).body;
    const dup = await agent.post("/api/admin/clients").set("Cookie", admin).send({ name: "Outro", login: "Cliente-D", password: "senha-d-123" });
    expect(dup.status).toBe(409);
    const invalid = await agent.post("/api/admin/clients").set("Cookie", admin).send({ name: "A", login: "com espaço", password: "123" });
    expect(invalid.status).toBe(422);
    expect(Object.keys(invalid.body.details.fields).sort()).toEqual(["login", "name", "password"]);
    expect((await agent.post("/api/admin/clients").set("Cookie", admin).send({ name: "Admin", login: "admin", password: "12345678" })).status).toBe(422);

    const d = cookieOf(await agent.post("/api/auth/login").send({ login: "cliente-d", password: "senha-d-123" }));
    expect((await agent.get("/api/leads").set("Cookie", d)).status).toBe(200);
    await agent.put(`/api/admin/clients/${created.id}`).set("Cookie", admin).send({ active: false }).expect(200);
    expect((await agent.get("/api/leads").set("Cookie", d)).status).toBe(401);
    const blocked = await agent.post("/api/auth/login").send({ login: "cliente-d", password: "senha-d-123" });
    expect(blocked.status).toBe(401);
    expect(blocked.body.error).toContain("bloqueado");

    await agent.put(`/api/admin/clients/${created.id}`).set("Cookie", admin).send({ active: true }).expect(200);
    const d2 = cookieOf(await agent.post("/api/auth/login").send({ login: "cliente-d", password: "senha-d-123" }));
    await agent.post(`/api/admin/clients/${created.id}/password`).set("Cookie", admin).send({ password: "nova-senha-456" }).expect(200);
    expect((await agent.get("/api/leads").set("Cookie", d2)).status).toBe(401);
    expect((await agent.post("/api/auth/login").send({ login: "cliente-d", password: "senha-d-123" })).status).toBe(401);
    expect((await agent.post("/api/auth/login").send({ login: "cliente-d", password: "nova-senha-456" })).status).toBe(200);
  });
});
