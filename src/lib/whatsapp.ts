// Individual WhatsApp sending. There is NO queue, batch or scheduling anywhere:
// every message comes from one click of the operator — sent directly through the
// operator's connected WhatsApp, or (when not connected) opened via a wa.me link.

import { DEFAULT_WHATSAPP_MESSAGE } from "../../shared/constants";
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

export { pickTemplate } from "../../shared/template";
