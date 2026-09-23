// In-browser "server" for the clickable demo: real migrations, seed and API
// router running on sql.js, reached through a window.fetch interceptor.
// Data lives only in this browser (localStorage), and can be reset.
import initSqlJs from "sql.js/dist/sql-asm-memory-growth.js";
import { ensureDefaultUser, runMigrations } from "../../server/db/core";
import { seed } from "../../server/db/seed";
import { HttpError } from "../../server/lib/http";
import { createApiRouter } from "../../server/router";
import { adaptSqlJs } from "./sqljsAdapter";
import { createDemoPreviews } from "./demoPreviews";

const STORAGE_KEY = "clubn.demo.db.v1";

function load(): Uint8Array | null {
  try {
    const b64 = window.localStorage.getItem(STORAGE_KEY);
    if (!b64) return null;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function save(bytes: Uint8Array) {
  try {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    window.localStorage.setItem(STORAGE_KEY, btoa(bin));
  } catch {
    /* storage unavailable or full: the demo keeps working in memory */
  }
}

export function resetDemoData() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  window.location.reload();
}

export async function startDemoServer(): Promise<void> {
  const SQL = await initSqlJs();
  const stored = load();
  let raw;
  try {
    raw = stored ? new SQL.Database(stored) : new SQL.Database();
  } catch {
    raw = new SQL.Database();
  }
  raw.exec("PRAGMA foreign_keys = ON");
  // Coalesces the writes of one request and persists before the response is handled.
  let pending = false;
  const scheduleSave = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      save(raw.export());
    });
  };
  window.addEventListener("pagehide", () => save(raw.export()));
  const db = adaptSqlJs(raw, scheduleSave);
  runMigrations(db);
  ensureDefaultUser(db);
  const hasData = (db.prepare("SELECT COUNT(*) AS c FROM leads").get() as { c: number }).c > 0;
  if (!hasData && !stored) seed(db);
  // Previews seeded as "available" are shown as-is; keep them fresh in the demo.
  db.prepare("UPDATE link_previews SET expires_at = ? WHERE preview_status = 'available' AND page_title LIKE 'Bistrô%'").run(new Date(Date.now() + 6 * 864e5).toISOString());
  save(raw.export());

  const router = createApiRouter(db, createDemoPreviews(db));
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
      const result = router.handle(method, path, Object.fromEntries(url.searchParams), body, headers.get("X-User-Id"));
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
