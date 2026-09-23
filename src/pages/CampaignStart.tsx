import { Megaphone, Play } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Campaign, Paginated } from "../../shared/types";
import { CampaignLeadsBoard } from "../components/CampaignLeadsBoard";
import { CampaignProgress, useCampaignActions } from "../components/campaignActions";
import { CampaignBadge, EmptyState, SkeletonRows } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { api } from "../lib/api";
import { fmtNumber } from "../lib/format";

/** "Iniciar campanhas": pick a ready/in-progress campaign and work its leads one by one. */
export default function CampaignStart() {
  const { id } = useParams();
  const navigate = useNavigate();
  const list = useAsync((s) => api.get<Paginated<Campaign>>("/campaigns", { statuses: "ready,in_progress,paused", pageSize: 100, sort: "updated_at" }, s), []);
  const selected = useAsync((s) => (id ? api.get<Campaign>(`/campaigns/${id}`, undefined, s) : Promise.resolve(null)), [id]);
  const actions = useCampaignActions((c) => {
    selected.setData(c);
    list.reload();
  });

  const campaign = selected.data;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="breadcrumb">Campanhas</div>
          <h1>Iniciar campanhas</h1>
          <p>Selecione uma campanha e contate cada lead individualmente. Cada clique em “Enviar mensagem” abre o WhatsApp daquele contato — nada é enviado automaticamente.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <label htmlFor="campaign-select" style={{ fontWeight: 600 }}>
            Campanha
          </label>
          <select
            id="campaign-select"
            className="select grow"
            value={id ?? ""}
            onChange={(e) => navigate(e.target.value ? `/campanhas/iniciar/${e.target.value}` : "/campanhas/iniciar")}
          >
            <option value="">Selecione uma campanha pronta ou em andamento…</option>
            {list.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {fmtNumber(c.lead_count)} leads
              </option>
            ))}
            {campaign && !list.data?.items.some((c) => c.id === campaign.id) && <option value={campaign.id}>{campaign.name}</option>}
          </select>
        </div>
      </div>

      {!id ? (
        list.loading ? (
          <SkeletonRows rows={3} />
        ) : list.data?.items.length ? (
          <div className="stat-grid">
            {list.data.items.map((c) => (
              <Link key={c.id} className="stat" to={`/campanhas/iniciar/${c.id}`}>
                <div className="stat-head">
                  <span className="stat-icon">
                    <Megaphone size={18} />
                  </span>
                  <span className="cell-title">{c.name}</span>
                </div>
                <CampaignBadge status={c.status} />
                <CampaignProgress campaign={c} />
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Nenhuma campanha pronta para iniciar"
            description="Crie uma campanha e marque como “Pronta para iniciar”."
            action={<Link className="btn sm" to="/campanhas/nova">Criar campanha</Link>}
          />
        )
      ) : selected.loading && !campaign ? (
        <SkeletonRows rows={6} />
      ) : !campaign ? (
        <EmptyState title="Campanha não encontrada" />
      ) : (
        <div className="card">
          <div className="card-head">
            <div>
              <h2 style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {campaign.name} <CampaignBadge status={campaign.status} />
              </h2>
              <div style={{ maxWidth: 320, marginTop: 8 }}>
                <CampaignProgress campaign={campaign} />
              </div>
            </div>
            <div className="btn-row">
              {(campaign.status === "ready" || campaign.status === "draft") && (
                <button className="btn" onClick={() => actions.setStatus(campaign, "in_progress")} disabled={actions.busy === campaign.id}>
                  <Play size={16} /> Iniciar campanha
                </button>
              )}
              {campaign.status === "paused" && (
                <button className="btn" onClick={() => actions.setStatus(campaign, "in_progress")} disabled={actions.busy === campaign.id}>
                  <Play size={16} /> Continuar campanha
                </button>
              )}
              <Link className="btn secondary sm" to={`/campanhas/${campaign.id}`}>
                Detalhes da campanha
              </Link>
            </div>
          </div>
          <CampaignLeadsBoard campaign={campaign} onChanged={() => selected.reload()} />
        </div>
      )}
    </>
  );
}
