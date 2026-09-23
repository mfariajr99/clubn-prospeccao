import { useState } from "react";
import type { Lead, Paginated } from "../../shared/types";
import { useAsync } from "../hooks/useAsync";
import { api } from "../lib/api";
import { fmtNumber } from "../lib/format";
import { LeadFilters, useFacets, type LeadFilterValues } from "./LeadFilters";
import { PresenceCell } from "./Presence";
import { ContactBadge, EmptyState, Pagination, PotentialBadge, SkeletonRows } from "./ui";

export type PickerSelection = { mode: "ids"; ids: Set<number>; leads: Map<number, Lead> } | { mode: "filter"; filter: LeadFilterValues; total: number };

export const emptySelection = (): PickerSelection => ({ mode: "ids", ids: new Set(), leads: new Map() });

export function selectionCount(s: PickerSelection): number {
  return s.mode === "ids" ? s.ids.size : s.total;
}

interface Props {
  value: PickerSelection;
  onChange: (value: PickerSelection) => void;
  filter: LeadFilterValues;
  onFilterChange: (filter: LeadFilterValues) => void;
  excludeCampaignId?: number;
  onPageLeads?: (leads: Lead[]) => void;
}

/** Selects leads for a campaign: individually or "all that match the filters". */
export function LeadPicker({ value, onChange, filter, onFilterChange, excludeCampaignId, onPageLeads }: Props) {
  const facets = useFacets();
  const [page, setPage] = useState(1);
  const { data, loading } = useAsync(async (signal) => {
    const res = await api.get<Paginated<Lead>>("/leads", { ...filter, not_in_campaign: excludeCampaignId, page, pageSize: 10, sort: "name", dir: "asc" }, signal);
    onPageLeads?.(res.items);
    return res;
  }, [JSON.stringify(filter), page, excludeCampaignId]);

  const items = data?.items ?? [];
  const isAll = value.mode === "filter";
  const checked = (id: number) => isAll || (value.mode === "ids" && value.ids.has(id));

  const toggle = (lead: Lead) => {
    if (value.mode !== "ids") {
      // Switching from "all" to manual selection: start from the current page.
      const ids = new Set(items.map((l) => l.id));
      ids.delete(lead.id);
      return onChange({ mode: "ids", ids, leads: new Map(items.filter((l) => ids.has(l.id)).map((l) => [l.id, l])) });
    }
    const ids = new Set(value.ids);
    const leads = new Map(value.leads);
    if (ids.has(lead.id)) {
      ids.delete(lead.id);
      leads.delete(lead.id);
    } else {
      ids.add(lead.id);
      leads.set(lead.id, lead);
    }
    onChange({ mode: "ids", ids, leads });
  };

  const pageAllChecked = items.length > 0 && items.every((l) => checked(l.id));
  const togglePage = () => {
    if (value.mode !== "ids") return onChange(emptySelection());
    const ids = new Set(value.ids);
    const leads = new Map(value.leads);
    for (const l of items) {
      if (pageAllChecked) {
        ids.delete(l.id);
        leads.delete(l.id);
      } else {
        ids.add(l.id);
        leads.set(l.id, l);
      }
    }
    onChange({ mode: "ids", ids, leads });
  };

  return (
    <div>
      <LeadFilters
        values={filter}
        onChange={(f) => {
          setPage(1);
          onFilterChange(f);
          if (value.mode === "filter") onChange({ mode: "filter", filter: f, total: value.total });
        }}
        facets={facets}
      />
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <label className="checkbox small">
          <input type="checkbox" checked={pageAllChecked} onChange={togglePage} /> Selecionar página
        </label>
        <div className="btn-row">
          <span className="small muted">{data ? `${fmtNumber(data.total)} lead(s) encontrados` : ""}</span>
          {data && data.total > 0 && (
            <button type="button" className={`btn sm ${isAll ? "" : "secondary"}`} onClick={() => onChange(isAll ? emptySelection() : { mode: "filter", filter, total: data.total })} aria-pressed={isAll}>
              {isAll ? `Todos os ${fmtNumber(data.total)} selecionados` : `Selecionar todos os ${fmtNumber(data.total)}`}
            </button>
          )}
        </div>
      </div>
      {loading && !data ? (
        <SkeletonRows rows={4} height={40} />
      ) : items.length === 0 ? (
        <EmptyState title="Nenhum lead disponível" description={excludeCampaignId ? "Todos os leads filtrados já estão na campanha." : "Ajuste os filtros."} />
      ) : (
        <div className="list-view">
        <div className="table-wrap responsive">
          <table className="table">
            <thead>
              <tr>
                <th className="col-check">
                  <span className="sr-only">Selecionar</span>
                </th>
                <th>Estabelecimento</th>
                <th>Presença digital</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((lead) => (
                <tr key={lead.id} className={checked(lead.id) ? "selected" : ""} onClick={() => toggle(lead)} style={{ cursor: "pointer" }}>
                  <td className="col-check">
                    <input type="checkbox" checked={checked(lead.id)} onChange={() => toggle(lead)} onClick={(e) => e.stopPropagation()} aria-label={`Selecionar ${lead.establishment_name}`} />
                  </td>
                  <td className="col-main">
                    <div className="cell-title">{lead.establishment_name}</div>
                    <div className="cell-sub">{[lead.segment, lead.neighborhood, `${lead.city}/${lead.state}`].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td>
                    <PresenceCell url={lead.digital_presence_url} type={lead.digital_presence_type} compact />
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <ContactBadge status={lead.contact_status} />
                      <PotentialBadge level={lead.potential_level} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="cards-list">
          {items.map((lead) => (
            <label key={lead.id} className={`lead-card pick-card ${checked(lead.id) ? "selected" : ""}`}>
              <input type="checkbox" checked={checked(lead.id)} onChange={() => toggle(lead)} aria-label={`Selecionar ${lead.establishment_name}`} />
              <span style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: 1 }}>
                <span className="cell-title">{lead.establishment_name}</span>
                <span className="cell-sub">{[lead.segment, lead.neighborhood, `${lead.city}/${lead.state}`].filter(Boolean).join(" · ")}</span>
                <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  <ContactBadge status={lead.contact_status} />
                  <PotentialBadge level={lead.potential_level} />
                </span>
              </span>
            </label>
          ))}
        </div>
        </div>
      )}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}
