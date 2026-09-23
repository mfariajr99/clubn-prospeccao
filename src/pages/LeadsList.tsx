import { Eye, FileText, ListPlus, Pencil, Plus, Upload } from "lucide-react";
import { ActionMenu, type ActionItem } from "../components/ActionMenu";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LEAD_SOURCE_LABELS } from "../../shared/constants";
import type { Lead, Paginated } from "../../shared/types";
import { AddToCampaignDialog, type LeadSelection } from "../components/AddToCampaignDialog";
import { FILTER_KEYS, LeadFilters, useFacets, type LeadFilterValues } from "../components/LeadFilters";
import { PresenceCell } from "../components/Presence";
import { PreviewPanel } from "../components/PreviewPanel";
import { ContactBadge, EmptyState, Pagination, PotentialBadge, RegistrationBadge, SkeletonRows } from "../components/ui";
import { WhatsAppButton } from "../components/WhatsAppButton";
import { useAsync } from "../hooks/useAsync";
import { api } from "../lib/api";
import { fmtDate, fmtNumber, fmtPhone } from "../lib/format";

const SORT_OPTIONS = [
  { value: "created_at:desc", label: "Mais recentes" },
  { value: "created_at:asc", label: "Mais antigos" },
  { value: "name:asc", label: "Nome (A–Z)" },
  { value: "name:desc", label: "Nome (Z–A)" },
  { value: "city:asc", label: "Cidade" },
  { value: "segment:asc", label: "Segmento" },
  { value: "potential:desc", label: "Maior potencial" },
  { value: "potential:asc", label: "Menor potencial" },
];
const PAGE_SIZE = 20;

