import { Eye, ListPlus, Pencil, RefreshCcw } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CONTACT_STATUS_LABELS, LEAD_SOURCE_LABELS, LINK_TYPE_LABELS, POTENTIAL_LABELS, QUALITY_LABELS, type CampaignStatus, type ContactStatus } from "../../shared/constants";
import type { ContactHistoryEntry, Evaluation, Lead } from "../../shared/types";
import { AddToCampaignDialog } from "../components/AddToCampaignDialog";
import { ContactStatusDialog } from "../components/ContactStatusDialog";
import { PresenceCell } from "../components/Presence";
import { PreviewPanel } from "../components/PreviewPanel";
import { CampaignBadge, ContactBadge, EmptyState, PotentialBadge, RegistrationBadge, SkeletonRows } from "../components/ui";
import { WhatsAppButton } from "../components/WhatsAppButton";
import { useAsync } from "../hooks/useAsync";
import { api } from "../lib/api";
import { fmtDate, fmtDateTime, fmtPhone } from "../lib/format";

type LeadDetailData = Lead & {
  campaigns: { id: number; name: string; status: CampaignStatus; contact_status: ContactStatus; last_contact_at: string | null }[];
  evaluations: Evaluation[];
};

export default function LeadDetail() {
  const { id } = useParams();
  const { data: lead, loading, error, reload } = useAsync((s) => api.get<LeadDetailData>(`/leads/${id}`, undefined, s), [id]);
  const history = useAsync((s) => api.get<ContactHistoryEntry[]>(`/leads/${id}/history`, undefined, s), [id]);
  const [preview, setPreview] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  if (loading && !lead) return <SkeletonRows rows={8} />;
  if (error || !lead) return <EmptyState title="Lead não encontrado" description={error ?? undefined} action={<Link className="btn sm" to="/leads">Voltar para leads</Link>} />;

  const refreshAll = () => {
    reload();
    history.reload();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="breadcrumb">
            <Link to="/leads">Leads</Link> / Detalhes
          </div>
          <h1>{lead.establishment_name}</h1>
          <p style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <RegistrationBadge status={lead.registration_status} /> <ContactBadge status={lead.contact_status} /> <PotentialBadge level={lead.potential_level} />
          </p>
        </div>
        <div className="btn-row">
          <Link to={`/leads/${lead.id}/editar`} className="btn secondary sm">
            <Pencil size={15} /> Editar
          </Link>
          <button className="btn secondary sm" onClick={() => setAddOpen(true)}>
            <ListPlus size={15} /> Adicionar a campanha
          </button>
          <button className="btn secondary sm" onClick={() => setStatusOpen(true)}>
            <RefreshCcw size={15} /> Atualizar status
          </button>
          <WhatsAppButton lead={lead} templates={[lead.active_campaign_message, lead.active_campaign_message_2, lead.active_campaign_message_3]} campaignId={lead.active_campaign_id} onOpened={refreshAll} />
        </div>
      </div>
      {lead.active_campaign_name && (
        <div className="notice" style={{ marginBottom: 16 }}>
          “Enviar mensagem” usará as mensagens (alternadas) da campanha em andamento <strong>&nbsp;{lead.active_campaign_name}</strong>.
        </div>
      )}

      <div className="grid-2">
        <div>
          <section className="card">
            <h2>Dados cadastrais</h2>
            <dl className="info-list" style={{ marginTop: 14 }}>
              <dt>Segmento</dt>
              <dd>{lead.segment || "—"}</dd>
              <dt>Bairro</dt>
              <dd>{lead.neighborhood || "—"}</dd>
              <dt>Cidade/UF</dt>
              <dd>
                {lead.city}/{lead.state}
              </dd>
              <dt>WhatsApp</dt>
              <dd>
                {fmtPhone(lead.whatsapp, lead.whatsapp_valid === 1)} {lead.whatsapp_valid === 0 && <span className="badge danger">inválido — corrija o cadastro</span>}
              </dd>
              <dt>Origem</dt>
              <dd>
                {LEAD_SOURCE_LABELS[lead.source]}
                {lead.import_batch_id && (
                  <>
                    {" · "}
                    <Link to={`/leads?batch_id=${lead.import_batch_id}`}>
                      lote #{lead.import_batch_id} ({lead.import_batch_filename})
                    </Link>
                  </>
                )}
              </dd>
              <dt>Cadastrado em</dt>
              <dd>
                {fmtDateTime(lead.created_at)} {lead.created_by_name ? `por ${lead.created_by_name}` : ""}
              </dd>
            </dl>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Presença digital</h2>
              {lead.links && lead.links.length > 0 && (
                <button className="btn secondary sm" onClick={() => setPreview(true)}>
                  <Eye size={15} /> Ver prévia
                </button>
              )}
            </div>
            {lead.links && lead.links.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {lead.links.map((l) => (
                  <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <PresenceCell url={l.url} type={l.link_type} onPreview={() => setPreview(true)} />
                    <span className="badge">{l.is_primary ? "Principal" : LINK_TYPE_LABELS[l.link_type]}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">Nenhum link cadastrado.</p>
            )}
          </section>

          <section className="card">
            <h2>Histórico de contato</h2>
            <p className="card-sub">Mudanças de status registradas manualmente e aberturas do WhatsApp.</p>
            {history.loading && !history.data ? (
              <SkeletonRows rows={3} />
            ) : history.data && history.data.length ? (
              <ol className="timeline">
                {history.data.map((h) => (
                  <li key={h.id}>
                    <span className="t-dot" aria-hidden />
                    <div>
                      <div>
                        {h.previous_status && h.previous_status !== h.new_status ? (
                          <>
                            {CONTACT_STATUS_LABELS[h.previous_status]} → <strong>{CONTACT_STATUS_LABELS[h.new_status]}</strong>
                          </>
                        ) : (
                          <strong>{h.notes?.startsWith("WhatsApp aberto") ? `WhatsApp aberto${h.message_type ? ` · mensagem ${h.message_type}` : ""}` : CONTACT_STATUS_LABELS[h.new_status]}</strong>
                        )}
                      </div>
                      <div className="cell-sub">
                        {fmtDateTime(h.changed_at)} · {h.changed_by_name ?? "—"}
                        {h.campaign_name ? ` · ${h.campaign_name}` : ""}
                      </div>
                      {h.notes && !h.notes.startsWith("WhatsApp aberto") && <div className="small" style={{ marginTop: 2 }}>“{h.notes}”</div>}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">Nenhum registro ainda.</p>
            )}
          </section>
        </div>

        <div>
          <section className="card">
            <h2>Campanhas</h2>
            {lead.campaigns.length ? (
              <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {lead.campaigns.map((c) => (
                  <li key={c.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <Link className="cell-title" to={`/campanhas/${c.id}`}>
                      {c.name}
                    </Link>
                    <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <CampaignBadge status={c.status} /> <ContactBadge status={c.contact_status} />
                    </span>
                    <span className="cell-sub">Último contato: {fmtDate(c.last_contact_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Este lead não está em nenhuma campanha.</p>
            )}
          </section>
          <section className="card">
            <h2>Avaliações</h2>
            {lead.evaluations.length ? (
              lead.evaluations.map((e) => (
                <div key={e.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 10 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <PotentialBadge level={e.potential_level} /> <span className="small">Nota {e.score}/5</span>
                    <span className="badge outline">{e.campaign_id ? "Campanha" : "Geral"}</span>
                  </div>
                  <div className="cell-sub" style={{ marginTop: 4 }}>
                    {e.evaluator_name} · {fmtDateTime(e.updated_at)}
                  </div>
                  {e.digital_presence_quality && <div className="small">Presença digital: {QUALITY_LABELS[e.digital_presence_quality]}</div>}
                  {e.notes && <div className="small" style={{ marginTop: 4 }}>“{e.notes}”</div>}
                </div>
              ))
            ) : (
              <p className="muted">{POTENTIAL_LABELS.none}. Use “Ver prévia” → “Avaliar prospect”.</p>
            )}
          </section>
        </div>
      </div>

      <PreviewPanel lead={preview ? lead : null} onClose={() => setPreview(false)} onOpened={refreshAll} onEvaluated={reload} />
      <ContactStatusDialog open={statusOpen} leadId={lead.id} leadName={lead.establishment_name} current={lead.contact_status} onClose={() => setStatusOpen(false)} onSaved={refreshAll} />
      <AddToCampaignDialog open={addOpen} selection={{ leadIds: [lead.id], count: 1 }} onClose={() => setAddOpen(false)} onDone={reload} />
    </>
  );
}
