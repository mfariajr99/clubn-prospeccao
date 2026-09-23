import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Campaign, Paginated } from "../../shared/types";
import { api, errorMessage } from "../lib/api";
import { fmtNumber } from "../lib/format";
import type { LeadFilterValues } from "./LeadFilters";
import { useToast } from "./Toast";
import { CampaignBadge, Modal } from "./ui";

export interface LeadSelection {
  leadIds?: number[];
  filter?: LeadFilterValues;
  count: number;
}

export function cleanFilter(filter: LeadFilterValues | undefined): Record<string, string> | undefined {
  if (!filter) return undefined;
  return Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string>;
}

export function AddToCampaignDialog({ open, selection, onClose, onDone }: { open: boolean; selection: LeadSelection | null; onClose: () => void; onDone?: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCampaignId(null);
    api
      .get<Paginated<Campaign>>("/campaigns", { statuses: "draft,ready,in_progress,paused", pageSize: 100, sort: "updated_at" })
      .then((r) => setCampaigns(r.items))
      .catch(() => setCampaigns([]));
  }, [open]);

  if (!selection) return null;

  const add = async () => {
    if (!campaignId || busy) return;
    setBusy(true);
    try {
      const result = await api.post<{ added: number; alreadyInCampaign: number }>(`/campaigns/${campaignId}/leads`, {
        lead_ids: selection.leadIds,
        filter: selection.leadIds ? undefined : cleanFilter(selection.filter),
      });
      toast.success(
        `${fmtNumber(result.added)} lead(s) adicionados à campanha.${result.alreadyInCampaign ? ` ${fmtNumber(result.alreadyInCampaign)} já estavam nela.` : ""}`,
        { label: "Abrir campanha", onClick: () => navigate(`/campanhas/${campaignId}`) },
      );
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Adicionar a uma campanha"
      description={`${fmtNumber(selection.count)} lead(s) selecionado(s). Incluir na campanha não envia mensagens nem marca como contatado.`}
      onClose={onClose}
      actions={
        <>
          <button className="btn secondary" onClick={() => navigate("/campanhas/nova", { state: { leadIds: selection.leadIds, filter: selection.leadIds ? undefined : selection.filter } })}>
            <Plus size={16} /> Criar nova campanha
          </button>
          <button className="btn" disabled={!campaignId || busy} onClick={add}>
            {busy ? "Adicionando…" : "Adicionar"}
          </button>
        </>
      }
    >
      {campaigns === null ? (
        <div className="skeleton" style={{ height: 120 }} />
      ) : campaigns.length === 0 ? (
        <p className="muted">Nenhuma campanha disponível. Crie uma nova campanha com a seleção.</p>
      ) : (
        <div role="radiogroup" aria-label="Campanhas" style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
          {campaigns.map((c) => (
            <label key={c.id} className="checkbox" style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "10px 12px", justifyContent: "space-between", display: "flex" }}>
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input type="radio" name="campaign" checked={campaignId === c.id} onChange={() => setCampaignId(c.id)} />
                <span>
                  <strong>{c.name}</strong>
                  <span className="cell-sub" style={{ display: "block" }}>
                    {fmtNumber(c.lead_count)} leads
                  </span>
                </span>
              </span>
              <CampaignBadge status={c.status} />
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}
