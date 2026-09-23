import { ChevronLeft, ChevronRight, ClipboardCheck, ExternalLink, Pencil, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { LINK_TYPE_LABELS, type ContactStatus } from "../../shared/constants";
import type { Lead, LinkPreview } from "../../shared/types";
import { linkLabel } from "../../shared/url";
import { ApiError, api, errorMessage } from "../lib/api";
import { fmtDateTime, fmtPhone, location } from "../lib/format";
import { EvaluationForm } from "./EvaluationForm";
import { ExternalLink2, LinkTypeIcon } from "./Presence";
import { useToast } from "./Toast";
import { ContactBadge, IconButton, PotentialBadge, PreviewBadge, ResponsivePanel } from "./ui";
import { WhatsAppButton } from "./WhatsAppButton";

export const PREVIEW_UNAVAILABLE = "Não foi possível gerar a prévia deste endereço. Abra o link para visualizar.";

interface Props {
  lead: (Lead & { campaign_contact_status?: ContactStatus }) | null;
  onClose: () => void;
  campaign?: { id: number; name: string; message_template: string; message_template_2?: string; message_template_3?: string } | null;
  sendDisabledReason?: string | null;
  onPrev?: (() => void) | null;
  onNext?: (() => void) | null;
  position?: { index: number; total: number } | null;
  onOpened?: (current: ContactStatus) => void;
  onEvaluated?: () => void;
  extraActions?: ReactNode;
}

const BUSY_STATES = new Set(["pending", "processing"]);

/** Visual candidates in priority order: capture > Open Graph > manual cover > branded card. */
export function previewImageCandidates(preview: LinkPreview | null, coverImageUrl: string | null | undefined): string[] {
  return [preview?.screenshot_url, preview?.open_graph_image_url, coverImageUrl].filter((u): u is string => Boolean(u));
}

function PreviewMedia({ preview, lead, loading }: { preview: LinkPreview | null; lead: Lead; loading: boolean }) {
  const candidates = previewImageCandidates(preview, lead.cover_image_url);
  const [index, setIndex] = useState(0);
  const key = candidates.join("|");
  useEffect(() => setIndex(0), [key]);
  const src = candidates[index];
  if (loading && !src) return <div className="preview-media skeleton" aria-label="Carregando prévia" />;
  return (
    <div className="preview-media">
      {src ? (
        <img
          src={src}
          alt={`Prévia de ${preview?.page_title ?? lead.establishment_name}`}
          loading="lazy"
          decoding="async"
          width={480}
          height={300}
          referrerPolicy="no-referrer"
          onError={() => setIndex((i) => i + 1)}
        />
      ) : (
        <div className="preview-fallback" data-testid="preview-fallback">
          <img className="brand" src="/logo-clubn.png" alt="" width={70} height={22} />
          <div className="fb-domain">{preview?.domain ?? linkLabel(preview?.original_url)}</div>
          <div className="fb-type">{LINK_TYPE_LABELS[preview?.link_type ?? "other"]}</div>
        </div>
      )}
    </div>
  );
}

export function PreviewPanel({ lead, onClose, campaign, sendDisabledReason, onPrev, onNext, position, onOpened, onEvaluated, extraActions }: Props) {
  const toast = useToast();
  const [previews, setPreviews] = useState<LinkPreview[] | null>(null);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<number | null>(null);
  const requested = useRef(new Set<string>());
  const leadId = lead?.id;

  const stopPolling = () => {
    if (pollRef.current) window.clearTimeout(pollRef.current);
    pollRef.current = null;
  };

  const mergePreview = (updated: LinkPreview) =>
    setPreviews((list) => (list ?? []).map((p) => (p.original_url === updated.original_url ? updated : p)));

  const poll = useCallback(
    (attempt = 0) => {
      stopPolling();
      if (!leadId || attempt > 25) return;
      pollRef.current = window.setTimeout(async () => {
        try {
          const list = await api.get<LinkPreview[]>(`/leads/${leadId}/previews`);
          setPreviews(list);
          if (list.some((p) => p.refreshing || BUSY_STATES.has(p.preview_status))) poll(attempt + 1);
        } catch {
          /* keep last known state */
        }
      }, 1500);
    },
    [leadId],
  );

  const requestPreview = useCallback(
    async (url: string, force = false) => {
      if (!leadId) return;
      try {
        const result = await api.post<LinkPreview>(`/leads/${leadId}/previews`, { url, force });
        mergePreview(result);
        if (result.refreshing || BUSY_STATES.has(result.preview_status)) poll();
      } catch (e) {
        if (e instanceof ApiError && e.status === 429) {
          const next = (e.details as { next_refresh_allowed_at?: string } | undefined)?.next_refresh_allowed_at;
          toast.show(`${e.message}${next ? ` Disponível às ${new Date(next).toLocaleTimeString("pt-BR")}.` : ""}`);
        } else toast.error(errorMessage(e));
      }
    },
    [leadId, poll, toast],
  );

  // Loads cached previews for this lead only when the panel opens (never for the whole list).
  useEffect(() => {
    stopPolling();
    setPreviews(null);
    setShowEvaluation(false);
    requested.current = new Set();
    if (!leadId) return;
    let active = true;
    api
      .get<LinkPreview[]>(`/leads/${leadId}/previews`)
      .then((list) => {
        if (!active) return;
        setPreviews(list);
        setSelectedUrl(list[0]?.original_url ?? null);
      })
      .catch(() => active && setPreviews([]));
    return () => {
      active = false;
      stopPolling();
    };
  }, [leadId]);

  const selected = previews?.find((p) => p.original_url === selectedUrl) ?? previews?.[0] ?? null;

  // Request the capture of the visible link when it was never requested or is stale.
  useEffect(() => {
    if (!selected || requested.current.has(selected.original_url)) return;
    requested.current.add(selected.original_url);
    if (selected.preview_status === "not_requested" || selected.preview_status === "stale") void requestPreview(selected.original_url);
    else if (selected.refreshing || BUSY_STATES.has(selected.preview_status)) poll();
  }, [selected, requestPreview, poll]);

  if (!lead) return null;
  const contactStatus = lead.campaign_contact_status ?? lead.contact_status;
  const isBusy = Boolean(selected && (selected.refreshing || BUSY_STATES.has(selected.preview_status)));
  const failed = selected && ["blocked", "invalid_link", "error"].includes(selected.preview_status);

  const refresh = async () => {
    if (!selected) return;
    setRefreshing(true);
    await requestPreview(selected.original_url, true);
    setRefreshing(false);
  };

  return (
    <ResponsivePanel
      open={Boolean(lead)}
      title={lead.establishment_name}
      onClose={onClose}
      headerExtra={
        (onPrev !== undefined || onNext !== undefined) && (
          <div className="btn-row" style={{ gap: 4 }}>
            {position && (
              <span className="small muted mono" aria-live="polite">
                {position.index + 1}/{position.total}
              </span>
            )}
            <IconButton label="Lead anterior" disabled={!onPrev} onClick={() => onPrev?.()}>
              <ChevronLeft size={17} />
            </IconButton>
            <IconButton label="Próximo lead" disabled={!onNext} onClick={() => onNext?.()}>
              <ChevronRight size={17} />
            </IconButton>
          </div>
        )
      }
      footer={
        <>
          {selected && (
            <ExternalLink2 url={selected.original_url}>
              <ExternalLink size={15} /> Abrir link
            </ExternalLink2>
          )}
          <WhatsAppButton
            lead={lead}
            templates={
              campaign
                ? [campaign.message_template, campaign.message_template_2, campaign.message_template_3]
                : [lead.active_campaign_message, lead.active_campaign_message_2, lead.active_campaign_message_3]
            }
            campaignId={campaign?.id ?? lead.active_campaign_id ?? null}
            disabledReason={sendDisabledReason}
            onOpened={(r) => onOpened?.(r.current)}
          />
        </>
      }
    >
      {extraActions}
      <dl className="info-list">
        <dt>Segmento</dt>
        <dd>{lead.segment || "—"}</dd>
        <dt>Localização</dt>
        <dd>{location(lead) || "—"}</dd>
        <dt>WhatsApp</dt>
        <dd>
          {fmtPhone(lead.whatsapp, lead.whatsapp_valid === 1)}{" "}
          {lead.whatsapp_valid === 0 && (
            <span className="badge danger">
              <TriangleAlert size={12} /> inválido
            </span>
          )}
        </dd>
        <dt>Status</dt>
        <dd>
          <ContactBadge status={contactStatus} />
        </dd>
        <dt>Potencial</dt>
        <dd>
          <PotentialBadge level={lead.potential_level} />
        </dd>
      </dl>
      {lead.whatsapp_valid === 0 && (
        <div className="notice danger">
          <TriangleAlert size={16} />
          <span>
            WhatsApp inválido: o botão de envio não abrirá o WhatsApp.{" "}
            <Link to={`/leads/${lead.id}/editar`}>
              <strong>Corrigir cadastro</strong>
            </Link>
          </span>
        </div>
      )}

      <section aria-label="Presença digital" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h3 className="eyebrow" style={{ margin: 0 }}>
            Presença digital
          </h3>
          {selected && <PreviewBadge status={isBusy && selected.preview_status !== "available" ? "processing" : selected.preview_status} />}
        </div>
        {previews === null ? (
          <div className="preview-media skeleton" />
        ) : previews.length === 0 ? (
          <div className="notice">Este lead não possui link de presença digital cadastrado.</div>
        ) : (
          <>
            {previews.length > 1 && (
              <div className="link-tabs" role="tablist" aria-label="Links do prospect">
                {previews.map((p) => (
                  <button
                    key={p.original_url}
                    role="tab"
                    aria-selected={p.original_url === selected?.original_url}
                    aria-pressed={p.original_url === selected?.original_url}
                    className="chip"
                    onClick={() => setSelectedUrl(p.original_url)}
                  >
                    <LinkTypeIcon type={p.link_type} size={14} /> {LINK_TYPE_LABELS[p.link_type]}
                  </button>
                ))}
              </div>
            )}
            {selected && (
              <>
                <PreviewMedia preview={selected} lead={lead} loading={isBusy} />
                {isBusy && selected.captured_at && <p className="small muted" style={{ margin: 0 }}>Atualizando… exibindo a última captura.</p>}
                {failed && (
                  <div className={`notice ${selected.preview_status === "blocked" ? "warning" : "danger"}`}>
                    <TriangleAlert size={16} />
                    <span>
                      {PREVIEW_UNAVAILABLE}
                      {selected.error_message && <span className="small" style={{ display: "block", opacity: 0.85 }}>{selected.error_message}</span>}
                    </span>
                  </div>
                )}
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {selected.favicon_url && (
                      <img src={selected.favicon_url} alt="" width={16} height={16} loading="lazy" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = "none")} />
                    )}
                    <strong style={{ overflowWrap: "anywhere" }}>{selected.page_title ?? linkLabel(selected.original_url)}</strong>
                  </div>
                  {selected.page_description && <p className="small" style={{ margin: "6px 0 0", color: "var(--text-2)" }}>{selected.page_description}</p>}
                  <dl className="info-list small" style={{ marginTop: 10 }}>
                    <dt>Tipo</dt>
                    <dd>{LINK_TYPE_LABELS[selected.link_type]}</dd>
                    <dt>Domínio</dt>
                    <dd>{selected.domain ?? "—"}</dd>
                    <dt>Link original</dt>
                    <dd>
                      <a href={selected.original_url} target="_blank" rel="noopener noreferrer">
                        {selected.original_url}
                      </a>
                    </dd>
                    <dt>Atualizado em</dt>
                    <dd>{fmtDateTime(selected.captured_at)}</dd>
                  </dl>
                </div>
                <div className="btn-row">
                  <button className="btn secondary sm" onClick={refresh} disabled={refreshing || isBusy}>
                    <RefreshCw size={15} className={isBusy ? "spin" : ""} /> Atualizar prévia
                  </button>
                  {selected.link_type === "instagram" && (
                    <ExternalLink2 url={selected.original_url}>
                      <ExternalLink size={15} /> Abrir no Instagram
                    </ExternalLink2>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </section>

      <section aria-label="Avaliação" style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: showEvaluation ? 12 : 0 }}>
          <h3 className="eyebrow" style={{ margin: 0 }}>
            Avaliação do prospect
          </h3>
          <button className="btn secondary sm" onClick={() => setShowEvaluation((v) => !v)} aria-expanded={showEvaluation}>
            <ClipboardCheck size={15} /> {showEvaluation ? "Fechar avaliação" : "Avaliar prospect"}
          </button>
        </div>
        {showEvaluation && <EvaluationForm leadId={lead.id} campaignId={campaign?.id} campaignName={campaign?.name} onSaved={() => onEvaluated?.()} />}
      </section>

      <div className="btn-row">
        <Link className="btn ghost sm" to={`/leads/${lead.id}`}>
          Ver cadastro completo
        </Link>
        <Link className="btn ghost sm" to={`/leads/${lead.id}/editar`}>
          <Pencil size={14} /> Editar
        </Link>
      </div>
    </ResponsivePanel>
  );
}
