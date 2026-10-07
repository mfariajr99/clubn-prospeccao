// Client accounts (multi-tenant), runtime-agnostic: used by the Node server and
// by the in-browser demo.
//
// - The master admin (APP_PASSWORD) keeps the original workspace (main database).
// - Each client account gets its OWN database, starting from zero. A client can
//   only ever reach its own database, so it never sees other campaigns or leads.
// - The admin follows each client through numbers only (no leads, no messages).
import { z } from "zod";
import { CONTACTED_STATUSES } from "../shared/constants.js";
import { viewQuota } from "../shared/sendQuota.js";
import type { ClientAccountDetail, ClientAccountSummary, ClientCampaignNumbers, ClientMetrics } from "../shared/types.js";
import { sanitizeText } from "../shared/text.js";
import { nowIso, runMigrations, type DB } from "./db/core.js";
import { HttpError, intParam, parseBody } from "./lib/http.js";
import { createApiRouter, type ApiResult, type ApiRouter, type PreviewProvider, type Query } from "./router.js";

export interface PasswordHasher {
  hash(password: string): string;
  verify(password: string, stored: string): boolean;
}

export type Identity = { role: "admin" } | { role: "client"; accountId: number; version: number };

export interface TenantResources {
  db: DB;
  previews: PreviewProvider & { screenshotFile?(previewId: number): string | null };
}
export interface Tenant extends TenantResources {
  router: ApiRouter;
  /** Stable identifier of the client workspace (used for its WhatsApp sessions). */
  key: string;
}

interface AccountRow {
  id: number;
  name: string;
  login: string;
  password_hash: string;
  active: 0 | 1;
  session_version: number;
  storage_key: string;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

/** The single user that owns a client database (shown as the operator). */
export const CLIENT_OWNER_EMAIL = "conta@cliente.local";
export const ADMIN_LOGIN_DEFAULT = "admin";
const LOGIN_RE = /^[a-z0-9][a-z0-9._@-]{2,59}$/;
const CONTACTED = CONTACTED_STATUSES.map((s) => `'${s}'`).join(",");
const REPLIED = "'replied','interested','not_interested','partnership'";

export const normalizeLogin = (login: string) => login.trim().toLowerCase();

/** Prepares a client database: schema + a single owner user (no team operators). */
export function initClientDb(db: DB, name: string): void {
  runMigrations(db);
  const owner = db.prepare("SELECT id FROM users WHERE email = ?").get(CLIENT_OWNER_EMAIL) as { id: number } | undefined;
  if (owner) {
    db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, owner.id);
    return;
  }
  db.transaction(() => {
    // A brand-new database only contains the default team operators (no data yet).
    db.exec("DELETE FROM operator_send_quota; DELETE FROM users;");
    db.prepare("INSERT INTO users (name, email) VALUES (?, ?)").run(name, CLIENT_OWNER_EMAIL);
  })();
}

/** Numbers of one client database. */
export function clientMetrics(db: DB, now = new Date()): ClientMetrics {
  const one = (sql: string) => (db.prepare(sql).get() as { c: number | null }).c ?? 0;
  const quotas = db.prepare("SELECT * FROM operator_send_quota").all() as {
    cycle_started_at: string | null;
    session_index: number;
    session_count: number;
    total_count: number;
    locked_until: string | null;
  }[];
  const sendsToday = quotas.reduce(
    (sum, r) =>
      sum +
      viewQuota(
        { cycleStartedAt: r.cycle_started_at, sessionIndex: r.session_index, sessionCount: r.session_count, totalCount: r.total_count, lockedUntil: r.locked_until },
        now,
      ).totalCount,
    0,
  );
  const last = db
    .prepare(
      `SELECT MAX(t) AS t FROM (
        SELECT MAX(changed_at) AS t FROM contact_history
        UNION ALL SELECT MAX(updated_at) FROM campaigns
        UNION ALL SELECT MAX(updated_at) FROM leads)`,
    )
    .get() as { t: string | null };
  return {
    leads: one("SELECT COUNT(*) AS c FROM leads"),
    campaigns: one("SELECT COUNT(*) AS c FROM campaigns"),
    campaigns_in_progress: one("SELECT COUNT(*) AS c FROM campaigns WHERE status = 'in_progress'"),
    whatsapp_opened: one("SELECT COUNT(*) AS c FROM contact_history WHERE event_type IN ('whatsapp_opened','whatsapp_sent')"),
    contacted: one(`SELECT COUNT(*) AS c FROM leads WHERE contact_status IN (${CONTACTED})`),
    replied: one(`SELECT COUNT(*) AS c FROM leads WHERE contact_status IN (${REPLIED})`),
    interested: one("SELECT COUNT(*) AS c FROM leads WHERE contact_status IN ('interested','partnership')"),
    partnerships: one("SELECT COUNT(*) AS c FROM leads WHERE contact_status = 'partnership'"),
    sends_today: sendsToday,
    last_activity_at: last?.t ?? null,
  };
}

