import type { LinkType } from "./constants.js";
import { normalizePhone } from "./phone.js";
import { normalizeState } from "./states.js";
import { normalizeCity, normalizeLabel, sanitizeText } from "./text.js";
import { normalizeUrl } from "./url.js";

export interface LeadInputRaw {
  establishment_name?: unknown;
  segment?: unknown;
  neighborhood?: unknown;
  city?: unknown;
  state?: unknown;
  whatsapp?: unknown;
  digital_presence_url?: unknown;
  extra_links?: unknown;
  cover_image_url?: unknown;
}

export interface NormalizedLink {
  url: string;
  type: LinkType;
  label: string;
}

export interface NormalizedLead {
  establishment_name: string;
  segment: string;
  neighborhood: string;
  city: string;
  state: string;
  whatsapp: string;
  digital_presence_url: string | null;
  digital_presence_type: LinkType | null;
  extra_links: NormalizedLink[];
  cover_image_url: string | null;
}

export type LeadField = keyof LeadInputRaw;
export type LeadValidation =
  | { ok: true; value: NormalizedLead }
  | { ok: false; errors: Partial<Record<LeadField, string>>; partial: Partial<NormalizedLead> };

/** Normalizes and validates a lead. Used by the form, the importer and the API. */
export function normalizeLeadInput(raw: LeadInputRaw): LeadValidation {
  const errors: Partial<Record<LeadField, string>> = {};
  const partial: Partial<NormalizedLead> = {};

  const name = sanitizeText(raw.establishment_name, 160);
  if (!name) errors.establishment_name = "Nome do estabelecimento não informado.";
  else if (name.length < 2) errors.establishment_name = "Nome do estabelecimento muito curto.";
  partial.establishment_name = name;

  partial.segment = normalizeLabel(raw.segment, 80);
  partial.neighborhood = normalizeLabel(raw.neighborhood, 80);

  const city = normalizeCity(raw.city);
  if (!city) errors.city = "Cidade não informada.";
  partial.city = city;

  const stateRaw = sanitizeText(raw.state, 40);
  if (!stateRaw) errors.state = "Estado não informado.";
  else {
    const uf = normalizeState(stateRaw);
    if (!uf) errors.state = "Estado não reconhecido.";
    partial.state = uf ?? stateRaw;
  }

  const phoneRaw = sanitizeText(raw.whatsapp, 40);
  if (!phoneRaw) errors.whatsapp = "WhatsApp não informado.";
  else {
    const phone = normalizePhone(phoneRaw);
    if (!phone.ok) errors.whatsapp = phone.error === "WhatsApp não informado." ? phone.error : "Número de WhatsApp inválido.";
    partial.whatsapp = phone.ok ? phone.digits : phoneRaw;
  }

  const url = normalizeUrl(raw.digital_presence_url);
  if (!url.ok) errors.digital_presence_url = url.error === "URL inválida." ? "URL inválida." : url.error;
  else if (!url.empty) {
    partial.digital_presence_url = url.url;
    partial.digital_presence_type = url.type;
  } else {
    partial.digital_presence_url = null;
    partial.digital_presence_type = null;
  }

  const extra: NormalizedLink[] = [];
  const extraRaw = Array.isArray(raw.extra_links) ? raw.extra_links : raw.extra_links ? [raw.extra_links] : [];
  for (const item of extraRaw.slice(0, 5)) {
    const result = normalizeUrl(item);
    if (!result.ok) {
      errors.extra_links = `Link adicional inválido: ${result.error}`;
      continue;
    }
    if (!result.empty && result.url !== partial.digital_presence_url && !extra.some((e) => e.url === result.url)) {
      extra.push({ url: result.url, type: result.type, label: result.label });
    }
  }
  partial.extra_links = extra;

  const cover = normalizeUrl(raw.cover_image_url);
  if (!cover.ok) errors.cover_image_url = "URL da imagem inválida.";
  partial.cover_image_url = cover.ok && !cover.empty ? cover.url : null;

  if (Object.keys(errors).length > 0) return { ok: false, errors, partial };
  return { ok: true, value: partial as NormalizedLead };
}
