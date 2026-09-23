import type { CampaignStatus } from "../../shared/constants.js";
import { CONTACTED_STATUSES, EDITABLE_CAMPAIGN_STATUSES } from "../../shared/constants.js";
import { findUnknownVariables } from "../../shared/template.js";
import type { Campaign, CampaignLead, Paginated } from "../../shared/types.js";
import { nowIso, type DB } from "../db/core.js";
import { HttpError, notFound } from "../lib/http.js";
import { attachLinks, buildLeadWhere, listLeadIds, type LeadFilter } from "./leads.js";

const CONTACTED_SQL = CONTACTED_STATUSES.map((s) => `'${s}'`).join(",");

const CAMPAIGN_SELECT = `
SELECT c.*, u.name AS created_by_name,
  (SELECT COUNT(*) FROM campaign_leads cl WHERE cl.campaign_id = c.id) AS lead_count,
  (SELECT COUNT(*) FROM campaign_leads cl WHERE cl.campaign_id = c.id AND cl.whatsapp_opened_at IS NOT NULL) AS opened_count,
  (SELECT COUNT(*) FROM campaign_leads cl WHERE cl.campaign_id = c.id AND cl.contact_status IN (${CONTACTED_SQL})) AS contacted_count,
  (SELECT COUNT(*) FROM campaign_leads cl WHERE cl.campaign_id = c.id AND cl.contact_status IN ('interested','partnership')) AS interested_count,
  (SELECT COUNT(*) FROM campaign_leads cl WHERE cl.campaign_id = c.id AND cl.contact_status = 'partnership') AS partnership_count,
  (SELECT MAX(h.changed_at) FROM contact_history h WHERE h.campaign_id = c.id) AS last_activity_at
FROM campaigns c LEFT JOIN users u ON u.id = c.created_by`;

export interface CampaignInput {
  name: string;
  description: string;
  message_template: string;
  message_template_2: string;
  message_template_3: string;
  status: CampaignStatus;
}

export function validateCampaignInput(input: CampaignInput): void {
  [input.message_template, input.message_template_2, input.message_template_3].forEach((template, i) => {
    const unknown = findUnknownVariables(template);
    if (unknown.length) {
      throw new HttpError(400, `Variáveis desconhecidas na mensagem ${i + 1}: ${unknown.map((v) => `{{${v}}}`).join(", ")}.`, { unknown, message: i + 1 });
    }
  });
  // New campaigns and edits are saved as draft/ready; other statuses use the status endpoint.
  if (!["draft", "ready"].includes(input.status)) throw new HttpError(400, "Status inválido para salvar a campanha.");
}

export function listCampaigns(
  db: DB,
  options: { q?: string; status?: string; statuses?: string[]; page?: number; pageSize?: number; sort?: string; dir?: string },
): Paginated<Campaign> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.q?.trim()) {
    clauses.push("c.name LIKE ?");
    params.push(`%${options.q.trim()}%`);
  }
  if (options.status) {
    clauses.push("c.status = ?");
    params.push(options.status);
  }
  if (options.statuses?.length) {
    clauses.push(`c.status IN (${options.statuses.map(() => "?").join(",")})`);
    params.push(...options.statuses);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const sorts: Record<string, string> = { name: "c.name COLLATE NOCASE", created_at: "c.created_at", updated_at: "c.updated_at", status: "c.status" };
  const sort = sorts[options.sort ?? "updated_at"] ?? sorts.updated_at;
  const dir = options.dir === "asc" ? "ASC" : "DESC";
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM campaigns c ${where}`).get(...params) as { c: number }).c;
  const items = db.prepare(`${CAMPAIGN_SELECT} ${where} ORDER BY ${sort} ${dir}, c.id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as Campaign[];
  return { items, total, page, pageSize };
}

export function getCampaign(db: DB, id: number): Campaign {
  const campaign = db.prepare(`${CAMPAIGN_SELECT} WHERE c.id = ?`).get(id) as Campaign | undefined;
  if (!campaign) throw notFound("Campanha");
  return campaign;
}

