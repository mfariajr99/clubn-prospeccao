import { MessageCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { ContactStatus } from "../../shared/constants";
import { api, errorMessage } from "../lib/api";
import type { QuotaView } from "../../shared/sendQuota";
import { ApiError } from "../lib/api";
import { pickTemplate, whatsappLinkFor, type WhatsAppTarget } from "../lib/whatsapp";
import { useQuota } from "./Quota";
import { useToast } from "./Toast";

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
 * "Enviar mensagem": opens WhatsApp for THIS lead only, with the personalized
 * message. Afterwards it only records the "WhatsApp aberto" event — it never
 * claims the message was sent.
 */
export function WhatsAppButton({ lead, templates, campaignId, disabledReason: externalReason, variant = "button", size = "sm", onOpened }: Props) {
  const toast = useToast();
  const navigate = useNavigate();
  const label = "Enviar mensagem";
  const quota = useQuota();
  const disabledReason = externalReason ?? quota.lockedReason;
  const messageType = quota.nextMessageType;
  const tooltip = disabledReason ?? `Abrir WhatsApp com a mensagem ${messageType} preenchida`;

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

  const onBlockedClick = () => {
    if (disabledReason) return;
    if (!link.ok) toast.error(link.error, { label: "Corrigir cadastro", onClick: () => navigate(`/leads/${lead.id}/editar`) });
  };

  const enabled = !disabledReason && link.ok;
  const className = variant === "icon" ? "icon-btn whatsapp" : `btn whatsapp ${variant === "block" ? "block" : ""} ${size}`;
  const content =
    variant === "icon" ? (
      <MessageCircle size={17} />
    ) : (
      <>
        <MessageCircle size={16} /> {label}
      </>
    );
  const ariaLabel = `${label}: ${lead.establishment_name}`;

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
