// In-browser "server" for the clickable demo: real migrations, seed, API router
// and client accounts running on sql.js, reached through a window.fetch
// interceptor. Data lives only in this browser (localStorage), and can be reset.
import initSqlJs from "sql.js/dist/sql-asm-memory-growth.js";
import type { Database, SqlJsStatic } from "sql.js";
import { createAccounts, createAdminRouter, type Identity, type PasswordHasher } from "../../server/accounts";
import { ensureDefaultUser, runMigrations, type DB } from "../../server/db/core";
import { seed } from "../../server/db/seed";
import { HttpError } from "../../server/lib/http";
import QRCode from "qrcode";
import { createApiRouter, resolveOperator, type ApiResult } from "../../server/router";
import { prepareWhatsAppSend, registerWhatsAppSent } from "../../server/services/leads";
import type { AuthStatus, WhatsAppStatus } from "../../shared/types";
import { adaptSqlJs } from "./sqljsAdapter";
import { createDemoPreviews } from "./demoPreviews";

const PREFIX = "clubn.demo.";
const MAIN_KEY = `${PREFIX}db.v1`;
const IDENTITY_KEY = `${PREFIX}identity`;
const DEMO_ADMIN_PASSWORD = "demo1234";

function load(key: string): Uint8Array | null {
  try {
    const b64 = window.localStorage.getItem(key);
    if (!b64) return null;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function save(key: string, bytes: Uint8Array) {
  try {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    window.localStorage.setItem(key, btoa(bin));
  } catch {
    /* storage unavailable or full: the demo keeps working in memory */
  }
}

export function resetDemoData() {
  try {
    for (const k of Object.keys(window.localStorage)) if (k.startsWith(PREFIX)) window.localStorage.removeItem(k);
    window.sessionStorage.removeItem(IDENTITY_KEY);
  } catch {
    /* ignore */
  }
  window.location.reload();
}

/** A sql.js database persisted under its own localStorage key. */
function openPersistent(SQL: SqlJsStatic, key: string): { db: DB; fresh: boolean; flush: () => void } {
  const stored = load(key);
  let raw: Database;
  try {
    raw = stored ? new SQL.Database(stored) : new SQL.Database();
  } catch {
    raw = new SQL.Database();
  }
  raw.exec("PRAGMA foreign_keys = ON");
  let pending = false;
  const flush = () => save(key, raw.export());
  // Coalesces the writes of one request and persists before the response is handled.
  const scheduleSave = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      flush();
    });
  };
  window.addEventListener("pagehide", flush);
  return { db: adaptSqlJs(raw, scheduleSave), fresh: !stored, flush };
}

// Demo only (data never leaves this browser): a simple reversible encoding.
const demoHasher: PasswordHasher = {
  hash: (password) => `demo$${btoa(unescape(encodeURIComponent(password)))}`,
  verify: (password, stored) => stored === `demo$${btoa(unescape(encodeURIComponent(password)))}`,
};

function readIdentity(): Identity | null {
  try {
    const raw = window.sessionStorage.getItem(IDENTITY_KEY);
    if (raw === null) return { role: "admin" }; // first visit: enters as the admin
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return { role: "admin" };
  }
}
function writeIdentity(identity: Identity | null) {
  try {
    window.sessionStorage.setItem(IDENTITY_KEY, identity ? JSON.stringify(identity) : "");
  } catch {
    /* ignore */
  }
}