export function createCampaign(db: DB, input: CampaignInput, userId: number, leads?: { leadIds?: number[]; filter?: LeadFilter }): Campaign {
  validateCampaignInput(input);
  return db.transaction(() => {
    const now = nowIso();
    const info = db
      .prepare(
        "INSERT INTO campaigns (name, description, message_template, message_template_2, message_template_3, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(input.name, input.description, input.message_template, input.message_template_2, input.message_template_3, input.status, userId, now, now);
    const id = Number(info.lastInsertRowid);
    if (leads) addLeadsToCampaign(db, id, leads);
    if (input.status === "ready" && countLeads(db, id) === 0) {
      throw new HttpError(400, "Selecione ao menos um lead para deixar a campanha pronta para iniciar.");
    }
    return getCampaign(db, id);
  })();
}

export function updateCampaign(db: DB, id: number, input: CampaignInput): Campaign {
  const current = getCampaign(db, id);
  if (!EDITABLE_CAMPAIGN_STATUSES.includes(current.status)) {
    throw new HttpError(409, "Campanhas em andamento ou concluídas não podem ser editadas. Pause a campanha para editar.");
  }
  validateCampaignInput({ ...input, status: current.status === "paused" ? "draft" : input.status });
  const status = current.status === "paused" ? "paused" : input.status;
  if (status === "ready" && countLeads(db, id) === 0) {
    throw new HttpError(400, "Selecione ao menos um lead para deixar a campanha pronta para iniciar.");
  }
  db.prepare(
    "UPDATE campaigns SET name = ?, description = ?, message_template = ?, message_template_2 = ?, message_template_3 = ?, status = ?, updated_at = ? WHERE id = ?",
  ).run(
    input.name,
    input.description,
    input.message_template,
    input.message_template_2,
    input.message_template_3,
    status,
    nowIso(),
    id,
  );
  return getCampaign(db, id);
}

function countLeads(db: DB, id: number): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM campaign_leads WHERE campaign_id = ?").get(id) as { c: number }).c;
}

const TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ["ready", "in_progress"],
  ready: ["draft", "in_progress"],
  in_progress: ["paused", "completed"],
  paused: ["in_progress", "completed", "draft"],
  completed: [],
};

export function changeCampaignStatus(db: DB, id: number, status: CampaignStatus): Campaign {
  const current = getCampaign(db, id);
  if (current.status === status) return current;
  if (!TRANSITIONS[current.status].includes(status)) {
    throw new HttpError(409, `Não é possível alterar a campanha de "${current.status}" para "${status}".`);
  }
  if ((status === "in_progress" || status === "ready") && countLeads(db, id) === 0) {
    throw new HttpError(400, "A campanha não possui leads. Adicione leads antes de iniciar.");
  }
  const unknown = [current.message_template, current.message_template_2 ?? "", current.message_template_3 ?? ""].flatMap((t) => findUnknownVariables(t));
  if (status === "in_progress" && unknown.length) {
    throw new HttpError(400, "A mensagem possui variáveis desconhecidas. Corrija antes de iniciar.");
  }
  const now = nowIso();
  db.prepare(
    `UPDATE campaigns SET status = ?, updated_at = ?,
      started_at = CASE WHEN ? = 'in_progress' AND started_at IS NULL THEN ? ELSE started_at END,
      completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END WHERE id = ?`,
  ).run(status, now, status, now, status, now, id);
  return getCampaign(db, id);
}

export function duplicateCampaign(db: DB, id: number, userId: number): Campaign {
  const source = getCampaign(db, id);
  return db.transaction(() => {
    const now = nowIso();
    const info = db
      .prepare(
        "INSERT INTO campaigns (name, description, message_template, message_template_2, message_template_3, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)",
      )
      .run(`${source.name} (cópia)`, source.description, source.message_template, source.message_template_2 ?? "", source.message_template_3 ?? "", userId, now, now);
    const newId = Number(info.lastInsertRowid);
    // Leads are copied with a fresh contact status: inclusion is not contact.
    db.prepare(
      "INSERT INTO campaign_leads (campaign_id, lead_id, contact_status, created_at, updated_at) SELECT ?, lead_id, 'not_contacted', ?, ? FROM campaign_leads WHERE campaign_id = ?",
    ).run(newId, now, now, id);
    return getCampaign(db, newId);
  })();
}

