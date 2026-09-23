import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { ToastProvider } from "../../src/components/Toast";

export function renderWithProviders(ui: ReactNode, route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>,
  );
}

type Handler = (url: string, init?: RequestInit) => unknown;

/** Minimal fetch router: returns JSON for /api/* calls and records them. */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.includes(" ") ? k.split(" ") : ["GET", k];
      return m === method && url.split("?")[0] === p;
    });
    if (!key) return new Response(JSON.stringify({ error: "not mocked" }), { status: 404 });
    const result = routes[key](url, init);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result ?? {}), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

export function setViewport(mobile: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: mobile && query.includes("max-width"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })),
  );
}

export const sampleLead = {
  id: 7,
  establishment_name: "Café & Cia Fictício",
  segment: "Cafeteria",
  neighborhood: "Centro",
  city: "Campinas",
  state: "SP",
  whatsapp: "5519900000001",
  whatsapp_valid: 1 as const,
  digital_presence_url: "https://cafe.example.com/",
  digital_presence_type: "site" as const,
  cover_image_url: null,
  registration_status: "prospect" as const,
  contact_status: "not_contacted" as const,
  source: "manual" as const,
  import_batch_id: null,
  created_by: 1,
  created_at: "2026-09-20T10:00:00.000Z",
  updated_at: "2026-09-20T10:00:00.000Z",
  potential_level: null,
  links: [{ id: 1, lead_id: 7, url: "https://cafe.example.com/", link_type: "site" as const, is_primary: 1 as const }],
};
