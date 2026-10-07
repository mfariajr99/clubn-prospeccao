import { BarChart3, CalendarClock, CheckCircle2, Megaphone, MessageCircleReply, Play, Send, Target } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { describeRule, fmtBrDateTime } from "../../shared/campaignRule";
import type { CampaignTracking, CampaignTrackingSummary } from "../../shared/types";
import { api, errorMessage } from "../lib/api";
import { fmtNumber, pct } from "../lib/format";
import { CampaignStatusBadge, RuleUsage } from "./campaignActions";
import { useToast } from "./Toast";

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });

/** Reply rate vs the 20% goal (bar scaled so the goal sits in the middle). */
function GoalBar({ replied, sent, goal, label }: { replied: number; sent: number; goal: number; label: string }) {
  const rate = sent ? replied / sent : 0;
  const reached = sent > 0 && rate >= goal;
  const scale = goal * 2; // 0..40%
  return (
    <div className={`goal-bar ${reached ? "ok" : ""}`} role="img" aria-label={`${label}: ${Math.round(rate * 100)}% de retorno, meta ${Math.round(goal * 100)}%`}>
      <div className="goal-track">
        <span className="goal-fill" style={{ width: `${Math.min(100, (rate / scale) * 100)}%` }} />
        <span className="goal-mark" style={{ left: "50%" }} title={`Meta ${Math.round(goal * 100)}%`} />
      </div>
    </div>
  );
}