export function addLeadsToCampaign(db: DB, campaignId: number, input: { leadIds?: number[]; filter?: LeadFilter }): { added: number; alreadyInCampaign: number } {
  const campaign = db.prepare("SELECT status FROM campaigns WHERE id = ?").get(campaignId) as { status: CampaignStatus } | undefined;
  if (!campaign) throw notFound("Campanha");
  if (campaign.status === "completed") throw new HttpError(409, "Não é possível adicionar leads a uma campanha concluída.");
  let ids: number[] = [];
  if (input.leadIds?.length) ids = [...new Set(input.leadIds)];
  else if (input.filter) ids = listLeadIds(db, input.filter);
  if (ids.length === 0) return { added: 0, alreadyInCampaign: 0 };
  if (ids.length > 20000) throw new HttpError(400, "Seleção muito grande. Refine os filtros (máximo de 20.000 leads).");
  const now = nowIso();
  const insert = db.prepare(
    "INSERT OR IGNORE INTO campaign_leads (campaign_id, lead_id, contact_status, created_at, updated_at) SELECT ?, id, 'not_contacted', ?, ? FROM leads WHERE id = ?",
  );
  let added = 0;
  db.transaction(() => {
    for (const leadId of ids) added += insert.run(campaignId, now, now, leadId).changes;
    db.prepare("UPDATE campaigns SET updated_at = ? WHERE id = ?").run(now, campaignId);
  })();
  return { added, alreadyInCampaign: ids.length - added };
}

export function removeLeadFromCampaign(db: DB, campaignId: number, leadId: number): void {
  const info = db.prepare("DELETE FROM campaign_leads WHERE campaign_id = ? AND lead_id = ?").run(campaignId, leadId);
  if (info.changes === 0) throw notFound("Lead na campanha");
}

export function listCampaignLeads(
  db: DB,
  campaignId: number,
  options: LeadFilter & { campaign_contact_status?: string; page?: number; pageSize?: number; sort?: string; dir?: string },
): Paginated<CampaignLead> {
  getCampaign(db, campaignId);
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, options.pageSize ?? 25));
  const { campaign_contact_status, ...leadFilter } = options;
  const where = buildLeadWhere(leadFilter);
  const extra: string[] = ["cl.campaign_id = ?"];
  const params: unknown[] = [campaignId];
  if (campaign_contact_status) {
    extra.push("cl.contact_status = ?");
    params.push(campaign_contact_status);
  }
  const whereSql = where.sql ? `${where.sql} AND ${extra.join(" AND ")}` : `WHERE ${extra.join(" AND ")}`;
  const from = `FROM campaign_leads cl JOIN leads l ON l.id = cl.lead_id
    LEFT JOIN import_batches b ON b.id = l.import_batch_id
    LEFT JOIN users u ON u.id = l.created_by
    LEFT JOIN prospect_evaluations ev ON ev.lead_id = l.id AND ev.campaign_id IS NULL
    LEFT JOIN prospect_evaluations cev ON cev.lead_id = l.id AND cev.campaign_id = cl.campaign_id`;
  const sorts: Record<string, string> = {
    name: "l.establishment_name COLLATE NOCASE",
    status: "cl.contact_status",
    last_contact: "cl.last_contact_at",
    potential: "CASE COALESCE(cev.potential_level, ev.potential_level) WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END",
    added: "cl.id",
  };
  const sort = sorts[options.sort ?? "added"] ?? sorts.added;
  const dir = options.dir === "desc" ? "DESC" : "ASC";
  const allParams = [...where.params, ...params];
  const total = (db.prepare(`SELECT COUNT(*) AS c ${from} ${whereSql}`).get(...allParams) as { c: number }).c;
  const items = db
    .prepare(
      `SELECT l.*, b.original_filename AS import_batch_filename, u.name AS created_by_name,
        COALESCE(cev.potential_level, ev.potential_level) AS potential_level, COALESCE(cev.score, ev.score) AS score,
        cev.potential_level AS campaign_potential_level,
        cl.id AS campaign_lead_id, cl.campaign_id, cl.contact_status AS campaign_contact_status,
        cl.whatsapp_opened_at, cl.last_contact_at, cl.notes
       ${from} ${whereSql} ORDER BY ${sort} ${dir}, cl.id ASC LIMIT ? OFFSET ?`,
    )
    .all(...allParams, pageSize, (page - 1) * pageSize) as CampaignLead[];
  attachLinks(db, items);
  return { items, total, page, pageSize };
}

export function campaignResults(db: DB, campaignId: number) {
  const campaign = getCampaign(db, campaignId);
  const byStatus = db
    .prepare("SELECT contact_status AS status, COUNT(*) AS total FROM campaign_leads WHERE campaign_id = ? GROUP BY contact_status")
    .all(campaignId);
  const history = db
    .prepare(
      `SELECT h.*, l.establishment_name, u.name AS changed_by_name FROM contact_history h
       JOIN leads l ON l.id = h.lead_id LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.campaign_id = ? ORDER BY h.changed_at DESC, h.id DESC LIMIT 100`,
    )
    .all(campaignId);
  return { campaign, byStatus, history };
}
