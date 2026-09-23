import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { ensureDefaultUser, openDatabase, runMigrations } from "../../server/db/connection";
import { PreviewService } from "../../server/services/preview/previewService";

function app(password?: string) {
  const db = openDatabase(":memory:");
  runMigrations(db);
  ensureDefaultUser(db);
  return request(createApp({ db, previews: new PreviewService(db), auth: { password: password ?? "", secret: "teste" } }));
}

describe("senha de acesso da equipe", () => {
  it("sem APP_PASSWORD o acesso é livre", async () => {
    const agent = app();
    expect((await agent.get("/api/auth/status")).body).toEqual({ required: false, authenticated: true });
    expect((await agent.get("/api/leads")).status).toBe(200);
  });

  it("com senha, bloqueia a API até o login e libera com cookie de sessão", async () => {
    const agent = app("senha-forte");
    expect((await agent.get("/api/health")).status).toBe(200);
    const blocked = await agent.get("/api/leads");
    expect(blocked.status).toBe(401);
    expect(blocked.body.code).toBe("AUTH_REQUIRED");
    expect((await agent.post("/api/auth/login").send({ password: "errada" })).status).toBe(401);
    const ok = await agent.post("/api/auth/login").send({ password: "senha-forte" });
    expect(ok.status).toBe(200);
    const cookie = ok.headers["set-cookie"][0].split(";")[0];
    expect(ok.headers["set-cookie"][0]).toContain("HttpOnly");
    expect((await agent.get("/api/leads").set("Cookie", cookie)).status).toBe(200);
    expect((await agent.get("/api/auth/status").set("Cookie", cookie)).body).toEqual({ required: true, authenticated: true });
    // tampered cookie is rejected
    expect((await agent.get("/api/leads").set("Cookie", cookie.replace(/.$/, "x"))).status).toBe(401);
  });

  it("limita tentativas de senha", async () => {
    const agent = app("senha-forte");
    for (let i = 0; i < 8; i++) await agent.post("/api/auth/login").send({ password: "x" });
    expect((await agent.post("/api/auth/login").send({ password: "senha-forte" })).status).toBe(429);
  });
});
