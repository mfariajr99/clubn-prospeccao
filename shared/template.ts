import { normalizePhone } from "./phone.js";
import { BRAZIL_STATES } from "./states.js";

export const TEMPLATE_VARIABLES = [
  { key: "nome_estabelecimento", label: "Nome do estabelecimento" },
  { key: "segmento", label: "Segmento" },
  { key: "bairro", label: "Bairro" },
  { key: "cidade", label: "Cidade" },
  { key: "estado", label: "Estado" },
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]["key"];

export interface TemplateLead {
  establishment_name: string;
  segment?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
}

export const SAMPLE_TEMPLATE_LEAD: TemplateLead = {
  establishment_name: "Café Exemplo",
  segment: "Cafeteria",
  neighborhood: "Centro",
  city: "Cidade Exemplo",
  state: "SP",
};

const VARIABLE_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;
const KNOWN = new Set<string>(TEMPLATE_VARIABLES.map((v) => v.key));

/** Returns variables used in the template that the system does not know. */
export function findUnknownVariables(template: string): string[] {
  const unknown = new Set<string>();
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const name = match[1];
    if (!KNOWN.has(name)) unknown.add(name);
  }
  return [...unknown];
}

function valueFor(key: TemplateVariable, lead: TemplateLead): string {
  switch (key) {
    case "nome_estabelecimento":
      return lead.establishment_name ?? "";
    case "segmento":
      return lead.segment ?? "";
    case "bairro":
      return lead.neighborhood ?? "";
    case "cidade":
      return lead.city ?? "";
    case "estado":
      return lead.state ?? "";
  }
}

export interface RenderResult {
  text: string;
  /** Known variables that were empty for this lead. */
  missing: string[];
  unknown: string[];
}

export function renderTemplate(template: string, lead: TemplateLead): RenderResult {
  const missing = new Set<string>();
  const unknown = new Set<string>();
  const text = template.replace(VARIABLE_PATTERN, (whole, rawName: string) => {
    const name = rawName.trim();
    if (!KNOWN.has(name)) {
      unknown.add(name);
      return whole;
    }
    const value = valueFor(name as TemplateVariable, lead).trim();
    if (!value) missing.add(name);
    return value;
  });
  return { text: text.replace(/[ \t]{2,}/g, " "), missing: [...missing], unknown: [...unknown] };
}

/** Builds the final message for a lead (variables replaced). */
export function buildCampaignMessage(template: string, lead: TemplateLead): string {
  return renderTemplate(template, lead).text;
}

export type WhatsAppLinkResult = { ok: true; url: string; phone: string; message: string } | { ok: false; error: string };

/** https://wa.me/<digits>?text=<encoded message>. Never throws. */
export function buildWhatsAppUrl(phone: string | null | undefined, message: string): WhatsAppLinkResult {
  const normalized = normalizePhone(phone && /^\d+$/.test(phone) && phone.length >= 12 ? `+${phone}` : phone);
  if (!normalized.ok) return { ok: false, error: normalized.error };
  const text = message.trim();
  const url = text
    ? `https://wa.me/${normalized.digits}?text=${encodeURIComponent(text)}`
    : `https://wa.me/${normalized.digits}`;
  return { ok: true, url, phone: normalized.digits, message: text };
}

export function stateName(uf: string | null | undefined): string {
  return (uf && BRAZIL_STATES[uf]) || uf || "";
}
