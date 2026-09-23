// Manual, individual WhatsApp opening. There is NO queue, batch, scheduling or
// automatic sending anywhere in this application: every message is opened by a
// click of the operator (a real link to wa.me) and actually sent — or not —
// inside WhatsApp.

import { DEFAULT_WHATSAPP_MESSAGE, DEFAULT_WHATSAPP_MESSAGES } from "../../shared/constants";
import { buildCampaignMessage, buildWhatsAppUrl, type TemplateLead } from "../../shared/template";

export interface WhatsAppTarget extends TemplateLead {
  whatsapp: string;
  whatsapp_valid?: 0 | 1 | boolean;
}

export type LinkResult = { ok: true; url: string } | { ok: false; error: string };

/** Builds the wa.me link for one lead (number normalized, variables replaced, text URL-encoded). */
export function whatsappLinkFor(lead: WhatsAppTarget, template: string | null | undefined): LinkResult {
  if (lead.whatsapp_valid === 0 || lead.whatsapp_valid === false) {
    return { ok: false, error: "O WhatsApp deste lead é inválido. Corrija o cadastro para enviar a mensagem." };
  }
  const message = buildCampaignMessage(template || DEFAULT_WHATSAPP_MESSAGE, lead);
  const link = buildWhatsAppUrl(lead.whatsapp, message);
  if (!link.ok) return { ok: false, error: `${link.error} Corrija o cadastro para enviar a mensagem.` };
  return { ok: true, url: link.url };
}

/**
 * Picks the campaign message for the rotation type (1, 2 or 3). Campaigns created
 * before the 3-message rule fall back to message 1; outside campaigns, the three
 * default Club'n messages rotate the same way.
 */
export function pickTemplate(templates: (string | null | undefined)[] | null | undefined, type: number): string {
  const list = (templates ?? []).map((t) => (t ?? "").trim());
  if (!list[0]) return DEFAULT_WHATSAPP_MESSAGES[(type - 1) % DEFAULT_WHATSAPP_MESSAGES.length];
  return list[type - 1] || list[0];
}
