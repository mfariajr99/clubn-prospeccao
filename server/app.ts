import express, { type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import type { DB } from "./db/core.js";
import { HttpError, errorHandler, intParam } from "./lib/http.js";
import { createAuth, type AuthOptions } from "./auth.js";
import { createApiRouter } from "./router.js";
import type { PreviewService } from "./services/preview/previewService.js";

export interface AppDeps {
  db: DB;
  previews: PreviewService;
  staticDir?: string;
  auth?: AuthOptions;
}

export function createApp({ db, previews, staticDir, auth: authOptions }: AppDeps) {
  const app = express();
  const auth = createAuth(authOptions);
  app.set("trust proxy", 1); // behind Render's / any HTTPS proxy
  const router = createApiRouter(db, previews);
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
    const file = previews.screenshotFile(intParam(req.params.id));
    if (!file || !fs.existsSync(file)) throw new HttpError(404, "Captura não encontrada.");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.type("image/jpeg").sendFile(path.resolve(file));
  });

  app.use("/api", (req: Request, res: Response) => {
    const result = router.handle(req.method, req.path, req.query as Record<string, unknown>, req.body ?? {}, req.header("x-user-id"));
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
