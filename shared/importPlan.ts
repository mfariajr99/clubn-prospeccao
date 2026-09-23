import type { DuplicateAction, ImportAnalysisRow } from "./types.js";

export type RowDecision = "skip" | "update" | "import";
export type DuplicateMode = DuplicateAction | "review";

/**
 * Planned outcome of one analyzed row. Shared by the client summary (before
 * confirmation) and the server commit, so both always agree.
 * - invalid rows            -> error
 * - same WhatsApp twice     -> the first occurrence wins, others are skipped
 * - WhatsApp already stored -> skip or update (never silently overwritten)
 * - same name+city+state    -> possible duplicate: imported unless the user decides otherwise
 */
export function planRow(row: Pick<ImportAnalysisRow, "valid" | "duplicate" | "rowNumber">, mode: DuplicateMode, decisions: Record<string, RowDecision>): RowDecision | "error" {
  if (!row.valid) return "error";
  const decision = decisions[String(row.rowNumber)];
  const dup = row.duplicate;
  if (!dup) return decision === "skip" ? "skip" : "import";
  switch (dup.kind) {
    case "sheet_phone":
      return "skip";
    case "existing_phone":
      if (decision) return decision === "import" ? "skip" : decision;
      return mode === "update" ? "update" : "skip";
    case "sheet_name":
      return decision === "skip" ? "skip" : "import";
    case "existing_name":
      if (decision) return decision;
      return mode === "update" ? "update" : "import";
  }
}

export function summarizePlan(rows: Pick<ImportAnalysisRow, "valid" | "duplicate" | "rowNumber">[], mode: DuplicateMode, decisions: Record<string, RowDecision>) {
  const summary = { import: 0, update: 0, skip: 0, error: 0 };
  for (const row of rows) summary[planRow(row, mode, decisions)]++;
  return summary;
}
