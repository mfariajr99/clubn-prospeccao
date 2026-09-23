import { BarChart3, Copy, Eye, Pause, Pencil, Play, Plus, Search, Users } from "lucide-react";
import { ActionMenu, type ActionItem } from "../components/ActionMenu";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CAMPAIGN_STATUSES, CAMPAIGN_STATUS_LABELS, EDITABLE_CAMPAIGN_STATUSES } from "../../shared/constants";
import type { Campaign, Paginated } from "../../shared/types";
import { CampaignProgress, useCampaignActions } from "../components/campaignActions";
import { CampaignBadge, ConfirmDialog, EmptyState, Pagination, SkeletonRows } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { api } from "../lib/api";
import { fmtDate, fmtDateTime, fmtNumber } from "../lib/format";

export default function CampaignsList() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [q, setQ] = useState(params.get("q") ?? "");
  const status = params.get("status") ?? "";
  const page = Number(params.get("page") ?? 1) || 1;
  const [confirmPause, setConfirmPause] = useState<Campaign | null>(null);

  const { data, loading, error, setData } = useAsync((s) => api.get<Paginated<Campaign>>("/campaigns", { q: params.get("q"), status, page, pageSize: 15 }, s), [params.toString()]);
  const actions = useCampaignActions((updated) => setData((d) => (d ? { ...d, items: d.items.map((c) => (c.id === updated.id ? updated : c)) } : d)));

  useEffect(() => {
    const t = window.setTimeout(() => {
      if ((params.get("q") ?? "") !== q) {
        const p = new URLSearchParams(params);
        if (q) p.set("q", q);
        else p.delete("q");
        p.delete("page");
        setParams(p, { replace: true });
      }
    }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== "page") p.delete("page");
    setParams(p, { replace: true });
  };

  const primaryAction = (c: Campaign) => {
    if (c.status === "draft" || c.status === "ready")
      return (
        <button className="btn xs" onClick={() => actions.setStatus(c, "in_progress", true)} disabled={actions.busy === c.id || !c.lead_count} title={!c.lead_count ? "Adicione leads para iniciar" : undefined}>
          <Play size={13} /> Iniciar
        </button>
      );
    if (c.status === "paused")
      return (
        <button className="btn xs" onClick={() => actions.setStatus(c, "in_progress", true)} disabled={actions.busy === c.id}>
          <Play size={13} /> Continuar
        </button>
      );
    if (c.status === "in_progress")
      return (
        <button className="btn xs" onClick={() => navigate(`/campanhas/iniciar/${c.id}`)}>
          <Play size={13} /> Continuar
        </button>
      );
    return (
      <Link className="btn xs secondary" to={`/campanhas/${c.id}?tab=resultados`}>
        <BarChart3 size={13} /> Resultados
      </Link>
    );
  };

  const menuItems = (c: Campaign): ActionItem[] => [
    { label: "Visualizar", icon: <Eye size={15} />, to: `/campanhas/${c.id}` },
    { label: "Editar", icon: <Pencil size={15} />, to: `/campanhas/${c.id}/editar`, hidden: !EDITABLE_CAMPAIGN_STATUSES.includes(c.status) },
    { label: "Consultar leads", icon: <Users size={15} />, to: `/campanhas/${c.id}?tab=leads` },
    { label: "Consultar resultados", icon: <BarChart3 size={15} />, to: `/campanhas/${c.id}?tab=resultados`, hidden: c.status === "completed" },
    { label: "Duplicar", icon: <Copy size={15} />, onClick: () => actions.duplicate(c) },
    { label: "Pausar", icon: <Pause size={15} />, onClick: () => setConfirmPause(c), hidden: c.status !== "in_progress" },
  ];

  const rowActions = (c: Campaign) => (
    <>
      {primaryAction(c)}
      <ActionMenu items={menuItems(c)} label={`Mais ações: ${c.name}`} />
    </>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="breadcrumb">Campanhas</div>
          <h1>Consultar campanhas</h1>
          <p>Acompanhe o progresso de contatos de cada campanha. Incluir um lead não significa que ele foi contatado.</p>
        </div>
        <Link to="/campanhas/nova" className="btn">
          <Plus size={16} /> Criar campanha
        </Link>
      </div>
      <div className="card">
        <div className="toolbar">
          <div className="input-with-icon grow">
            <Search size={16} />
            <input className="input" type="search" placeholder="Buscar campanha" aria-label="Buscar campanha" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="select select-auto" aria-label="Status da campanha" value={status} onChange={(e) => setParam("status", e.target.value)}>
            <option value="">Todos os status</option>
            {CAMPAIGN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CAMPAIGN_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        {error && <div className="notice danger">{error}</div>}
        {loading && !data ? (
          <SkeletonRows rows={5} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState title="Nenhuma campanha encontrada" action={<Link className="btn sm" to="/campanhas/nova">Criar campanha</Link>} />
        ) : (
          <>
            <div className="list-view">
            <div className="table-wrap responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Campanha</th>
                    <th>Leads</th>
                    <th>Status</th>
                    <th>Progresso</th>
                    <th>Atualizada</th>
                    <th style={{ textAlign: "right" }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((c) => (
                    <tr key={c.id}>
                      <td className="col-main">
                        <Link to={`/campanhas/${c.id}`} className="cell-title">
                          {c.name}
                        </Link>
                        {c.description && <div className="cell-sub clamp-1">{c.description}</div>}
                        <div className="cell-sub">
                          Criada em {fmtDate(c.created_at)} · {c.created_by_name ?? "—"}
                        </div>
                      </td>
                      <td className="mono nowrap">{fmtNumber(c.lead_count)}</td>
                      <td>
                        <CampaignBadge status={c.status} />
                      </td>
                      <td>
                        <CampaignProgress campaign={c} />
                      </td>
                      <td className="small">{fmtDateTime(c.last_activity_at ?? c.updated_at)}</td>
                      <td>
                        <div className="actions nowrap">{rowActions(c)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="cards-list">
              {data.items.map((c) => (
                <article className="lead-card" key={c.id}>
                  <div className="lc-head">
                    <Link to={`/campanhas/${c.id}`} className="cell-title">
                      {c.name}
                    </Link>
                    <CampaignBadge status={c.status} />
                  </div>
                  <div className="lc-meta">
                    <span>{fmtNumber(c.lead_count)} leads</span>
                    <span>Criada em {fmtDate(c.created_at)} por {c.created_by_name ?? "—"}</span>
                  </div>
                  <CampaignProgress campaign={c} />
                  <div className="lc-row-actions">{rowActions(c)}</div>
                </article>
              ))}
            </div>
            </div>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setParam("page", String(p))} />
          </>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(confirmPause)}
        title="Pausar campanha?"
        message="Enquanto pausada, os botões de envio ficam bloqueados. Você pode continuar depois."
        confirmLabel="Pausar"
        onCancel={() => setConfirmPause(null)}
        onConfirm={async () => {
          if (confirmPause) await actions.setStatus(confirmPause, "paused");
          setConfirmPause(null);
        }}
      />
    </>
  );
}
