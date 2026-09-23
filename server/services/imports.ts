import { nameLocationKey, validateImportRow, type ImportRawRow } from "../../shared/importMapping.js";
import type { NormalizedLead } from "../../shared/leadInput.js";
import type { ImportAnalysis, ImportAnalysisRow, ImportBatch, Lead, LeadLink } from "../../shared/types.js";
import { nowIso, type DB } from "../db/core.js";
import { HttpError, notFound } from "../lib/http.js";
import { insertLead, updateLeadRecord } from "./leads.js";
import { planRow, type RowDecision } from "../../shared/importPlan.js";

export type { RowDecision };

export const MAX_IMPORT_ROWS = 10000;


/** Validates rows and flags duplicates. Pure read: never writes to the database. */
export function analyzeImport(db: DB, filename: string, rows: ImportRawRow[]): ImportAnalysis {
  if (rows.length > MAX_IMPORT_ROWS) throw new HttpError(400, `A planilha possui mais de ${MAX_IMPORT_ROWS} linhas. Divida o arquivo.`);
  const byPhoneStmt = db.prepare(
    `SELECT l.id, l.establishment_name, COALESCE((SELECT bi.batch_id FROM import_batch_items bi WHERE bi.lead_id = l.id ORDER BY bi.id DESC LIMIT 1), l.import_batch_id) AS batch_id
     FROM leads l WHERE l.whatsapp = ? AND l.whatsapp_valid = 1`,
  );
  const byNameStmt = db.prepare("SELECT id, establishment_name, whatsapp FROM leads WHERE name_key = ? LIMIT 1");
  const seenPhones = new Map<string, number>();
  const seenNames = new Map<string, number>();
  const result: ImportAnalysisRow[] = [];
  let valid = 0;
  let duplicates = 0;

  for (const raw of rows) {
    const checked = validateImportRow(raw);
    const row: ImportAnalysisRow = {
      rowNumber: raw.rowNumber,
      values: raw.values,
      valid: checked.valid,
      errors: checked.messages,
      lead: checked.lead,
      duplicate: null,
    };
    if (checked.valid && checked.lead) {
      valid++;
      const lead = checked.lead;
      const nameKey = nameLocationKey(lead);
      const firstPhoneRow = seenPhones.get(lead.whatsapp);
      const firstNameRow = seenNames.get(nameKey);
      const existingPhone = byPhoneStmt.get(lead.whatsapp) as { id: number; establishment_name: string; batch_id: number | null } | undefined;
      if (firstPhoneRow !== undefined) {
        row.duplicate = { kind: "sheet_phone", firstRowNumber: firstPhoneRow, message: `WhatsApp repetido na planilha (linha ${firstPhoneRow}).` };
      } else if (existingPhone) {
        row.duplicate = {
          kind: "existing_phone",
          existingLeadId: existingPhone.id,
          existingName: existingPhone.establishment_name,
          existingBatchId: existingPhone.batch_id,
          message: existingPhone.batch_id
            ? `WhatsApp já cadastrado em "${existingPhone.establishment_name}" (importação anterior, lote #${existingPhone.batch_id}).`
            : `WhatsApp já cadastrado em "${existingPhone.establishment_name}".`,
        };
      } else if (firstNameRow !== undefined) {
        row.duplicate = { kind: "sheet_name", firstRowNumber: firstNameRow, message: `Possível duplicidade: mesmo nome, cidade e estado da linha ${firstNameRow}.` };
      } else {
        const existingName = byNameStmt.get(nameKey) as { id: number; establishment_name: string } | undefined;
        if (existingName) {
          row.duplicate = {
            kind: "existing_name",
            existingLeadId: existingName.id,
            existingName: existingName.establishment_name,
            message: `Possível duplicidade: "${existingName.establishment_name}" já existe com mesmo nome, cidade e estado.`,
          };
        }
      }
      if (row.duplicate) duplicates++;
      if (firstPhoneRow === undefined) seenPhones.set(lead.whatsapp, raw.rowNumber);
      if (firstNameRow === undefined) seenNames.set(nameKey, raw.rowNumber);
    }
    result.push(row);
  }
  return { filename, totalRows: rows.length, validRows: valid, invalidRows: rows.length - valid, duplicateRows: duplicates, rows: result };
}

