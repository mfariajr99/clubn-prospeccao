import { Loader2, MessageCircle, Send } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ContactStatus } from "../../shared/constants";
import { api, errorMessage } from "../lib/api";
import type { QuotaView } from "../../shared/sendQuota";
import { ApiError } from "../lib/api";
import { pickTemplate, whatsappLinkFor, type WhatsAppTarget } from "../lib/whatsapp";
import { useQuota } from "./Quota";
import { useToast } from "./Toast";
import { useWhatsApp } from "./WhatsAppStatus";

interface Props {
  lead: WhatsAppTarget & { id: number };
  /** Campaign messages 1, 2 and 3 (rotated per operator). When absent, the default Club'n messages are used. */
  templates?: (string | null | undefined)[] | null;
  campaignId?: number | null;
  /** Disabled with an explanation (e.g. campaign not started). */
  disabledReason?: string | null;
  variant?: "button" | "icon" | "block";
  size?: "sm" | "xs";
  onOpened?: (result: { previous: ContactStatus; current: ContactStatus; opened_at: string }) => void;
}

/**
 * "Enviar mensagem" for THIS lead only (one click = one message):
 * - operator's WhatsApp connected: the message is sent directly and the contact
 *   becomes "Mensagem enviada";
 * - not connected: opens WhatsApp (wa.me) with the message filled in and only
 *   records "WhatsApp aberto" — it never claims the message was sent.
 */
export function WhatsAppButton({ lead, templates, campaignId, disabledReason: externalReason, variant = "button", size = "sm", onOpened }: Props) {
  const toast = useToast();
  const navigate = useNavigate();
  const label = "Enviar mensagem";
  const quota = useQuota();
  const wa = useWhatsApp();
  const [sending, setSending] = useState(false);
  const disabledReason = externalReason ?? quota.lockedReason;
  const messageType = quota.nextMessageType;
  const direct = wa.connected;
  const tooltip =
    disabledReason ?? (direct ? `Enviar a mensagem ${messageType} pelo WhatsApp conectado` : `Abrir WhatsApp com a mensagem ${messageType} preenchida`);

  const link = whatsappLinkFor(lead, pickTemplate(templates, messageType));

  // Opening is done by the browser following a real link (target=_blank):
  // it works on desktop (WhatsApp Web/app) and on phones (WhatsApp app), and
  // is never blocked as a popup. Afterwards only "WhatsApp aberto" is recorded.
  const registerOpened = () => {
    // Defer: the link must be followed with the message of THIS click before the
    // counter (and therefore the next message type) changes.
    window.setTimeout(() => quota.countLocal(), 0);
    api
      .post<{ previous: ContactStatus; current: ContactStatus; opened_at: string; quota?: QuotaView }>(`/leads/${lead.id}/whatsapp-opened`, {
        campaign_id: campaignId ?? null,
        message_type: messageType,
      })
      .then((res) => {
        if (res.quota) quota.apply(res.quota);
        const q = res.quota;
        const note = q?.locked ? " Limite da sessão atingido: os envios ficam pausados." : "";
        toast.show(`WhatsApp aberto com a mensagem ${messageType}. Depois de enviar, atualize o status do contato manualmente.${note}`);
        onOpened?.(res);
      })
      .catch((e) => {
        const q = e instanceof ApiError ? (e.details as { quota?: QuotaView } | undefined)?.quota : undefined;
        if (q) quota.apply(q);
        else quota.refresh();
        toast.error(`WhatsApp aberto, mas o envio não foi registrado: ${errorMessage(e)}`);
      });
  };

  // Direct send through the operator's connected WhatsApp.
  const sendDirect = async () => {
    if (sending) return;
    setSending(true);
    try {
      const res = await api.post<{ previous: ContactStatus; current: ContactStatus; opened_at: string; message_type: number; quota?: QuotaView }>(
        `/leads/${lead.id}/whatsapp-send`,
        { campaign_id: campaignId ?? null },
      );
      if (res.quota) quota.apply(res.quota);
      const note = res.quota?.locked ? " Limite da sessão atingido: os envios ficam pausados." : "";
      toast.success(`Mensagem ${res.message_type} enviada para ${lead.establishment_name}.${note}`);
      onOpened?.(res);
    } catch (e) {
      const details = e instanceof ApiError ? (e.details as { quota?: QuotaView; code?: string } | undefined) : undefined;
      if (details?.quota) quota.apply(details.quota);
      if (details?.code === "WA_NOT_CONNECTED") {
        wa.refresh();
        toast.error(errorMessage(e), { label: "Conectar", onClick: () => navigate("/whatsapp") });
      } else {
        toast.error(`Mensagem não enviada: ${errorMessage(e)}`);
      }
    } finally {
      setSending(false);
    }
  };

  const onBlockedClick = () => {
    if (disabledReason) return;
    if (!link.ok) toast.error(link.error, { label: "Corrigir cadastro", onClick: () => navigate(`/leads/${lead.id}/editar`) });
  };

  const enabled = !disabledReason && link.ok;
  const className = variant === "icon" ? "icon-btn whatsapp" : `btn whatsapp ${variant === "block" ? "block" : ""} ${size}`;
  const Icon = sending ? Loader2 : direct ? Send : MessageCircle;
  const content =
    variant === "icon" ? (
      <Icon size={17} className={sending ? "spin" : undefined} />
    ) : (
      <>
        <Icon size={16} className={sending ? "spin" : undefined} /> {sending ? "Enviando…" : label}
      </>
    );
  const ariaLabel = `${label}: ${lead.establishment_name}`;

  if (enabled && direct) {
    return (
      <button
        type="button"
        className={className}
        onClick={sendDirect}
        disabled={sending}
        aria-busy={sending || undefined}
        aria-label={ariaLabel}
        data-tooltip={variant === "icon" ? tooltip : undefined}
        title={variant === "icon" ? undefined : tooltip}
        data-direct="true"
      >
        {content}
      </button>
    );
  }
  if (enabled && link.ok) {
    return (
      <a
        className={className}
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={ariaLabel}
        data-tooltip={variant === "icon" ? tooltip : undefined}
        title={variant === "icon" ? undefined : tooltip}
        onClick={registerOpened}
      >
        {content}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={className}
      onClick={onBlockedClick}
      aria-disabled={disabledReason ? "true" : undefined}
      aria-label={ariaLabel}
      data-tooltip={variant === "icon" ? tooltip : undefined}
      title={variant === "icon" ? undefined : tooltip}
      style={{ opacity: 0.5, cursor: disabledReason ? "not-allowed" : "pointer" }}
    >
      {content}
    </button>
  );
}
