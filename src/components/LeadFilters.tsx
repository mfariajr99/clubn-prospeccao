import { Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  CONTACT_STATUSES,
  CONTACT_STATUS_LABELS,
  LINK_TYPES,
  LINK_TYPE_LABELS,
  POTENTIAL_LABELS,
  REGISTRATION_STATUSES,
  REGISTRATION_STATUS_LABELS,
} from "../../shared/constants";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";

export interface Facets {
  segments: string[];
  neighborhoods: string[];
  cities: string[];
  states: string[];
  batches: { id: number; original_filename: string; created_at: string }[];
}

export interface LeadFilterValues {
  q?: string;
  segment?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  registration_status?: string;
  contact_status?: string;
  batch_id?: string;
  presence?: string;
  potential?: string;
}

export const FILTER_KEYS: (keyof LeadFilterValues)[] = ["q", "segment", "neighborhood", "city", "state", "registration_status", "contact_status", "batch_id", "presence", "potential"];

let facetsCache: Promise<Facets> | null = null;
export function loadFacets(force = false): Promise<Facets> {
  if (!facetsCache || force) facetsCache = api.get<Facets>("/leads/facets").catch((e) => {
    facetsCache = null;
    throw e;
  });
  return facetsCache;
}

export function useFacets() {
  const [facets, setFacets] = useState<Facets | null>(null);
  useEffect(() => {
    let active = true;
    loadFacets(true)
      .then((f) => active && setFacets(f))
      .catch(() => active && setFacets({ segments: [], neighborhoods: [], cities: [], states: [], batches: [] }));
    return () => {
      active = false;
    };
  }, []);
  return facets;
}

interface Props {
  values: LeadFilterValues;
  onChange: (values: LeadFilterValues) => void;
  hide?: (keyof LeadFilterValues)[];
  facets: Facets | null;
}

export function LeadFilters({ values, onChange, hide = [], facets }: Props) {
  const [q, setQ] = useState(values.q ?? "");
  const [open, setOpen] = useState(false);
  useEffect(() => setQ(values.q ?? ""), [values.q]);
  // Debounced search.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if ((values.q ?? "") !== q) onChange({ ...values, q: q || undefined });
    }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const set = (key: keyof LeadFilterValues, value: string) => onChange({ ...values, [key]: value || undefined });
  const activeCount = FILTER_KEYS.filter((k) => k !== "q" && values[k]).length;
  const show = (k: keyof LeadFilterValues) => !hide.includes(k);

  const select = (key: keyof LeadFilterValues, label: string, options: { value: string; label: string }[]) =>
    show(key) && (
      <select className="select" aria-label={label} value={values[key] ?? ""} onChange={(e) => set(key, e.target.value)}>
        <option value="">{label}: todos</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );

  const asOptions = (list: string[] | undefined) => (list ?? []).map((v) => ({ value: v, label: v }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <div className="input-with-icon grow">
          <Search size={16} />
          <input className="input" type="search" placeholder="Buscar por nome ou WhatsApp" aria-label="Buscar por nome" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="button" className="btn secondary sm filter-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <SlidersHorizontal size={15} /> Filtros{activeCount ? ` (${activeCount})` : ""}
        </button>
        {activeCount > 0 && (
          <button type="button" className="btn ghost sm" onClick={() => onChange({ q: values.q })}>
            <X size={15} /> Limpar filtros
          </button>
        )}
      </div>
      <div className={`filters collapsible ${open ? "open" : ""}`}>
        {select("segment", "Segmento", asOptions(facets?.segments))}
        {select("neighborhood", "Bairro", asOptions(facets?.neighborhoods))}
        {select("city", "Cidade", asOptions(facets?.cities))}
        {select("state", "Estado", asOptions(facets?.states))}
        {select(
          "registration_status",
          "Status cadastral",
          REGISTRATION_STATUSES.map((s) => ({ value: s, label: REGISTRATION_STATUS_LABELS[s] })),
        )}
        {select(
          "contact_status",
          "Status do contato",
          CONTACT_STATUSES.map((s) => ({ value: s, label: CONTACT_STATUS_LABELS[s] })),
        )}
        {select(
          "batch_id",
          "Lote de importação",
          (facets?.batches ?? []).map((b) => ({ value: String(b.id), label: `#${b.id} · ${b.original_filename} (${fmtDate(b.created_at)})` })),
        )}
        {select("presence", "Presença digital", [
          { value: "with", label: "Com link" },
          { value: "without", label: "Sem link" },
          ...LINK_TYPES.map((t) => ({ value: t, label: LINK_TYPE_LABELS[t] })),
        ])}
        {select("potential", "Potencial", [
          { value: "high", label: POTENTIAL_LABELS.high },
          { value: "medium", label: POTENTIAL_LABELS.medium },
          { value: "low", label: POTENTIAL_LABELS.low },
          { value: "none", label: POTENTIAL_LABELS.none },
        ])}
      </div>
    </div>
  );
}