function TrackingCard({ c, goal, onStarted }: { c: CampaignTracking; goal: number; onStarted: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const rate = c.sent ? c.replied / c.sent : 0;
  const reached = c.sent > 0 && rate >= goal;
  const scheduled = c.status === "ready" && c.rule.phase === "scheduled";

  const start = async () => {
    setBusy(true);
    try {
      await api.post(`/campaigns/${c.id}/status`, { status: "in_progress" });
      toast.success("Campanha iniciada.");
      onStarted();
      navigate(`/campanhas/iniciar/${c.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="track-card" data-testid="tracking-card">
      <div className="track-head">
        <Link to={`/campanhas/${c.id}`} className="cell-title clamp-1" title={c.name}>
          {c.name}
        </Link>
        <div className="track-icons">
          {c.status === "in_progress" || c.status === "paused" ? (
            <Link className="icon-btn" to={`/campanhas/iniciar/${c.id}`} aria-label={`Enviar mensagens: ${c.name}`} data-tooltip="Enviar mensagens">
              <Send size={16} />
            </Link>
          ) : c.status === "completed" ? null : (
            <button className="icon-btn play" onClick={start} disabled={busy || c.total === 0} aria-label={`${scheduled ? "Iniciar agora" : "Iniciar campanha"}: ${c.name}`} data-tooltip={scheduled ? "Iniciar agora" : "Iniciar campanha"}>
              <Play size={16} />
            </button>
          )}
          <Link className="icon-btn" to={`/campanhas/${c.id}?tab=resultados`} aria-label={`Acompanhar: ${c.name}`} data-tooltip="Acompanhar resultados">
            <BarChart3 size={16} />
          </Link>
        </div>
      </div>
      <div className="track-meta">
        <CampaignStatusBadge campaign={c} />
        {c.scheduled_end_at && <span className="cell-sub">até {fmtBrDateTime(c.scheduled_end_at)}</span>}
      </div>

      {c.lots && (
        <div className="track-lot small" data-testid="tracking-lot">
          {c.lots.current
            ? `Lote ${c.lots.current} de ${c.lots.total_lots} · até ${fmtBrDateTime(c.lots.lots.find((l) => l.number === c.lots!.current)!.end)}`
            : c.lots.next_start
              ? `${c.lots.total_lots} ${c.lots.total_lots === 1 ? "lote" : "lotes"} · próximo abre ${fmtBrDateTime(c.lots.next_start)}`
              : `${c.lots.total_lots} ${c.lots.total_lots === 1 ? "lote liberado" : "lotes liberados"}`}
        </div>
      )}
      <div className="track-row">
        <span className="small muted">Enviados</span>
        <span className="mono small">
          {fmtNumber(c.sent)}/{fmtNumber(c.total)} · {pct(c.sent, c.total)}%
        </span>
      </div>
      <div className="progress" role="img" aria-label={`${c.sent} de ${c.total} enviados`}>
        <span style={{ width: `${pct(c.sent, c.total)}%` }} />
      </div>

      <div className="track-row" style={{ marginTop: 10 }}>
        <span className="small muted">Retornos</span>
        <span className={`small ${reached ? "goal-ok" : c.sent ? "goal-below" : "muted"}`}>
          <strong className="mono">{fmtNumber(c.replied)}</strong> · {Math.round(rate * 100)}% {reached ? "✓ meta" : `(meta ${Math.round(goal * 100)}%)`}
        </span>
      </div>
      <GoalBar replied={c.replied} sent={c.sent} goal={goal} label={c.name} />

      <div className="track-foot">
        <span title="Enviados nesta semana / previstos até domingo">
          <CalendarClock size={13} aria-hidden /> Semana: <strong className="mono">{fmtNumber(c.sent_this_week)}</strong>/{fmtNumber(c.planned_this_week)}
        </span>
        {c.rule.limit ? <RuleUsage campaign={c} compact /> : <span className="cell-sub">{describeRule(null, null)}</span>}
      </div>
    </article>
  );
}

export function CampaignTrackingPanel({ tracking, onChanged }: { tracking: CampaignTrackingSummary; onChanged: () => void }) {
  const t = tracking;
  const rate = t.sent_total ? t.replied_total / t.sent_total : 0;
  const goalCount = Math.ceil(t.sent_total * t.reply_goal);
  const missing = Math.max(0, goalCount - t.replied_total);
  const weekEndShown = new Date(Date.parse(t.week_end) - 1);
  return (
    <section aria-labelledby="tracking-title" style={{ marginBottom: 28 }}>
      <div className="section-head">
        <h2 id="tracking-title" className="eyebrow" style={{ margin: 0 }}>
          Acompanhamento das campanhas
        </h2>
        <Link to="/campanhas/nova" className="btn secondary sm">
          <Megaphone size={14} /> Nova campanha
        </Link>
      </div>
      <div className="stat-grid" style={{ marginTop: 12 }}>
        <div className="stat">
          <div className="stat-head">
            <span className="stat-icon">
              <Megaphone size={19} />
            </span>
            <span className="stat-label">Campanhas ativas</span>
          </div>
          <div className="stat-value mono" data-testid="kpi-active">
            {fmtNumber(t.active_campaigns)}
          </div>
          <div className="stat-caption">{t.scheduled_campaigns ? `${fmtNumber(t.scheduled_campaigns)} agendada(s)` : "Nenhuma agendada"}</div>
        </div>
        <div className="stat">
          <div className="stat-head">
            <span className="stat-icon">
              <Send size={19} />
            </span>
            <span className="stat-label">Envios previstos na semana</span>
          </div>
          <div className="stat-value mono" data-testid="kpi-week">
            {fmtNumber(t.planned_this_week)}
          </div>
          <div className="stat-caption">
            {fmtNumber(t.sent_this_week)} enviados · {shortDate(t.week_start)} a {shortDate(weekEndShown.toISOString())}
          </div>
        </div>
        <div className="stat">
          <div className="stat-head">
            <span className="stat-icon">
              <MessageCircleReply size={19} />
            </span>
            <span className="stat-label">Retornos</span>
          </div>
          <div className="stat-value mono" data-testid="kpi-replies">
            {fmtNumber(t.replied_total)}
          </div>
          <div className="stat-caption">de {fmtNumber(t.sent_total)} envios</div>
        </div>
        <div className={`stat goal-stat ${t.sent_total && rate >= t.reply_goal ? "ok" : ""}`}>
          <div className="stat-head">
            <span className="stat-icon">{t.sent_total && rate >= t.reply_goal ? <CheckCircle2 size={19} /> : <Target size={19} />}</span>
            <span className="stat-label">Taxa de retorno · meta {Math.round(t.reply_goal * 100)}%</span>
          </div>
          <div className="stat-value mono" data-testid="kpi-rate">
            {Math.round(rate * 100)}%
          </div>
          <GoalBar replied={t.replied_total} sent={t.sent_total} goal={t.reply_goal} label="Todas as campanhas" />
          <div className="stat-caption">{!t.sent_total ? "Sem envios ainda" : missing ? `Faltam ${fmtNumber(missing)} retorno(s) para a meta` : "Meta atingida"}</div>
        </div>
      </div>

      {t.campaigns.length > 0 ? (
        <div className="track-grid">
          {t.campaigns.map((c) => (
            <TrackingCard key={c.id} c={c} goal={t.reply_goal} onStarted={onChanged} />
          ))}
        </div>
      ) : (
        <div className="card" style={{ marginTop: 14 }}>
          <p className="muted" style={{ margin: 0 }}>
            Nenhuma campanha ativa ou agendada. <Link to="/campanhas/nova">Crie uma campanha</Link> com a regra de disparo e o agendamento.
          </p>
        </div>
      )}
    </section>
  );
}
