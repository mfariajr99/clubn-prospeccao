import { normalizeLeadInput, type LeadField, type NormalizedLead } from "./leadInput.js";
import { comparisonKey } from "./text.js";

export const IMPORT_FIELDS = [
  { key: "establishment_name", label: "Nome do estabelecimento", required: true },
  { key: "segment", label: "Segmento", required: false },
  { key: "neighborhood", label: "Bairro", required: false },
  { key: "city", label: "Cidade", required: true },
  { key: "state", label: "Estado", required: true },
  { key: "whatsapp", label: "WhatsApp", required: true },
  { key: "digital_presence_url", label: "Link", required: false },
  { key: "extra_link", label: "Link adicional", required: false },
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];
export type ColumnMapping = Record<ImportField, number | null>;

const ALIASES: Record<Exclude<ImportField, "extra_link">, string[]> = {
  establishment_name: [
    "nome do estabelecimento",
    "estabelecimento",
    "nome",
    "nome fantasia",
    "empresa",
    "razao social",
    "nome da empresa",
  ],
  segment: ["segmento", "categoria", "ramo", "ramo de atividade", "tipo", "setor"],
  neighborhood: ["bairro", "regiao", "distrito"],
  city: ["cidade", "municipio", "localidade"],
  state: ["estado", "uf", "estado uf", "sigla estado"],
  whatsapp: ["whatsapp", "whats", "zap", "telefone", "celular", "fone", "telefone whatsapp", "numero", "contato", "whatsapp de contato"],
  digital_presence_url: [
    "link",
    "site",
    "instagram",
    "url",
    "link de presenca digital",
    "presenca digital",
    "website",
    "facebook",
    "tiktok",
    "linktree",
    "google maps",
    "rede social",
    "perfil",
  ],
};

export interface AutoMapResult {
  mapping: ColumnMapping;
  /** true when the user should confirm the mapping manually. */
  needsReview: boolean;
  reasons: string[];
}

export function emptyMapping(): ColumnMapping {
  return {
    establishment_name: null,
    segment: null,
    neighborhood: null,
    city: null,
    state: null,
    whatsapp: null,
    digital_presence_url: null,
    extra_link: null,
  };
}

/** Tries to map spreadsheet headers to system fields, accepting small variations. */
export function autoMapColumns(headers: string[]): AutoMapResult {
  const mapping = emptyMapping();
  const reasons: string[] = [];
  const keys = headers.map((h) => comparisonKey(String(h ?? "")));
  const used = new Set<number>();
  let fuzzyUsed = false;

  const fields = Object.keys(ALIASES) as (keyof typeof ALIASES)[];
  // 1st pass: exact alias matches.
  for (const field of fields) {
    const matches = keys
      .map((k, i) => ({ k, i }))
      .filter(({ k, i }) => !used.has(i) && ALIASES[field].includes(k));
    if (matches.length === 0) continue;
    // Prefer the alias that appears first in the list (more specific).
    // For links, keep the spreadsheet column order (first link column is the primary one).
    if (field !== "digital_presence_url") {
      matches.sort((a, b) => ALIASES[field].indexOf(a.k) - ALIASES[field].indexOf(b.k));
    }
    mapping[field] = matches[0].i;
    used.add(matches[0].i);
    if (field === "digital_presence_url" && matches.length > 1) {
      mapping.extra_link = matches[1].i;
      used.add(matches[1].i);
    }
  }
  // 2nd pass: partial matches ("Telefone (WhatsApp)", "Cidade/Município").
  for (const field of fields) {
    if (mapping[field] !== null) continue;
    const candidates = keys
      .map((k, i) => ({ k, i }))
      .filter(({ k, i }) => !used.has(i) && k && ALIASES[field].some((alias) => alias.length >= 3 && (k.includes(alias) || alias.includes(k) && k.length >= 4)));
    if (candidates.length === 1) {
      mapping[field] = candidates[0].i;
      used.add(candidates[0].i);
      fuzzyUsed = true;
    } else if (candidates.length > 1) {
      reasons.push(`Mais de uma coluna pode corresponder a "${IMPORT_FIELDS.find((f) => f.key === field)?.label}".`);
    }
  }

  for (const f of IMPORT_FIELDS) {
    if (f.required && mapping[f.key] === null) reasons.push(`Coluna obrigatória não identificada: ${f.label}.`);
  }
  if (fuzzyUsed) reasons.push("Algumas colunas foram identificadas por semelhança de nome. Confira o mapeamento.");
  return { mapping, needsReview: reasons.length > 0, reasons };
}