export interface CommitInput {
  filename: string;
  rows: ImportRawRow[];
  duplicateAction: "skip" | "update" | "review";
  decisions?: Record<string, RowDecision>;
}

interface ReportRow {
  rowNumber: number;
  values: Record<string, string>;
  result: "importado" | "atualizado" | "ignorado" | "erro";
  reason: string;
  leadId: number | null;
}

function mergeLead(db: DB, existingId: number, incoming: NormalizedLead): NormalizedLead {
  const existing = db.prepare("SELECT * FROM leads WHERE id = ?").get(existingId) as Lead;
  const links = db.prepare("SELECT * FROM lead_links WHERE lead_id = ? ORDER BY is_primary DESC, id").all(existingId) as LeadLink[];
  const primaryUrl = incoming.digital_presence_url ?? existing.digital_presence_url;
  const primaryType = incoming.digital_presence_url ? incoming.digital_presence_type : existing.digital_presence_type;
  const extras = [
    ...links.filter((l) => l.url !== primaryUrl).map((l) => ({ url: l.url, type: l.link_type, label: l.url })),
    ...incoming.extra_links.filter((l) => l.url !== primaryUrl),
  ].filter((l, i, arr) => arr.findIndex((x) => x.url === l.url) === i);
  return {
    establishment_name: incoming.establishment_name || existing.establishment_name,
    segment: incoming.segment || existing.segment,
    neighborhood: incoming.neighborhood || existing.neighborhood,
    city: incoming.city || existing.city,
    state: incoming.state || existing.state,
    whatsapp: incoming.whatsapp || existing.whatsapp,
    digital_presence_url: primaryUrl,
    digital_presence_type: primaryType,
    extra_links: extras.slice(0, 6),
    cover_image_url: existing.cover_image_url,
  };
}

export function commitImport(db: DB, input: CommitInput, userId: number): ImportBatch & { report: ReportRow[] } {
  const filename = input.filename.slice(0, 200) || "planilha";
  const analysis = analyzeImport(db, filename, input.rows); // always revalidate on the server
  const decisions = input.decisions ?? {};
  const createdAt = nowIso();
  const batchId = Number(
    db
      .prepare("INSERT INTO import_batches (original_filename, total_rows, duplicate_action, status, imported_by, created_at) VALUES (?, ?, ?, 'processing', ?, ?)")
      .run(filename, analysis.totalRows, input.duplicateAction, userId, createdAt).lastInsertRowid,
  );
  const report: ReportRow[] = [];
  const counts = { imported: 0, updated: 0, skipped: 0, errors: 0 };
  const addItem = db.prepare("INSERT OR IGNORE INTO import_batch_items (batch_id, lead_id, row_number, action) VALUES (?, ?, ?, ?)");

  try {
    db.transaction(() => {
      for (const row of analysis.rows) {
        const plan = planRow(row, input.duplicateAction, decisions);
        if (plan === "error" || !row.lead) {
          counts.errors++;
          report.push({ rowNumber: row.rowNumber, values: row.values, result: "erro", reason: row.errors.join(" "), leadId: null });
          continue;
        }
        if (plan === "skip") {
          counts.skipped++;
          report.push({
            rowNumber: row.rowNumber,
            values: row.values,
            result: "ignorado",
            reason: row.duplicate ? `Duplicidade: ${row.duplicate.message}` : "Ignorado pelo usuário.",
            leadId: row.duplicate?.existingLeadId ?? null,
          });
          continue;
        }
        if (plan === "update") {
          const targetId = row.duplicate?.existingLeadId;
          if (!targetId) {
            counts.skipped++;
            report.push({ rowNumber: row.rowNumber, values: row.values, result: "ignorado", reason: "Nenhum registro existente para atualizar.", leadId: null });
            continue;
          }
          const merged = mergeLead(db, targetId, row.lead);
          const conflict = db.prepare("SELECT id FROM leads WHERE whatsapp = ? AND whatsapp_valid = 1 AND id <> ?").get(merged.whatsapp, targetId);
          if (conflict) {
            counts.skipped++;
            report.push({ rowNumber: row.rowNumber, values: row.values, result: "ignorado", reason: "O WhatsApp pertence a outro lead.", leadId: targetId });
            continue;
          }
          updateLeadRecord(db, targetId, merged);
          addItem.run(batchId, targetId, row.rowNumber, "updated");
          counts.updated++;
          report.push({ rowNumber: row.rowNumber, values: row.values, result: "atualizado", reason: row.duplicate?.message ?? "", leadId: targetId });
          continue;
        }
        // import
        const phoneTaken = db.prepare("SELECT id FROM leads WHERE whatsapp = ? AND whatsapp_valid = 1").get(row.lead.whatsapp) as { id: number } | undefined;
        if (phoneTaken) {
          counts.skipped++;
          report.push({ rowNumber: row.rowNumber, values: row.values, result: "ignorado", reason: "WhatsApp já cadastrado.", leadId: phoneTaken.id });
          continue;
        }
        const leadId = insertLead(db, row.lead, { userId, source: "import", batchId, registrationStatus: "prospect" });
        addItem.run(batchId, leadId, row.rowNumber, "imported");
        counts.imported++;
        report.push({
          rowNumber: row.rowNumber,
          values: row.values,
          result: "importado",
          reason: row.duplicate ? `Importado apesar de possível duplicidade: ${row.duplicate.message}` : "",
          leadId,
        });
      }
    })();
  } catch (error) {
    db.prepare("UPDATE import_batches SET status = 'failed', completed_at = ? WHERE id = ?").run(nowIso(), batchId);
    throw error;
  }

  db.prepare(
    `UPDATE import_batches SET imported_rows = ?, updated_rows = ?, skipped_rows = ?, error_rows = ?, duplicate_rows = ?,
      status = ?, report_json = ?, completed_at = ? WHERE id = ?`,
  ).run(
    counts.imported,
    counts.updated,
    counts.skipped,
    counts.errors,
    analysis.duplicateRows,
    counts.errors > 0 ? "completed_with_errors" : "completed",
    JSON.stringify(report),
    nowIso(),
    batchId,
  );
  return { ...getBatch(db, batchId), report };
}

