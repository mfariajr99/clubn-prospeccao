import { CheckCheck, Copy, Pause, Pencil, Play } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CONTACT_STATUSES, CONTACT_STATUS_LABELS, EDITABLE_CAMPAIGN_STATUSES, type ContactStatus } from "../../shared/constants";
import { SAMPLE_TEMPLATE_LEAD, renderTemplate } from "../../shared/template";
import type { Campaign } from "../../shared/types";
import { CampaignLeadsBoard } from "../components/CampaignLeadsBoard";
import { CampaignProgress, useCampaignActions } from "../components/campaignActions";
import { CampaignBadge, ConfirmDialog, EmptyState, SkeletonRows } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { api } from "../lib/api";
import { fmtDateTime, fmtNumber, pct } from "../lib/format";

interface Results {
  campaign: Campaign;
  byStatus: { status: ContactStatus; total: number }[];
  history: { id: number; establishment_name: string; previous_status: ContactStatus | null; new_status: ContactStatus; event_type: string; notes: string | null; changed_by_name: string | null; changed_at: string }[];
}

export default function CampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "resultados" ? "results" : params.get("tab") === "leads" ? "leads" : "overview";
  const { data: campaign, loading, error, reload, setData } = useAsync((s) => api.get<Campaign>(`/campaigns/${id}`, undefined, s), [id]);
  const results = useAsync((s) => api.get<Results>(`/campaigns/${id}/results`, undefined, s), [id, tab]);
  const actions = useCampaignActions((c) => setData(c));
  const [confirm, setConfirm] = useState<null | "paused" | "completed">(null);

  if (loading && !campaign) return <SkeletonRows rows={8} />;
  if (error || !campaign) return <EmptyState title="Campanha não encontrada" description={error ?? undefined} action={<Link className="btn sm" to="/campanhas">Voltar</Link>} />;

  const templates = [campaign.message_template, campaign.message_template_2 || "", campaign.message_template_3 || ""];
  const total = campaign.lead_count ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="breadcrumb">
            <Link to="/campanhas">Campanhas</Link> / Detalhes
          </div>
          <h1>{campaign.name}</h1>
          <p style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <CampaignBadge status={campaign.status} /> Criada em {fmtDateTime(campaign.created_at)} por {campaign.created_by_name ?? "—"}
          </p>
        </div>
        <div className="btn-row">
          {EDITABLE_CAMPAIGN_STATUSES.includes(campaign.status) && (
            <Link className="btn secondary sm" to={`/campanhas/${campaign.id}/editar`}>
              <Pencil size={15} /> Editar
            </Link>
          )}
          <button className="btn secondary sm" onClick={() => actions.duplicate(campaign)}>
            <Copy size={15} /> Duplicar
          </button>
          {campaign.status === "in_progress" && (
            <>
              <button className="btn secondary sm" onClick={() => setConfirm("paused")}>
                <Pause size={15} /> Pausar
              </button>
              <button className="btn secondary sm" onClick={() => setConfirm("completed")}>
                <CheckCheck size={15} /> Concluir
              </button>
              <button className="btn sm" onClick={() => navigate(`/campanhas/iniciar/${campaign.id}`)}>
                <Play size={15} /> Continuar contatos
              </button>
            </>
          )}
          {(campaign.status === "draft" || campaign.status === "ready") && (
            <button className="btn sm" disabled={!total || actions.busy === campaign.id} onClick={() => actions.setStatus(campaign, "in_progress", true)}>
              <Play size={15} /> Iniciar campanha
            </button>
          )}
          {campaign.status === "paused" && (
            <button className="btn sm" onClick={() => actions.setStatus(campaign, "in_progress", true)}>
              <Play size={15} /> Continuar
            </button>
          )}
        </div>
      </div>

      <div className="tabs" role="tablist">
        {(
          [
            ["overview", "Visão geral", {}],
            ["leads", `Leads (${fmtNumber(total)})`, { tab: "leads" }],
            ["results", "Resultados", { tab: "resultados" }],
          ] as const
        ).map(([key, label, p]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setParams(p, { replace: true })}>
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid-2">
          <section className="card">
            <h2>Mensagens (alternadas 1 → 2 → 3)</h2>
            <p className="card-sub">Exemplo com dados fictícios. Cada lead recebe o texto com seus próprios dados.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {templates.map((t, i) => (
                <div key={i}>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>
                    Mensagem {i + 1}
                  </div>
                  {t.trim() ? (
                    <div className="wa-preview">
                      <div className="wa-bubble">{renderTemplate(t, SAMPLE_TEMPLATE_LEAD).text}</div>
                    </div>
                  ) : (
                    <p className="small muted" style={{ margin: 0 }}>
                      Não definida — será usada a mensagem 1. Edite a campanha para cadastrar.
                    </p>
                  )}
                </div>
              ))}
            </div>
            {campaign.description && (
              <>
                <h3 className="eyebrow" style={{ marginTop: 18 }}>
                  Descrição
                </h3>
                <p style={{ margin: 0 }}>{campaign.description}</p>
              </>
            )}
          </section>
          <section className="card">
            <h2>Progresso</h2>
            <div style={{ margin: "14px 0" }}>
              <CampaignProgress campaign={campaign} />
            </div>
            <dl className="info-list">
              <dt>Leads</dt>
              <dd>{fmtNumber(total)}</dd>
              <dt>WhatsApp aberto</dt>
              <dd>{fmtNumber(campaign.opened_count)}</dd>
              <dt>Contatados</dt>
              <dd>{fmtNumber(campaign.contacted_count)}</dd>
              <dt>Interessados</dt>
              <dd>{fmtNumber(campaign.interested_count)}</dd>
              <dt>Parcerias</dt>
              <dd>{fmtNumber(campaign.partnership_count)}</dd>
              <dt>Última atividade</dt>
              <dd>{fmtDateTime(campaign.last_activity_at ?? campaign.updated_at)}</dd>
            </dl>
          </section>
        </div>
      )}

      {tab === "leads" && (
        <div className="card">
          <CampaignLeadsBoard campaign={campaign} manage onChanged={reload} />
        </div>
      )}

      {tab === "results" && (
        <div className="grid-2">
          <section className="card">
            <h2>Leads por status do contato</h2>
            <p className="card-sub">Status atualizados manualmente pelos operadores.</p>
            {CONTACT_STATUSES.map((s) => {
              const count = results.data?.byStatus.find((b) => b.status === s)?.total ?? 0;
              return (
                <div className="bar-row" key={s}>
                  <span className="small">{CONTACT_STATUS_LABELS[s]}</span>
                  <div className="bar" title={`${CONTACT_STATUS_LABELS[s]}: ${count}`}>
                    <span style={{ width: `${pct(count, total)}%` }} />
                  </div>
                  <span className="small mono" style={{ textAlign: "right" }}>
                    {fmtNumber(count)} · {pct(count, total)}%
                  </span>
                </div>
              );
            })}
          </section>
          <section className="card">
            <h2>Atividade recente</h2>
            {results.data?.history.length ? (
              <ol className="timeline" style={{ marginTop: 12 }}>
                {results.data.history.map((h) => (
                  <li key={h.id}>
                    <span className="t-dot" aria-hidden />
                    <div>
                      <strong>{h.establishment_name}</strong>
                      <div className="small">
                        {h.event_type === "whatsapp_opened" ? "WhatsApp aberto" : `${h.previous_status ? CONTACT_STATUS_LABELS[h.previous_status] : "—"} → ${CONTACT_STATUS_LABELS[h.new_status]}`}
                      </div>
                      <div className="cell-sub">
                        {fmtDateTime(h.changed_at)} · {h.changed_by_name ?? "—"}
                      </div>
                      {h.notes && h.event_type !== "whatsapp_opened" && <div className="small">“{h.notes}”</div>}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">Nenhuma atividade registrada.</p>
            )}
          </section>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm === "completed" ? "Concluir campanha?" : "Pausar campanha?"}
        message={confirm === "completed" ? "Campanhas concluídas não podem ser reabertas nem editadas. Os status e o histórico são mantidos." : "Os botões de envio ficam bloqueados enquanto a campanha estiver pausada."}
        confirmLabel={confirm === "completed" ? "Concluir" : "Pausar"}
        danger={confirm === "completed"}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm) await actions.setStatus(campaign, confirm);
          setConfirm(null);
          results.reload();
        }}
      />
    </>
  );
}