export function mappingIsComplete(mapping: ColumnMapping): boolean {
  return IMPORT_FIELDS.every((f) => !f.required || mapping[f.key] !== null);
}

export interface ImportRawRow {
  rowNumber: number;
  values: Record<ImportField, string>;
}

export function applyMapping(rows: unknown[][], mapping: ColumnMapping, firstRowNumber = 2): ImportRawRow[] {
  const result: ImportRawRow[] = [];
  rows.forEach((row, index) => {
    const values = {} as Record<ImportField, string>;
    let hasContent = false;
    for (const f of IMPORT_FIELDS) {
      const col = mapping[f.key];
      const cell = col === null ? "" : row[col];
      const text = cell === null || cell === undefined ? "" : String(cell).trim();
      if (text) hasContent = true;
      values[f.key] = text;
    }
    if (hasContent) result.push({ rowNumber: firstRowNumber + index, values });
  });
  return result;
}

const FIELD_LABEL: Partial<Record<LeadField, string>> = {
  establishment_name: "nome do estabelecimento",
  city: "cidade",
  state: "estado",
  whatsapp: "WhatsApp",
  digital_presence_url: "link",
  extra_links: "link adicional",
};

export interface ValidatedImportRow {
  rowNumber: number;
  values: Record<ImportField, string>;
  valid: boolean;
  lead: NormalizedLead | null;
  errors: string[];
  /** "Linha 12: WhatsApp não informado." */
  messages: string[];
}

export function validateImportRow(row: ImportRawRow): ValidatedImportRow {
  const result = normalizeLeadInput({
    establishment_name: row.values.establishment_name,
    segment: row.values.segment,
    neighborhood: row.values.neighborhood,
    city: row.values.city,
    state: row.values.state,
    whatsapp: row.values.whatsapp,
    digital_presence_url: row.values.digital_presence_url,
    extra_links: row.values.extra_link ? [row.values.extra_link] : [],
  });
  if (result.ok) return { rowNumber: row.rowNumber, values: row.values, valid: true, lead: result.value, errors: [], messages: [] };
  const errors = Object.entries(result.errors).map(([field, msg]) => {
    if (field === "digital_presence_url") return "URL inválida.";
    return msg ?? `Campo inválido: ${FIELD_LABEL[field as LeadField] ?? field}.`;
  });
  const orderedErrors = [...new Set(errors)];
  return {
    rowNumber: row.rowNumber,
    values: row.values,
    valid: false,
    lead: null,
    errors: orderedErrors,
    messages: orderedErrors.map((e) => rowMessage(row.rowNumber, e)),
  };
}

/** "Linha 18: número de WhatsApp inválido." (keeps acronyms/brands capitalized). */
export function rowMessage(rowNumber: number, error: string): string {
  const keepCase = /^(WhatsApp|URL|Instagram)/.test(error);
  const text = keepCase ? error : error.charAt(0).toLocaleLowerCase("pt-BR") + error.slice(1);
  return `Linha ${rowNumber}: ${text}`;
}

/** Key used to flag possible duplicates by name + city + state. */
export function nameLocationKey(lead: Pick<NormalizedLead, "establishment_name" | "city" | "state">): string {
  return `${comparisonKey(lead.establishment_name)}|${comparisonKey(lead.city)}|${(lead.state ?? "").toUpperCase()}`;
}