export function listBatches(db: DB, page = 1, pageSize = 20) {
  const total = (db.prepare("SELECT COUNT(*) AS c FROM import_batches").get() as { c: number }).c;
  const items = db
    .prepare(
      `SELECT b.id, b.original_filename, b.total_rows, b.imported_rows, b.updated_rows, b.skipped_rows, b.error_rows, b.duplicate_rows,
        b.status, b.imported_by, u.name AS imported_by_name, b.created_at, b.completed_at
       FROM import_batches b LEFT JOIN users u ON u.id = b.imported_by ORDER BY b.id DESC LIMIT ? OFFSET ?`,
    )
    .all(pageSize, (page - 1) * pageSize) as ImportBatch[];
  return { items, total, page, pageSize };
}

export function getBatch(db: DB, id: number): ImportBatch {
  const batch = db
    .prepare(
      `SELECT b.id, b.original_filename, b.total_rows, b.imported_rows, b.updated_rows, b.skipped_rows, b.error_rows, b.duplicate_rows,
        b.status, b.imported_by, u.name AS imported_by_name, b.created_at, b.completed_at
       FROM import_batches b LEFT JOIN users u ON u.id = b.imported_by WHERE b.id = ?`,
    )
    .get(id) as ImportBatch | undefined;
  if (!batch) throw notFound("Lote");
  return batch;
}

export function batchReport(db: DB, id: number): ReportRow[] {
  const row = db.prepare("SELECT report_json FROM import_batches WHERE id = ?").get(id) as { report_json: string } | undefined;
  if (!row) throw notFound("Lote");
  return JSON.parse(row.report_json) as ReportRow[];
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; // prevents CSV formula injection
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function reportToCsv(report: ReportRow[]): string {
  const header = ["Linha", "Nome do estabelecimento", "Segmento", "Bairro", "Cidade", "Estado", "WhatsApp", "Link", "Link adicional", "Resultado", "Motivo"];
  const lines = [header.join(";")];
  for (const r of report) {
    const v = r.values;
    lines.push(
      [r.rowNumber, v.establishment_name, v.segment, v.neighborhood, v.city, v.state, v.whatsapp, v.digital_presence_url, v.extra_link, r.result, r.reason]
        .map(csvCell)
        .join(";"),
    );
  }
  return String.fromCharCode(0xfeff) + lines.join("\r\n") + "\r\n";
}
