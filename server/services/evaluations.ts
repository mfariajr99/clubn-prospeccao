import type { Evaluation } from "../../shared/types.js";
import { EVALUATION_CHECKLIST } from "../../shared/constants.js";
import { sanitizeText } from "../../shared/text.js";
import { nowIso, type DB } from "../db/core.js";
import { HttpError, notFound } from "../lib/http.js";

export interface EvaluationInput {
  campaign_id?: number | null;
  potential_level: "low" | "medium" | "high";
  score: number;
  digital_presence_quality?: "low" | "medium" | "high" | null;
  campaign_compatibility?: "low" | "medium" | "high" | null;
  perceived_popularity?: "low" | "medium" | "high" | null;
  visual_quality?: "low" | "medium" | "high" | null;
  checklist_data?: Record<string, boolean>;
  notes?: string | null;
}

interface EvaluationRow extends Omit<Evaluation, "checklist_data"> {
  checklist_data: string;
}

const SELECT = `SELECT e.*, u.name AS evaluator_name FROM prospect_evaluations e LEFT JOIN users u ON u.id = e.evaluator_user_id`;

function parse(row: EvaluationRow): Evaluation {
  let checklist: Record<string, boolean>;
  try {
    checklist = JSON.parse(row.checklist_data);
  } catch {
    checklist = {};
  }
  return { ...row, checklist_data: checklist };
}

export function listEvaluations(db: DB, leadId: number): Evaluation[] {
  return (db.prepare(`${SELECT} WHERE e.lead_id = ? ORDER BY e.campaign_id IS NOT NULL, e.updated_at DESC`).all(leadId) as EvaluationRow[]).map(parse);
}

/** Manual evaluation. One general evaluation and one per campaign may coexist. */
export function saveEvaluation(db: DB, leadId: number, input: EvaluationInput, userId: number): Evaluation {
  if (!db.prepare("SELECT id FROM leads WHERE id = ?").get(leadId)) throw notFound("Lead");
  if (input.campaign_id) {
    const inCampaign = db.prepare("SELECT 1 FROM campaign_leads WHERE campaign_id = ? AND lead_id = ?").get(input.campaign_id, leadId);
    if (!inCampaign) throw new HttpError(400, "O lead não faz parte desta campanha.");
  }
  const allowedKeys = new Set<string>(EVALUATION_CHECKLIST.map((c) => c.key));
  const checklist = Object.fromEntries(Object.entries(input.checklist_data ?? {}).filter(([k, v]) => allowedKeys.has(k) && typeof v === "boolean"));
  const now = nowIso();
  const campaignId = input.campaign_id ?? null;
  const existing = db
    .prepare("SELECT id FROM prospect_evaluations WHERE lead_id = ? AND IFNULL(campaign_id, 0) = IFNULL(?, 0)")
    .get(leadId, campaignId) as { id: number } | undefined;
  const values = [
    userId,
    input.potential_level,
    input.score,
    input.digital_presence_quality ?? null,
    input.campaign_compatibility ?? null,
    input.perceived_popularity ?? null,
    input.visual_quality ?? null,
    JSON.stringify(checklist),
    sanitizeText(input.notes, 2000) || null,
  ];
  let id: number;
  if (existing) {
    db.prepare(
      `UPDATE prospect_evaluations SET evaluator_user_id = ?, potential_level = ?, score = ?, digital_presence_quality = ?, campaign_compatibility = ?,
        perceived_popularity = ?, visual_quality = ?, checklist_data = ?, notes = ?, updated_at = ? WHERE id = ?`,
    ).run(...values, now, existing.id);
    id = existing.id;
  } else {
    id = Number(
      db
        .prepare(
          `INSERT INTO prospect_evaluations (lead_id, campaign_id, evaluator_user_id, potential_level, score, digital_presence_quality,
            campaign_compatibility, perceived_popularity, visual_quality, checklist_data, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(leadId, campaignId, ...values, now, now).lastInsertRowid,
    );
  }
  return parse(db.prepare(`${SELECT} WHERE e.id = ?`).get(id) as EvaluationRow);
}
