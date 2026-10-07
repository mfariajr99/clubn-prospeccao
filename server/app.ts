import express, { type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import type { DB } from "./db/core.js";
import { HttpError, errorHandler, intParam } from "./lib/http.js";
import { createAccounts, createAdminRouter, type Identity, type TenantResources } from "./accounts.js";
import { createAuth, type AuthOptions } from "./auth.js";
import { openDatabase } from "./db/connection.js";
import { nodePasswordHasher } from "./lib/password.js";
import { createApiRouter, resolveOperator } from "./router.js";
import { prepareWhatsAppSend, registerWhatsAppSent } from "./services/leads.js";
import { storeWhatsAppMessage } from "./services/inbox.js";
import { syncScheduledCampaigns } from "./services/campaignRules.js";
import { PreviewService } from "./services/preview/previewService.js";
import { WhatsAppManager } from "./whatsapp/manager.js";
import { baileysDriver } from "./whatsapp/baileysDriver.js";
import os from "node:os";
import { z } from "zod";
import { parseBody } from "./lib/http.js";

export interface AppDeps {
  db: DB;
  previews: PreviewService;
  staticDir?: string;
  auth?: AuthOptions;
  /** Opens the isolated database of a client account (default: in memory, for tests). */
  openTenant?: (account: { id: number; storageKey: string }) => TenantResources;
  adminLogin?: string;
  /** WhatsApp connections (one per operator). Default: sessions in a temp folder. */
  whatsapp?: WhatsAppManager;
}

export function createApp({ db, previews, staticDir, auth: authOptions, openTenant, adminLogin, whatsapp: whatsappDep }: AppDeps) {
  const whatsapp = whatsappDep ?? new WhatsAppManager(path.join(os.tmpdir(), `clubn-whatsapp-${process.pid}`), baileysDriver);
  const app = express();
  const accounts = createAccounts(db, {
    hasher: nodePasswordHasher,
    adminLogin: adminLogin ?? process.env.APP_ADMIN_LOGIN,
    openTenant:
      openTenant ??
      (() => {
        const tdb = openDatabase(":memory:");
        return { db: tdb, previews: new PreviewService(tdb) };
      }),
  });
  const auth = createAuth(accounts, authOptions);
  app.set("trust proxy", 1); // behind Render's / any HTTPS proxy
  const router = createApiRouter(db, previews, { canManageUsers: true });
  const adminRouter = createAdminRouter(accounts);
  /** Master workspace for the admin; the client's own isolated workspace otherwise. */
  const workspace = (res: Response) => {
    const identity = res.locals.identity as Identity;
    return identity.role === "client" ? accounts.tenant(identity.accountId) : { db, previews, router, key: "main" };
  };
  // Messages received (or sent from the phone) go to the operator's workspace.
  whatsapp.setMessageSink((key, messages) => {
    const [wsKey, userPart] = key.split("/");
    const userId = Number(userPart?.replace("user-", ""));
    const wsDb = wsKey === "main" ? db : accounts.tenantByKey(wsKey)?.db;
    if (!wsDb || !Number.isInteger(userId)) return;
    for (const m of messages) storeWhatsAppMessage(wsDb, userId, m);
  });
  /** The selected operator and the key of their WhatsApp session. */
  const operator = (req: Request, res: Response) => {
    const ws = workspace(res);
    syncScheduledCampaigns(ws.db);
    const user = resolveOperator(ws.db, req.header("x-user-id"));
    return { ws, user, key: WhatsAppManager.key(ws.key, user.id) };
  };
  app.disable("x-powered-by");
  app.use(express.json({ limit: "25mb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });

  // Public: health check and team login.
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/api/auth/status", auth.status);
  app.post("/api/auth/login", auth.login);
  app.post("/api/auth/logout", auth.logout);
  app.use("/api", auth.guard);

  // ---------------- WhatsApp "conexão própria" (one number per operator) ----------------
  app.get("/api/whatsapp/status", (req: Request, res: Response) => {
    res.json(whatsapp.status(operator(req, res).key));
  });
  app.post("/api/whatsapp/connect", async (req: Request, res: Response) => {
    const body = parseBody(z.object({ method: z.enum(["qr", "code"]), phone: z.string().max(40).optional() }), req.body ?? {});
    res.json(await whatsapp.connect(operator(req, res).key, body));
  });
  app.post("/api/whatsapp/disconnect", async (req: Request, res: Response) => {
    res.json(await whatsapp.disconnect(operator(req, res).key));
  });
  // "Mensagens": answer inside a conversation.
  app.post("/api/inbox/reply", async (req: Request, res: Response) => {
    const { ws, user, key } = operator(req, res);
    const body = parseBody(z.object({ jid: z.string().min(3).max(200), text: z.string().trim().min(1, "Escreva a mensagem.").max(4000) }), req.body ?? {});
    const sent = await whatsapp.reply(key, body.jid, body.text);
    storeWhatsAppMessage(ws.db, user.id, { id: sent.id ?? `local-${Date.now()}`, chatJid: body.jid, fromMe: true, text: body.text, timestamp: Date.now() });
    res.json({ ok: true });
  });

  // One click = one message, sent through the operator's connected WhatsApp.
  // Sessions, pauses and the 1 -> 2 -> 3 rotation apply exactly as with wa.me.
  app.post("/api/leads/:id/whatsapp-send", async (req: Request, res: Response) => {
    const { ws, user, key } = operator(req, res);
    const body = parseBody(z.object({ campaign_id: z.number().int().positive().nullable().optional() }), req.body ?? {});
    const leadId = intParam(req.params.id);
    const campaignId = body.campaign_id ?? null;
    const prepared = prepareWhatsAppSend(ws.db, { leadId, campaignId, userId: user.id });
    const sent = await whatsapp.send(key, prepared.phone, prepared.text);
    const result = registerWhatsAppSent(ws.db, { leadId, campaignId, userId: user.id, messageType: prepared.messageType });
    storeWhatsAppMessage(ws.db, user.id, { id: sent.id ?? `local-${Date.now()}`, chatJid: sent.jid, phoneJid: sent.jid, fromMe: true, text: prepared.text, timestamp: Date.now() });
    res.json({ ...result, sent: true, establishment_name: prepared.establishment_name });
  });

  // Binary file: served only by the Node server.
  app.get("/api/previews/:id/screenshot", (req: Request, res: Response) => {
    const file = workspace(res).previews.screenshotFile?.(intParam(req.params.id));
    if (!file || !fs.existsSync(file)) throw new HttpError(404, "Captura não encontrada.");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.type("image/jpeg").sendFile(path.resolve(file));
  });

  // Admin only: client logins and their numbers.
  app.use("/api/admin", (req: Request, res: Response) => {
    if ((res.locals.identity as Identity).role !== "admin") throw new HttpError(403, "Acesso restrito ao administrador.");
    const result = adminRouter.handle(req.method, req.path, req.query as Record<string, unknown>, req.body ?? {});
    res.status(result.status).json(result.body);
  });

  app.use("/api", (req: Request, res: Response) => {
    const result = workspace(res).router.handle(req.method, req.path, req.query as Record<string, unknown>, req.body ?? {}, req.header("x-user-id"));
    for (const [k, v] of Object.entries(result.headers ?? {})) res.setHeader(k, v);
    if (result.status === 204) return res.status(204).end();
    if (result.contentType) return res.status(result.status).type(result.contentType).send(result.body);
    res.status(result.status).json(result.body);
  });

  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(staticDir, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