/** Per-campaign numbers of one client database (no lead data, no message texts). */
export function clientCampaignNumbers(db: DB): ClientCampaignNumbers[] {
  return db
    .prepare(
      `SELECT c.id, c.name, c.status, c.created_at, c.started_at, c.completed_at,
        COUNT(cl.id) AS total,
        SUM(CASE WHEN cl.whatsapp_opened_at IS NOT NULL THEN 1 ELSE 0 END) AS whatsapp_opened,
        SUM(CASE WHEN cl.contact_status IN (${CONTACTED}) THEN 1 ELSE 0 END) AS contacted,
        SUM(CASE WHEN cl.contact_status IN (${REPLIED}) THEN 1 ELSE 0 END) AS replied,
        SUM(CASE WHEN cl.contact_status IN ('interested','partnership') THEN 1 ELSE 0 END) AS interested,
        SUM(CASE WHEN cl.contact_status = 'not_interested' THEN 1 ELSE 0 END) AS not_interested,
        SUM(CASE WHEN cl.contact_status = 'partnership' THEN 1 ELSE 0 END) AS partnerships
       FROM campaigns c LEFT JOIN campaign_leads cl ON cl.campaign_id = c.id
       GROUP BY c.id ORDER BY c.status = 'in_progress' DESC, c.created_at DESC`,
    )
    .all()
    .map((r) => {
      const row = r as ClientCampaignNumbers;
      for (const k of ["whatsapp_opened", "contacted", "replied", "interested", "not_interested", "partnerships"] as const) row[k] = row[k] ?? 0;
      return row;
    });
}

export interface AccountsOptions {
  hasher: PasswordHasher;
  /**
   * Opens (creating if needed) the isolated database of a client account.
   * `storageKey` is random per account, so a database file is never reused by another account.
   */
  openTenant: (account: { id: number; storageKey: string }) => TenantResources;
  adminLogin?: string;
}

