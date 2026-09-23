// Team access protection: one shared password (APP_PASSWORD) for the whole
// team. When APP_PASSWORD is not set (local development, tests), access is open.
// Session = signed, HttpOnly cookie. Failed attempts are rate limited per IP.

import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const COOKIE = "clubn_session";
const SESSION_DAYS = 14;
const MAX_FAILS = 8;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

export interface AuthOptions {
  password?: string;
  secret?: string;
  now?: () => number;
}

function sha256(value: string): Buffer {
  return crypto.createHash("sha256").update(value).digest();
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function createAuth(options: AuthOptions = {}) {
  const password = options.password ?? process.env.APP_PASSWORD ?? "";
  const enabled = password.length > 0;
  const secret = options.secret ?? process.env.SESSION_SECRET ?? sha256(`clubn:${password}`).toString("hex");
  const now = options.now ?? (() => Date.now());
  const fails = new Map<string, { count: number; first: number }>();

  const sign = (payload: string) => crypto.createHmac("sha256", secret).update(payload).digest("base64url");

  function isAuthenticated(req: Request): boolean {
    if (!enabled) return true;
    const token = readCookie(req, COOKIE);
    if (!token) return false;
    const [expires, signature] = token.split(".");
    if (!expires || !signature || Number(expires) < now()) return false;
    const expected = Buffer.from(sign(expires));
    const given = Buffer.from(signature);
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  }

  function setSession(req: Request, res: Response) {
    const expires = String(now() + SESSION_DAYS * 24 * 3600 * 1000);
    const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${encodeURIComponent(`${expires}.${sign(expires)}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`,
    );
  }

  /** GET /api/auth/status */
  function status(req: Request, res: Response) {
    res.json({ required: enabled, authenticated: isAuthenticated(req) });
  }

  /** POST /api/auth/login { password } */
  function login(req: Request, res: Response) {
    if (!enabled) return res.json({ ok: true });
    const ip = req.ip ?? "unknown";
    const entry = fails.get(ip);
    if (entry && now() - entry.first > FAIL_WINDOW_MS) fails.delete(ip);
    const current = fails.get(ip);
    if (current && current.count >= MAX_FAILS) {
      return res.status(429).json({ error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." });
    }
    const given = typeof req.body?.password === "string" ? req.body.password : "";
    const ok = crypto.timingSafeEqual(sha256(given), sha256(password));
    if (!ok) {
      fails.set(ip, { count: (current?.count ?? 0) + 1, first: current?.first ?? now() });
      return res.status(401).json({ error: "Senha incorreta." });
    }
    fails.delete(ip);
    setSession(req, res);
    res.json({ ok: true });
  }

  /** POST /api/auth/logout */
  function logout(_req: Request, res: Response) {
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  }

  /** Blocks every other /api route when not authenticated. */
  function guard(req: Request, res: Response, next: NextFunction) {
    if (isAuthenticated(req)) return next();
    res.status(401).json({ error: "Faça login para continuar.", code: "AUTH_REQUIRED" });
  }

  return { enabled, status, login, logout, guard };
}
