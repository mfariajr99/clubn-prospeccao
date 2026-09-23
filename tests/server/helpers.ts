import request from "supertest";
import { createApp } from "../../server/app";
import { ensureDefaultUser, openDatabase, runMigrations } from "../../server/db/connection";
import { PreviewService, type PreviewServiceOptions } from "../../server/services/preview/previewService";
import type { Transport } from "../../server/services/preview/ssrf";

export function setup(previewOptions: PreviewServiceOptions = {}) {
  const db = openDatabase(":memory:");
  runMigrations(db);
  ensureDefaultUser(db);
  const previews = new PreviewService(db, previewOptions);
  const app = createApp({ db, previews });
  const agent = request(app);
  return { db, previews, app, agent };
}

export const validLead = (overrides: Record<string, unknown> = {}) => ({
  establishment_name: "Café Teste Fictício",
  segment: "Cafeteria",
  neighborhood: "Centro",
  city: "são paulo",
  state: "São Paulo",
  whatsapp: "(11) 90000-1234",
  digital_presence_url: "@cafe.teste.ficticio",
  ...overrides,
});

/** In-memory HTTP transport for preview tests: no real network access. */
export function fakeTransport(routes: Record<string, { status?: number; headers?: Record<string, string>; body?: string; delayMs?: number; hang?: boolean }>): Transport & { calls: string[] } {
  const calls: string[] = [];
  const transport = (async (url: URL, _address: string, signal: AbortSignal): Promise<Awaited<ReturnType<Transport>>> => {
    calls.push(url.toString());
    const route = routes[url.toString()];
    if (!route) return { status: 404, headers: {}, body: (async function* () {})(), destroy() {} };
    if (route.hang) {
      await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    }
    if (route.delayMs) await new Promise((r) => setTimeout(r, route.delayMs));
    const body = Buffer.from(route.body ?? "");
    return {
      status: route.status ?? 200,
      headers: { "content-type": "text/html; charset=utf-8", ...(route.headers ?? {}) },
      body: (async function* () {
        yield body;
      })(),
      destroy() {},
    };
  }) as unknown as Transport & { calls: string[] };
  transport.calls = calls;
  return transport;
}

export const publicResolver = (map: Record<string, string[]> = {}) => async (host: string) => map[host] ?? ["93.184.216.34"];