export function createAccounts(mainDb: DB, options: AccountsOptions) {
  const { hasher } = options;
  const adminLogin = normalizeLogin(options.adminLogin ?? ADMIN_LOGIN_DEFAULT);
  const tenants = new Map<number, Tenant>();

  const row = (id: number) => mainDb.prepare("SELECT * FROM client_accounts WHERE id = ?").get(id) as AccountRow | undefined;
  const mustRow = (id: number) => {
    const r = row(id);
    if (!r) throw new HttpError(404, "Usuário não encontrado.");
    return r;
  };

  function tenant(accountId: number): Tenant {
    const cached = tenants.get(accountId);
    if (cached) return cached;
    const account = mustRow(accountId);
    const resources = options.openTenant({ id: account.id, storageKey: account.storage_key });
    initClientDb(resources.db, account.name);
    const t: Tenant = {
      ...resources,
      key: `cliente-${account.id}-${account.storage_key}`,
      router: createApiRouter(resources.db, resources.previews, { canManageUsers: false }),
    };
    tenants.set(accountId, t);
    return t;
  }

  const summary = (r: AccountRow): ClientAccountSummary => ({
    id: r.id,
    name: r.name,
    login: r.login,
    active: r.active === 1,
    created_at: r.created_at,
    last_login_at: r.last_login_at,
    metrics: clientMetrics(tenant(r.id).db),
  });

  function validatePassword(password: string) {
    if (password.length < 8) throw new HttpError(422, "A senha precisa ter pelo menos 8 caracteres.", { fields: { password: "Mínimo de 8 caracteres." } });
    if (password.length > 200) throw new HttpError(422, "Senha muito longa.", { fields: { password: "Senha muito longa." } });
  }

  /** Workspace by its key ("cliente-<id>-<storage>"), used by background WhatsApp events. */
  function tenantByKey(key: string): Tenant | null {
    const m = /^cliente-(\d+)-([0-9a-f]+)$/.exec(key);
    if (!m) return null;
    const r = row(Number(m[1]));
    if (!r || r.storage_key !== m[2]) return null;
    return tenant(r.id);
  }

  return {
    adminLogin,
    tenant,
    tenantByKey,

    isAdminLogin(login: string | undefined | null) {
      return !login || !login.trim() || normalizeLogin(login) === adminLogin;
    },

    /** Checks client credentials. Returns null for wrong login/password. */
    authenticate(login: string, password: string): { ok: true; identity: Identity; name: string } | { ok: false; blocked: boolean } {
      const r = mainDb.prepare("SELECT * FROM client_accounts WHERE login = ?").get(normalizeLogin(login)) as AccountRow | undefined;
      // Always run the hash to keep timing similar for unknown logins.
      const valid = hasher.verify(password, r?.password_hash ?? "scrypt$00$00");
      if (!r || !valid) return { ok: false, blocked: false };
      if (!r.active) return { ok: false, blocked: true };
      mainDb.prepare("UPDATE client_accounts SET last_login_at = ? WHERE id = ?").run(nowIso(), r.id);
      return { ok: true, identity: { role: "client", accountId: r.id, version: r.session_version }, name: r.name };
    },

    /** A client session stays valid only while the account is active and its password unchanged. */
    isValid(identity: Identity): boolean {
      if (identity.role === "admin") return true;
      const r = row(identity.accountId);
      return Boolean(r && r.active === 1 && r.session_version === identity.version);
    },

    publicAccount(accountId: number) {
      const r = row(accountId);
      return r ? { id: r.id, name: r.name, login: r.login } : null;
    },

    list(): ClientAccountSummary[] {
      return (mainDb.prepare("SELECT * FROM client_accounts ORDER BY active DESC, name COLLATE NOCASE").all() as AccountRow[]).map(summary);
    },

    detail(id: number): ClientAccountDetail {
      const r = mustRow(id);
      return { ...summary(r), campaigns: clientCampaignNumbers(tenant(id).db) };
    },

    create(input: { name: string; login: string; password: string }): ClientAccountSummary {
      const name = sanitizeText(input.name, 80);
      const login = normalizeLogin(input.login);
      const fields: Record<string, string> = {};
      if (name.length < 2) fields.name = "Informe o nome (mínimo 2 caracteres).";
      if (!LOGIN_RE.test(login)) fields.login = "Use de 3 a 60 caracteres: letras minúsculas, números, ponto, hífen, _ ou @ (sem espaços).";
      else if (login === adminLogin) fields.login = "Este login é reservado ao administrador.";
      if (input.password.length < 8) fields.password = "Mínimo de 8 caracteres.";
      if (Object.keys(fields).length) throw new HttpError(422, "Verifique os campos destacados.", { fields });
      validatePassword(input.password);
      if (mainDb.prepare("SELECT 1 FROM client_accounts WHERE login = ?").get(login)) {
        throw new HttpError(409, "Já existe um usuário com este login.", { fields: { login: "Login já em uso." } });
      }
      const storageKey = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
      const info = mainDb
        .prepare("INSERT INTO client_accounts (name, login, password_hash, storage_key) VALUES (?, ?, ?, ?)")
        .run(name, login, hasher.hash(input.password), storageKey);
      const id = Number(info.lastInsertRowid);
      tenant(id); // creates the empty, isolated database right away
      return summary(mustRow(id));
    },

    update(id: number, input: { name?: string; active?: boolean }): ClientAccountSummary {
      const r = mustRow(id);
      const name = input.name !== undefined ? sanitizeText(input.name, 80) : r.name;
      if (name.length < 2) throw new HttpError(422, "Informe o nome (mínimo 2 caracteres).", { fields: { name: "Mínimo de 2 caracteres." } });
      const active = input.active === undefined ? r.active : input.active ? 1 : 0;
      // Blocking ends the client's open sessions immediately.
      const version = active === 0 && r.active === 1 ? r.session_version + 1 : r.session_version;
      mainDb.prepare("UPDATE client_accounts SET name = ?, active = ?, session_version = ?, updated_at = ? WHERE id = ?").run(name, active, version, nowIso(), id);
      if (name !== r.name) initClientDb(tenant(id).db, name);
      return summary(mustRow(id));
    },

    resetPassword(id: number, password: string): void {
      const r = mustRow(id);
      validatePassword(password);
      // New password: the client must log in again on every device.
      mainDb.prepare("UPDATE client_accounts SET password_hash = ?, session_version = ?, updated_at = ? WHERE id = ?").run(hasher.hash(password), r.session_version + 1, nowIso(), id);
    },
  };
}

export type Accounts = ReturnType<typeof createAccounts>;

/** Admin-only API (served under /api/admin). */
export function createAdminRouter(accounts: Accounts) {
  const ok = (status: number, body: unknown): ApiResult => ({ status, body });
  const createSchema = z.object({ name: z.string().max(200), login: z.string().max(200), password: z.string().max(400) });
  const updateSchema = z.object({ name: z.string().max(200).optional(), active: z.boolean().optional() });
  const passwordSchema = z.object({ password: z.string().max(400) });

  function handle(method: string, path: string, _query: Query, body: unknown): ApiResult {
    if (method === "GET" && path === "/clients") return ok(200, accounts.list());
    if (method === "POST" && path === "/clients") return ok(201, accounts.create(parseBody(createSchema, body)));
    const m = /^\/clients\/([^/]+)(\/password)?$/.exec(path);
    if (m) {
      const id = intParam(m[1]);
      if (m[2] && method === "POST") {
        accounts.resetPassword(id, parseBody(passwordSchema, body).password);
        return ok(200, { ok: true });
      }
      if (!m[2] && method === "GET") return ok(200, accounts.detail(id));
      if (!m[2] && method === "PUT") return ok(200, accounts.update(id, parseBody(updateSchema, body)));
    }
    throw new HttpError(404, "Rota não encontrada.");
  }
  return { handle };
}
