import { Download, Globe, ImageOff, Megaphone, MessageCircle, Plus, Sparkles, Star, Unlink, Upload, UserCheck, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { POTENTIAL_LABELS } from "../../shared/constants";
import type { DashboardMetrics } from "../../shared/types";
import { CampaignBadge, EmptyState, SkeletonRows } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { api } from "../lib/api";
import { fmtNumber, pct } from "../lib/format";

function Stat({ icon, label, value, caption, to }: { icon: ReactNode; label: string; value: number; caption?: string; to?: string }) {
  const body = (
    <>
      <div className="stat-head">
        <span className="stat-icon">{icon}</span>
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value mono">{fmtNumber(value)}</div>
      {caption && <div className="stat-caption">{caption}</div>}
    </>
  );
  return to ? (
    <Link className="stat" to={to}>
      {body}
    </Link>
  ) : (
    <div className="stat">{body}</div>
  );
}

export default function Dashboard() {
  const { data: m, loading, error } = useAsync((s) => api.get<DashboardMetrics>("/dashboard", undefined, s), []);

  if (loading && !m) return <SkeletonRows rows={6} height={90} />;
  if (error || !m) return <div className="notice danger">{error ?? "Não foi possível carregar as métricas."}</div>;

  const contactedPct = pct(m.contacted, m.total_leads);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Visão geral</h1>
          <p>Indicadores calculados com os dados reais de leads, campanhas e contatos.</p>
        </div>
        <div className="btn-row">
          <Link to="/leads/importar" className="btn secondary">
            <Upload size={16} /> Importar prospects
          </Link>
          <Link to="/campanhas/nova" className="btn">
            <Plus size={16} /> Criar campanha
          </Link>
        </div>
      </div>

      {m.total_leads === 0 ? (
        <div className="card">
          <EmptyState
            title="Comece cadastrando seus leads"
            description="Cadastre um lead ou importe uma planilha de prospects para criar sua primeira campanha."
            action={
              <div className="btn-row" style={{ justifyContent: "center" }}>
                <Link className="btn sm" to="/leads/novo">
                  Cadastrar lead
                </Link>
                <Link className="btn secondary sm" to="/leads/importar">
                  <Download size={14} /> Importar planilha
                </Link>
              </div>
            }
          />
        </div>
      ) : (
        <>
          <section className="hero" aria-label="Leads contatados">
            <div>
              <div className="hero-label">Leads contatados</div>
              <div className="hero-value mono">
                {fmtNumber(m.contacted)} <small>/ {fmtNumber(m.total_leads)}</small>
              </div>
              <div className="hero-caption">
                {fmtNumber(m.interested)} interessados · {fmtNumber(m.partnerships)} parcerias concluídas
              </div>
            </div>
            <div className="hero-side">
              <div className="hero-pct mono">{contactedPct}%</div>
              <div className="hero-label">da base contatada</div>
            </div>
            <div className="hero-bar" role="img" aria-label={`${contactedPct}% da base contatada`}>
              <span style={{ width: `${contactedPct}%` }} />
            </div>
          </section>

          <h2 className="eyebrow" style={{ marginTop: 28 }}>
            Base de leads
          </h2>
          <div className="stat-grid">
            <Stat icon={<Users size={19} />} label="Total de leads" value={m.total_leads} to="/leads" />
            <Stat icon={<UserCheck size={19} />} label="Prospects" value={m.total_prospects} caption="Status cadastral “Prospect”" to="/leads?registration_status=prospect" />
            <Stat icon={<Upload size={19} />} label="Prospects importados" value={m.imported_prospects} caption="Origem: planilha" />
            <Stat icon={<Globe size={19} />} label="Com presença digital" value={m.with_presence} to="/leads?presence=with" />
            <Stat icon={<Unlink size={19} />} label="Sem link" value={m.without_link} to="/leads?presence=without" />
            <Stat icon={<Star size={19} />} label="Avaliados" value={m.evaluated} caption={`${fmtNumber(m.high_potential)} de alto potencial`} to="/leads?potential=high" />
          </div>

          <h2 className="eyebrow" style={{ marginTop: 28 }}>
            Acompanhamento
          </h2>
          <div className="stat-grid">
            <Stat icon={<Megaphone size={19} />} label="Campanhas em andamento" value={m.campaigns_in_progress} to="/campanhas?status=in_progress" />
            <Stat icon={<MessageCircle size={19} />} label="Leads contatados" value={m.contacted} caption="Confirmados manualmente pelo operador" />
            <Stat icon={<Sparkles size={19} />} label="Interessados" value={m.interested} to="/leads?contact_status=interested" />
            <Stat icon={<ImageOff size={19} />} label="Prévias com erro ou desatualizadas" value={m.previews_problem} />
          </div>

          <div className="grid-halves" style={{ marginTop: 18 }}>
            <section className="card">
              <h2>Conversão por potencial</h2>
              <p className="card-sub">Interessados ou parceria concluída, por nível de avaliação manual.</p>
              {m.conversion_by_potential.map((row) => (
                <div className="bar-row" key={row.level}>
                  <span className="small">{POTENTIAL_LABELS[row.level]}</span>
                  <div className="bar" title={`${row.interested} de ${row.total} (${pct(row.interested, row.total)}%)`}>
                    <span style={{ width: `${pct(row.interested, row.total)}%` }} />
                  </div>
                  <span className="small mono" style={{ textAlign: "right" }}>
                    {pct(row.interested, row.total)}% · {fmtNumber(row.interested)}/{fmtNumber(row.total)}
                  </span>
                </div>
              ))}
            </section>
            <section className="card">
              <h2>Conversão por campanha</h2>
              <p className="card-sub">Interessados ou parceria concluída sobre o total de leads da campanha.</p>
              {m.conversion_by_campaign.length === 0 ? (
                <p className="muted">Nenhuma campanha criada.</p>
              ) : (
                <ul className="metric-list">
                  {m.conversion_by_campaign.map((c) => (
                    <li key={c.id}>
                      <div className="ml-main">
                        <Link className="cell-title" to={`/campanhas/${c.id}`}>
                          {c.name}
                        </Link>
                        <CampaignBadge status={c.status} />
                      </div>
                      <div className="ml-figures">
                        <span>
                          <strong className="mono">
                            {fmtNumber(c.contacted)}/{fmtNumber(c.total)}
                          </strong>{" "}
                          contatados
                        </span>
                        <span>
                          <strong className="mono">{pct(c.interested, c.total)}%</strong> conversão · {fmtNumber(c.partnerships)} parcerias
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