export default function LeadsList() {
  const [params, setParams] = useSearchParams();
  const facets = useFacets();
  const filters: LeadFilterValues = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? undefined])), [params]);
  const page = Number(params.get("page") ?? 1) || 1;
  const sort = params.get("sort") ?? "created_at:desc";
  const [sortKey, sortDir] = sort.split(":");

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [addSelection, setAddSelection] = useState<LeadSelection | null>(null);

  const { data, loading, error, reload, setData } = useAsync(
    (signal) => api.get<Paginated<Lead>>("/leads", { ...filters, page, pageSize: PAGE_SIZE, sort: sortKey, dir: sortDir }, signal),
    [params.toString()],
  );

  const update = (next: Record<string, string | undefined>, resetPage = true) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (resetPage) p.delete("page");
    setParams(p, { replace: true });
    setSelected(new Set());
    setAllMatching(false);
  };

  const setFilters = (values: LeadFilterValues) => update(Object.fromEntries(FILTER_KEYS.map((k) => [k, values[k]])));
  const items = data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((l) => selected.has(l.id));
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      setAllMatching(false);
      return n;
    });
  const togglePage = () => {
    setAllMatching(false);
    setSelected((s) => {
      const n = new Set(s);
      if (allOnPage) items.forEach((l) => n.delete(l.id));
      else items.forEach((l) => n.add(l.id));
      return n;
    });
  };
  const selectionCount = allMatching ? data?.total ?? 0 : selected.size;
  const previewIndex = items.findIndex((l) => l.id === previewId);
  const previewLead = previewIndex >= 0 ? items[previewIndex] : null;
  const patchLead = (id: number, patch: Partial<Lead>) => setData((d) => (d ? { ...d, items: d.items.map((l) => (l.id === id ? { ...l, ...patch } : l)) } : d));

  const menuItems = (lead: Lead): ActionItem[] => [
    { label: "Visualizar", icon: <FileText size={15} />, to: `/leads/${lead.id}` },
    { label: "Editar", icon: <Pencil size={15} />, to: `/leads/${lead.id}/editar` },
    { label: "Ver prévia", icon: <Eye size={15} />, onClick: () => setPreviewId(lead.id) },
    { label: "Adicionar a uma campanha", icon: <ListPlus size={15} />, onClick: () => setAddSelection({ leadIds: [lead.id], count: 1 }) },
  ];

  const actions = (lead: Lead) => (
    <>
      <WhatsAppButton lead={lead} templates={[lead.active_campaign_message, lead.active_campaign_message_2, lead.active_campaign_message_3]} campaignId={lead.active_campaign_id} variant="icon" onOpened={(r) => patchLead(lead.id, { contact_status: r.current })} />
      <ActionMenu label={`Mais ações: ${lead.establishment_name}`} items={menuItems(lead)} />
    </>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="breadcrumb">Leads</div>
          <h1>Consultar leads</h1>
          <p>Leads e prospects em uma única base. {data ? `${fmtNumber(data.total)} encontrado(s).` : ""}</p>
        </div>
        <div className="btn-row">
          <Link to="/leads/importar" className="btn secondary">
            <Upload size={16} /> Importar prospects
          </Link>
          <Link to="/leads/novo" className="btn">
            <Plus size={16} /> Cadastrar lead
          </Link>
        </div>
      </div>

      <div className="card">
        <LeadFilters values={filters} onChange={setFilters} facets={facets} />
        <div className="toolbar" style={{ justifyContent: "space-between" }}>
          <label className="checkbox small">
            <input type="checkbox" checked={allOnPage} onChange={togglePage} aria-label="Selecionar todos desta página" /> Selecionar página
          </label>
          <label className="small" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="muted">Ordenar por</span>
            <select className="select" style={{ height: 38, width: "auto" }} value={sort} onChange={(e) => update({ sort: e.target.value })} aria-label="Ordenação">
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && <div className="notice danger">{error}</div>}
        {loading && !data ? (
          <SkeletonRows rows={6} />
        ) : items.length === 0 ? (
          <EmptyState
            title="Nenhum lead encontrado"
            description="Ajuste os filtros ou cadastre novos leads."
            action={
              <div className="btn-row" style={{ justifyContent: "center" }}>
                <Link to="/leads/novo" className="btn sm">
                  Cadastrar lead
                </Link>
                <Link to="/leads/importar" className="btn secondary sm">
                  Importar planilha
                </Link>
              </div>
            }
          />
        ) : (
          <div className="list-view" style={{ opacity: loading ? 0.6 : 1, transition: "opacity .15s" }}>
            <div className="table-wrap responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th className="col-check">
                      <span className="sr-only">Seleção</span>
                    </th>
                    <th>Estabelecimento</th>
                    <th>WhatsApp</th>
                    <th>Presença digital</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((lead) => (
                    <tr key={lead.id} className={selected.has(lead.id) || allMatching ? "selected" : ""}>
                      <td className="col-check">
                        <input type="checkbox" className="checkbox" checked={allMatching || selected.has(lead.id)} onChange={() => toggle(lead.id)} aria-label={`Selecionar ${lead.establishment_name}`} />
                      </td>
                      <td>
                        <Link to={`/leads/${lead.id}`} className="cell-title">
                          {lead.establishment_name}
                        </Link>
                        <div className="cell-sub">{lead.segment || "Sem segmento"}</div>
                        <div className="cell-sub">{[lead.neighborhood, `${lead.city}/${lead.state}`].filter(Boolean).join(" · ")}</div>
                        <div className="cell-sub" title={lead.import_batch_filename ?? undefined}>
                          {LEAD_SOURCE_LABELS[lead.source]}
                          {lead.import_batch_id ? ` · lote #${lead.import_batch_id}` : ""} · {fmtDate(lead.created_at)}
                        </div>
                      </td>
                      <td className="nowrap mono">
                        {fmtPhone(lead.whatsapp, lead.whatsapp_valid === 1)}
                        {lead.whatsapp_valid === 0 && <div><span className="badge danger">inválido</span></div>}
                      </td>
                      <td>
                        <PresenceCell url={lead.digital_presence_url} type={lead.digital_presence_type} extraCount={Math.max(0, (lead.links?.length ?? 0) - 1)} onPreview={() => setPreviewId(lead.id)} />
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                          <RegistrationBadge status={lead.registration_status} />
                          <ContactBadge status={lead.contact_status} />
                          <PotentialBadge level={lead.potential_level} />
                        </div>
                      </td>
                      <td>
                        <div className="actions nowrap">{actions(lead)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="cards-list">
              {items.map((lead) => (
                <article key={lead.id} className={`lead-card ${selected.has(lead.id) || allMatching ? "selected" : ""}`} aria-label={lead.establishment_name}>
                  <div className="lc-head">
                    <label className="checkbox" style={{ alignItems: "flex-start" }}>
                      <input type="checkbox" checked={allMatching || selected.has(lead.id)} onChange={() => toggle(lead.id)} aria-label={`Selecionar ${lead.establishment_name}`} />
                      <span>
                        <Link to={`/leads/${lead.id}`} className="cell-title">
                          {lead.establishment_name}
                        </Link>
                        <span className="cell-sub" style={{ display: "block" }}>
                          {lead.segment || "Sem segmento"}
                        </span>
                      </span>
                    </label>
                    <ContactBadge status={lead.contact_status} />
                  </div>
                  <div className="lc-meta">
                    <span>
                      {[lead.neighborhood, `${lead.city}/${lead.state}`].filter(Boolean).join(" · ")}
                    </span>
                    <span className="mono">{fmtPhone(lead.whatsapp, lead.whatsapp_valid === 1)}</span>
                    <RegistrationBadge status={lead.registration_status} />
                    <PotentialBadge level={lead.potential_level} />
                  </div>
                  <PresenceCell url={lead.digital_presence_url} type={lead.digital_presence_type} onPreview={() => setPreviewId(lead.id)} />
                  <div className="lc-actions">
                    <WhatsAppButton lead={lead} templates={[lead.active_campaign_message, lead.active_campaign_message_2, lead.active_campaign_message_3]} campaignId={lead.active_campaign_id} variant="block" onOpened={(r) => patchLead(lead.id, { contact_status: r.current })} />
                    <div className="lc-secondary">
                      <Link className="btn secondary sm" to={`/leads/${lead.id}`}>
                        <FileText size={15} /> Ver cadastro
                      </Link>
                      <ActionMenu label={`Mais ações: ${lead.establishment_name}`} items={menuItems(lead)} />
                    </div>
                  </div>
                </article>
              ))}
            </div>
            {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => update({ page: String(p) }, false)} />}
          </div>
        )}
      </div>

      {selectionCount > 0 && (
        <div className="selection-bar" role="region" aria-label="Seleção">
          <span>
            <strong>{fmtNumber(selectionCount)}</strong> selecionado(s)
            {!allMatching && allOnPage && data && data.total > items.length && (
              <>
                {" · "}
                <button className="link" onClick={() => setAllMatching(true)}>
                  Selecionar todos os {fmtNumber(data.total)} resultados
                </button>
              </>
            )}
          </span>
          <div className="btn-row">
            <button className="btn ghost sm" style={{ color: "#fff" }} onClick={() => (setSelected(new Set()), setAllMatching(false))}>
              Limpar
            </button>
            <button
              className="btn secondary sm"
              onClick={() => setAddSelection(allMatching ? { filter: filters, count: selectionCount } : { leadIds: [...selected], count: selected.size })}
            >
              <ListPlus size={15} /> Adicionar à campanha
            </button>
          </div>
        </div>
      )}

      <AddToCampaignDialog open={Boolean(addSelection)} selection={addSelection} onClose={() => setAddSelection(null)} onDone={reload} />
      <PreviewPanel
        lead={previewLead}
        onClose={() => setPreviewId(null)}
        onPrev={previewIndex > 0 ? () => setPreviewId(items[previewIndex - 1].id) : null}
        onNext={previewIndex >= 0 && previewIndex < items.length - 1 ? () => setPreviewId(items[previewIndex + 1].id) : null}
        position={previewIndex >= 0 ? { index: previewIndex, total: items.length } : null}
        onOpened={(current) => previewLead && patchLead(previewLead.id, { contact_status: current })}
        onEvaluated={reload}
      />
    </>
  );
}
