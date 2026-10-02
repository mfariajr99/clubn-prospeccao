import express, { type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import type { DB } from "./db/core.js";
import { HttpError, errorHandler, intParam } from "./lib/http.js";
import { createAccounts, createAdminRouter, type Identity, type TenantResources } from "./accounts.js";
import { createAuth, type AuthOptions } from "./auth.js";
import { openDatabase } from "./db/connection.js";
import { nodePasswordHasher } from "./lib/password.js";
import { createApiRouter } from "./router.js";
import { PreviewService } from "./services/preview/previewService.js";

export interface AppDeps {
  db: DB;
  previews: PreviewService;
  staticDir?: string;
  auth?: AuthOptions;
  /** Opens the isolated database of a client account (default: in memory, for tests). */
  openTenant?: (account: { id: number; storageKey: string }) => TenantResources;
  adminLogin?: string;
}

export function createApp({ db, previews, staticDir, auth: authOptions, openTenant, adminLogin }: AppDeps) {
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
    return identity.role === "client" ? accounts.tenant(identity.accountId) : { db, previews, router };
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
