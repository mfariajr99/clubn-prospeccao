import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CampaignStatus } from "../../shared/constants";
import type { Campaign } from "../../shared/types";
import { api, errorMessage } from "../lib/api";
import { fmtNumber, pct } from "../lib/format";
import { useToast } from "./Toast";
import { CalendarClock, Gauge } from "lucide-react";
import { describeRule, fmtBrDateTime } from "../../shared/campaignRule";
import { CampaignBadge } from "./ui";

/** Status badge that also shows "Agendada · 08/10 às 09:00". */
export function CampaignStatusBadge({ campaign }: { campaign: Pick<Campaign, "status" | "rule"> }) {
  if (campaign.status === "ready" && campaign.rule?.phase === "scheduled" && campaign.rule.scheduled_start_at) {
    return (
      <span className="badge purple" title="Campanha agendada">
        <CalendarClock size={13} aria-hidden /> Agendada · {fmtBrDateTime(campaign.rule.scheduled_start_at)}
      </span>
    );
  }
  return <CampaignBadge status={campaign.status} />;
}

/** "12/30 nas últimas 6h" with a mini bar; red when the rule is full. */
export function RuleUsage({ campaign, compact }: { campaign: Pick<Campaign, "rule" | "send_limit" | "send_window_hours">; compact?: boolean }) {
  const rule = campaign.rule;
  if (!rule?.limit || !rule.window_hours) {
    return compact ? null : <span className="cell-sub">{describeRule(null, null)}</span>;
  }
  const full = Boolean(rule.next_slot_at);
  return (
    <div className={`rule-usage ${full ? "full" : ""}`} title={describeRule(rule.limit, rule.window_hours)} data-testid="rule-usage">
      <Gauge size={14} aria-hidden />
      <span>
        <strong className="mono">
          {rule.used}/{rule.limit}
        </strong>{" "}
        {compact ? `em ${rule.window_hours}h` : `nas últimas ${rule.window_hours}h`}
        {full && rule.next_slot_at && !compact ? ` · libera ${fmtBrDateTime(rule.next_slot_at)}` : ""}
      </span>
    </div>
  );
}

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
