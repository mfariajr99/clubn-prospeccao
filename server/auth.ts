// Access control.
// - Master admin: login "admin" (APP_ADMIN_LOGIN) + APP_PASSWORD. Keeps the
//   original workspace and manages client logins.
// - Clients: logins created by the admin; each one only reaches its own data.
// When APP_PASSWORD is not set (local development, tests) the admin access is
// open, but client logins still work.
// Session = signed, HttpOnly cookie. Failed attempts are rate limited per IP.

import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Accounts, Identity } from "./accounts.js";
import type { AuthStatus } from "../shared/types.js";

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

interface Payload {
  e: number; // expires (ms)
  r: "admin" | "client";
  a?: number; // client account id
  v?: number; // client session version
}

export function createAuth(accounts: Accounts, options: AuthOptions = {}) {
  const password = options.password ?? process.env.APP_PASSWORD ?? "";
  const enabled = password.length > 0;
  const secret = options.secret ?? process.env.SESSION_SECRET ?? sha256(`clubn:${password}`).toString("hex");
  const now = options.now ?? (() => Date.now());
  const fails = new Map<string, { count: number; first: number }>();

  const sign = (payload: string) => crypto.createHmac("sha256", secret).update(payload).digest("base64url");

  function readSession(req: Request): Identity | null {
    const token = readCookie(req, COOKIE);
    if (!token) return null;
    const [body, signature] = token.split(".");
    if (!body || !signature) return null;
    const expected = Buffer.from(sign(body));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    let p: Payload;
    try {
      p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
    } catch {
      return null;
    }
    if (!p || typeof p.e !== "number" || p.e < now()) return null;
    const identity: Identity | null =
      p.r === "admin" ? { role: "admin" } : p.r === "client" && Number.isInteger(p.a) && Number.isInteger(p.v) ? { role: "client", accountId: p.a!, version: p.v! } : null;
    return identity && accounts.isValid(identity) ? identity : null;
  }

  /** Current identity, or null when a login is required. */
  function identify(req: Request): Identity | null {
    const session = readSession(req);
    if (session) return session;
    return enabled ? null : { role: "admin" };
  }

  function setSession(req: Request, res: Response, identity: Identity) {
    const payload: Payload =
      identity.role === "admin" ? { e: now() + SESSION_DAYS * 864e5, r: "admin" } : { e: now() + SESSION_DAYS * 864e5, r: "client", a: identity.accountId, v: identity.version };
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
    res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(`${body}.${sign(body)}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`);
  }

  /** GET /api/auth/status */
  function status(req: Request, res: Response) {
    const identity = identify(req);
    const body: AuthStatus = {
      required: enabled,
      authenticated: Boolean(identity),
      role: identity?.role ?? null,
      account: identity?.role === "client" ? accounts.publicAccount(identity.accountId) : null,
    };
    res.json(body);
  }

  /** POST /api/auth/login { login, password } — empty login means the admin. */
  function login(req: Request, res: Response) {
    const ip = req.ip ?? "unknown";
    const entry = fails.get(ip);
    if (entry && now() - entry.first > FAIL_WINDOW_MS) fails.delete(ip);
    const current = fails.get(ip);
    if (current && current.count >= MAX_FAILS) {
      return res.status(429).json({ error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." });
    }
    const givenLogin = typeof req.body?.login === "string" ? req.body.login : "";
    const given = typeof req.body?.password === "string" ? req.body.password : "";
    const fail = (message = "Usuário ou senha incorretos.") => {
      fails.set(ip, { count: (current?.count ?? 0) + 1, first: current?.first ?? now() });
      return res.status(401).json({ error: message });
    };

    if (accounts.isAdminLogin(givenLogin)) {
      if (enabled && !crypto.timingSafeEqual(sha256(given), sha256(password))) return fail();
      fails.delete(ip);
      setSession(req, res, { role: "admin" });
      return res.json({ ok: true, role: "admin" });
    }
    const result = accounts.authenticate(givenLogin, given);
    if (!result.ok) return fail(result.blocked ? "Acesso bloqueado. Fale com o administrador." : undefined);
    fails.delete(ip);
    setSession(req, res, result.identity);
    res.json({ ok: true, role: "client" });
  }

  /** POST /api/auth/logout */
  function logout(_req: Request, res: Response) {
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  }

  /** Blocks every other /api route when not authenticated; exposes res.locals.identity. */
  function guard(req: Request, res: Response, next: NextFunction) {
    const identity = identify(req);
    if (identity) {
      res.locals.identity = identity;
      return next();
    }
    res.status(401).json({ error: "Faça login para continuar.", code: "AUTH_REQUIRED" });
  }

  return { enabled, status, login, logout, guard };
}