export async function startDemoServer(): Promise<void> {
  const SQL = await initSqlJs();
  const main = openPersistent(SQL, MAIN_KEY);
  const db = main.db;
  runMigrations(db);
  ensureDefaultUser(db);
  const hasData = (db.prepare("SELECT COUNT(*) AS c FROM leads").get() as { c: number }).c > 0;
  if (!hasData && main.fresh) seed(db);
  // Previews seeded as "available" are shown as-is; keep them fresh in the demo.
  db.prepare("UPDATE link_previews SET expires_at = ? WHERE preview_status = 'available' AND page_title LIKE 'Bistrô%'").run(new Date(Date.now() + 6 * 864e5).toISOString());
  main.flush();

  const router = createApiRouter(db, createDemoPreviews(db), { canManageUsers: true });
  const accounts = createAccounts(db, {
    hasher: demoHasher,
    openTenant: ({ id, storageKey }) => {
      const t = openPersistent(SQL, `${PREFIX}client.${id}.${storageKey}`);
      return { db: t.db, previews: createDemoPreviews(t.db) };
    },
  });
  const adminRouter = createAdminRouter(accounts);

  let identity = readIdentity();
  if (identity && !accounts.isValid(identity)) identity = null;

  function authRoute(method: string, path: string, body: Record<string, unknown>): ApiResult | null {
    if (path === "/auth/status") {
      const status: AuthStatus = {
        required: true,
        authenticated: Boolean(identity),
        role: identity?.role ?? null,
        account: identity?.role === "client" ? accounts.publicAccount(identity.accountId) : null,
        hint: `Demonstração: entre como administrador com o login admin e a senha ${DEMO_ADMIN_PASSWORD}, ou com um usuário criado em “Novos usuários”.`,
      };
      return { status: 200, body: status };
    }
    if (path === "/auth/logout" && method === "POST") {
      identity = null;
      writeIdentity(null);
      return { status: 200, body: { ok: true } };
    }
    if (path === "/auth/login" && method === "POST") {
      const login = typeof body.login === "string" ? body.login : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (accounts.isAdminLogin(login)) {
        if (password !== DEMO_ADMIN_PASSWORD) return { status: 401, body: { error: "Usuário ou senha incorretos." } };
        identity = { role: "admin" };
      } else {
        const result = accounts.authenticate(login, password);
        if (!result.ok) return { status: 401, body: { error: result.blocked ? "Acesso bloqueado. Fale com o administrador." : "Usuário ou senha incorretos." } };
        identity = result.identity;
      }
      writeIdentity(identity);
      return { status: 200, body: { ok: true, role: identity.role } };
    }
    return null;
  }

  // Simulated WhatsApp connection: the demo never talks to WhatsApp.
  const waSessions = new Map<string, WhatsAppStatus>();
  let demoQr: string | null = null;
  void QRCode.toDataURL("Club'n Prospecção — demonstração: conexão simulada", { margin: 1, width: 280 })
    .then((url) => (demoQr = url))
    .catch(() => undefined);
  const waBlank = (): WhatsAppStatus => ({ state: "disconnected", qr: null, pairing_code: null, phone: null, name: null, error: null, updated_at: new Date().toISOString(), simulated: true });

  function whatsappRoute(method: string, path: string, body: Record<string, unknown>, userId: string | null): ApiResult | null {
    if (!identity || (!path.startsWith("/whatsapp/") && !/^\/leads\/\d+\/whatsapp-send$/.test(path))) return null;
    const ws = identity.role === "client" ? accounts.tenant(identity.accountId) : { db, key: "main" };
    const user = resolveOperator(ws.db, userId);
    const key = `${ws.key}/${user.id}`;
    const current = waSessions.get(key) ?? waBlank();
    const save = (patch: Partial<WhatsAppStatus>) => {
      const next = { ...current, ...patch, updated_at: new Date().toISOString() };
      waSessions.set(key, next);
      return { status: 200, body: next };
    };
    if (path === "/whatsapp/status") return { status: 200, body: current };
    if (path === "/whatsapp/connect" && method === "POST") {
      if (body.method === "code") {
        const digits = String(body.phone ?? "").replace(/\D/g, "");
        if (digits.length < 12) throw new HttpError(422, "Informe o número do WhatsApp com DDI e DDD, ex.: 55 11 91234-5678.", { fields: { phone: "Número inválido." } });
        return save({ state: "pairing", pairing_code: "DEMO-1234", qr: null, error: null });
      }
      return save({ state: "qr", qr: demoQr, pairing_code: null, error: null });
    }
    if (path === "/whatsapp/simulate-link" && method === "POST") {
      return save({ state: "connected", qr: null, pairing_code: null, phone: "5511900000000", name: user.name, error: null });
    }
    if (path === "/whatsapp/disconnect" && method === "POST") {
      waSessions.delete(key);
      return { status: 200, body: waBlank() };
    }
    const send = /^\/leads\/(\d+)\/whatsapp-send$/.exec(path);
    if (send && method === "POST") {
      if (current.state !== "connected") {
        throw new HttpError(409, "Seu WhatsApp não está conectado. Conecte em “Conexão WhatsApp” ou envie pelo WhatsApp do aparelho.", { code: "WA_NOT_CONNECTED" });
      }
      const leadId = Number(send[1]);
      const campaignId = typeof body.campaign_id === "number" ? body.campaign_id : null;
      const prepared = prepareWhatsAppSend(ws.db, { leadId, campaignId, userId: user.id });
      const result = registerWhatsAppSent(ws.db, {
        leadId,
        campaignId,
        userId: user.id,
        messageType: prepared.messageType,
        note: `Mensagem ${prepared.messageType} enviada (simulação da demonstração: nada foi enviado de verdade)`,
      });
      return { status: 200, body: { ...result, sent: true, simulated: true, establishment_name: prepared.establishment_name } };
    }
    return null;
  }

  function dispatch(method: string, path: string, query: Record<string, unknown>, body: unknown, userId: string | null): ApiResult {
    const auth = authRoute(method, path, (body ?? {}) as Record<string, unknown>);
    if (auth) return auth;
    if (path === "/health") return { status: 200, body: { ok: true } };
    if (identity && !accounts.isValid(identity)) {
      identity = null;
      writeIdentity(null);
    }
    if (!identity) return { status: 401, body: { error: "Faça login para continuar.", code: "AUTH_REQUIRED" } };
    const wa = whatsappRoute(method, path, (body ?? {}) as Record<string, unknown>, userId);
    if (wa) return wa;
    if (path.startsWith("/admin/")) {
      if (identity.role !== "admin") throw new HttpError(403, "Acesso restrito ao administrador.");
      return adminRouter.handle(method, path.slice("/admin".length), query, body);
    }
    const target = identity.role === "client" ? accounts.tenant(identity.accountId).router : router;
    return target.handle(method, path, query, body, userId);
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
    const apiIndex = url.pathname.indexOf("/api/");
    if (url.origin !== window.location.origin || apiIndex < 0) return realFetch(input, init);
    const path = url.pathname.slice(apiIndex + 4);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    let body: unknown = {};
    if (init?.body) {
      try {
        body = JSON.parse(String(init.body));
      } catch {
        return json(400, { error: "Requisição inválida." });
      }
    }
    // Small delay so loading states are realistic and the UI never blocks.
    await new Promise((r) => setTimeout(r, 60));
    try {
      const result = dispatch(method, path, Object.fromEntries(url.searchParams), body, headers.get("X-User-Id"));
      if (result.status === 204) return new Response(null, { status: 204 });
      if (result.contentType) return new Response(String(result.body), { status: result.status, headers: { "Content-Type": result.contentType, ...(result.headers ?? {}) } });
      return json(result.status, result.body);
    } catch (error) {
      if (error instanceof HttpError) return json(error.status, { error: error.message, details: error.details });
      console.error(error);
      return json(500, { error: "Erro interno. Tente novamente." });
    }
  };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
