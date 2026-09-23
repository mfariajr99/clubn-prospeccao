import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CampaignStatus } from "../../shared/constants";
import type { Campaign } from "../../shared/types";
import { api, errorMessage } from "../lib/api";
import { fmtNumber, pct } from "../lib/format";
import { useToast } from "./Toast";

export function CampaignProgress({ campaign }: { campaign: Campaign }) {
  const total = campaign.lead_count ?? 0;
  const contacted = campaign.contacted_count ?? 0;
  const opened = Math.max(0, (campaign.opened_count ?? 0) - contacted);
  return (
    <div style={{ minWidth: 140 }}>
      <div className="progress" role="img" aria-label={`${contacted} de ${total} contatados`} title={`${contacted} contatados · ${campaign.opened_count ?? 0} WhatsApp abertos · ${total} leads`}>
        <span style={{ width: `${pct(contacted, total)}%` }} />
        <span className="light" style={{ width: `${pct(opened, total)}%` }} />
      </div>
      <div className="cell-sub" style={{ marginTop: 4 }}>
        {fmtNumber(contacted)}/{fmtNumber(total)} contatados · {pct(contacted, total)}%
      </div>
    </div>
  );
}

/** Status transitions + duplicate, with feedback. */
export function useCampaignActions(onChanged?: (c: Campaign) => void) {
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<number | null>(null);

  const setStatus = async (campaign: Campaign, status: CampaignStatus, goToStart = false) => {
    setBusy(campaign.id);
    try {
      const updated = await api.post<Campaign>(`/campaigns/${campaign.id}/status`, { status });
      onChanged?.(updated);
      const msg: Partial<Record<CampaignStatus, string>> = {
        in_progress: campaign.status === "paused" ? "Campanha retomada." : "Campanha iniciada.",
        paused: "Campanha pausada.",
        completed: "Campanha concluída.",
        ready: "Campanha pronta para iniciar.",
        draft: "Campanha voltou para rascunho.",
      };
      toast.success(msg[status] ?? "Status atualizado.");
      if (goToStart) navigate(`/campanhas/iniciar/${campaign.id}`);
      return updated;
    } catch (e) {
      toast.error(errorMessage(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const duplicate = async (campaign: Campaign) => {
    setBusy(campaign.id);
    try {
      const copy = await api.post<Campaign>(`/campaigns/${campaign.id}/duplicate`);
      toast.success("Campanha duplicada como rascunho.");
      navigate(`/campanhas/${copy.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return { busy, setStatus, duplicate };
}
