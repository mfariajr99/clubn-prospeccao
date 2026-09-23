import type { ContactStatus, LinkType } from "../../shared/constants.js";
import { CONTACT_STATUSES } from "../../shared/constants.js";
import { nameLocationKey } from "../../shared/importMapping.js";
import type { NormalizedLead } from "../../shared/leadInput.js";
import type { ContactHistoryEntry, Lead, LeadLink, Paginated } from "../../shared/types.js";
import { comparisonKey } from "../../shared/text.js";
import { nowIso, type DB } from "../db/core.js";
import { HttpError, notFound } from "../lib/http.js";
import type { QuotaView } from "../../shared/sendQuota.js";
import { consumeQuota } from "./quota.js";

export interface LeadFilter {
  q?: string;
  segment?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  registration_status?: string;
  contact_status?: string;
  batch_id?: number;
  presence?: string; // with | without | <LinkType>
  potential?: string; // high | medium | low | none
  not_in_campaign?: number;
  ids?: number[];
}

export interface LeadListOptions extends LeadFilter {
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: "asc" | "desc";
}

const SORTS: Record<string, string> = {
  name: "l.establishment_name COLLATE NOCASE",
  created_at: "l.created_at",
  city: "l.city COLLATE NOCASE",
  segment: "l.segment COLLATE NOCASE",
  status: "l.contact_status",
  potential: "CASE ev.potential_level WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END",
};

export function buildLeadWhere(filter: LeadFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.q?.trim()) {
    const q = filter.q.trim();
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 4) {
      clauses.push("(l.establishment_name LIKE ? ESCAPE '\\' OR l.whatsapp LIKE ?)");
      params.push(`%${escapeLike(q)}%`, `%${digits}%`);
    } else {
      clauses.push("(l.establishment_name LIKE ? ESCAPE '\\' OR l.name_key LIKE ? ESCAPE '\\')");
      params.push(`%${escapeLike(q)}%`, `%${escapeLike(comparisonKey(q))}%`);
    }
  }
  for (const field of ["segment", "neighborhood", "city", "state", "registration_status", "contact_status"] as const) {
    const value = filter[field];
    if (value) {
      clauses.push(`l.${field} = ? COLLATE NOCASE`);
      params.push(value);
    }
  }
  if (filter.batch_id) {
    clauses.push("(l.import_batch_id = ? OR EXISTS (SELECT 1 FROM import_batch_items bi WHERE bi.lead_id = l.id AND bi.batch_id = ?))");
    params.push(filter.batch_id, filter.batch_id);
  }
  if (filter.presence === "with") clauses.push("l.digital_presence_url IS NOT NULL");
  else if (filter.presence === "without") clauses.push("l.digital_presence_url IS NULL");
  else if (filter.presence) {
    clauses.push("EXISTS (SELECT 1 FROM lead_links ll WHERE ll.lead_id = l.id AND ll.link_type = ?)");
    params.push(filter.presence);
  }
  if (filter.potential === "none") clauses.push("ev.potential_level IS NULL");
  else if (filter.potential) {
    clauses.push("ev.potential_level = ?");
    params.push(filter.potential);
  }
  if (filter.not_in_campaign) {
    clauses.push("NOT EXISTS (SELECT 1 FROM campaign_leads cx WHERE cx.lead_id = l.id AND cx.campaign_id = ?)");
    params.push(filter.not_in_campaign);
  }
  if (filter.ids) {
    if (filter.ids.length === 0) clauses.push("0");
    else {
      clauses.push(`l.id IN (${filter.ids.map(() => "?").join(",")})`);
      params.push(...filter.ids);
    }
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export const LEAD_FROM = `
FROM leads l
LEFT JOIN import_batches b ON b.id = l.import_batch_id
LEFT JOIN users u ON u.id = l.created_by
LEFT JOIN prospect_evaluations ev ON ev.lead_id = l.id AND ev.campaign_id IS NULL`;

const ACTIVE_CAMPAIGN = `(SELECT c.id FROM campaign_leads cl JOIN campaigns c ON c.id = cl.campaign_id
  WHERE cl.lead_id = l.id AND c.status = 'in_progress' ORDER BY c.updated_at DESC LIMIT 1)`;

export const LEAD_COLUMNS = `l.*, b.original_filename AS import_batch_filename, u.name AS created_by_name,
  ev.potential_level AS potential_level, ev.score AS score,
  ${ACTIVE_CAMPAIGN} AS active_campaign_id,
  (SELECT name FROM campaigns WHERE id = ${ACTIVE_CAMPAIGN}) AS active_campaign_name,
  (SELECT message_template FROM campaigns WHERE id = ${ACTIVE_CAMPAIGN}) AS active_campaign_message,
  (SELECT message_template_2 FROM campaigns WHERE id = ${ACTIVE_CAMPAIGN}) AS active_campaign_message_2,
  (SELECT message_template_3 FROM campaigns WHERE id = ${ACTIVE_CAMPAIGN}) AS active_campaign_message_3`;

export function listLeads(db: DB, options: LeadListOptions): Paginated<Lead> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, options.pageSize ?? 20));
  const where = buildLeadWhere(options);
  const sortExpr = SORTS[options.sort ?? "created_at"] ?? SORTS.created_at;
  const dir = options.dir === "asc" ? "ASC" : "DESC";
  const total = (db.prepare(`SELECT COUNT(*) AS c ${LEAD_FROM} ${where.sql}`).get(...where.params) as { c: number }).c;
  const items = db
    .prepare(`SELECT ${LEAD_COLUMNS} ${LEAD_FROM} ${where.sql} ORDER BY ${sortExpr} ${dir}, l.id DESC LIMIT ? OFFSET ?`)
    .all(...where.params, pageSize, (page - 1) * pageSize) as Lead[];
  attachLinks(db, items);
  return { items, total, page, pageSize };
}

export function listLeadIds(db: DB, filter: LeadFilter): number[] {
  const where = buildLeadWhere(filter);
  return (db.prepare(`SELECT l.id ${LEAD_FROM} ${where.sql}`).all(...where.params) as { id: number }[]).map((r) => r.id);
}

export function attachLinks<T extends { id: number; links?: LeadLink[] }>(db: DB, leads: T[], idKey: keyof T = "id"): void {
  if (leads.length === 0) return;
  const ids = leads.map((l) => l[idKey] as unknown as number);
  const rows = db
    .prepare(`SELECT * FROM lead_links WHERE lead_id IN (${ids.map(() => "?").join(",")}) ORDER BY is_primary DESC, id`)
    .all(...ids) as LeadLink[];
  const byLead = new Map<number, LeadLink[]>();
  for (const row of rows) {
    const list = byLead.get(row.lead_id) ?? [];
    list.push(row);
    byLead.set(row.lead_id, list);
  }
  for (const lead of leads) lead.links = byLead.get(lead[idKey] as unknown as number) ?? [];
}

export function getLead(db: DB, id: number): Lead {
  const lead = db.prepare(`SELECT ${LEAD_COLUMNS} ${LEAD_FROM} WHERE l.id = ?`).get(id) as Lead | undefined;
  if (!lead) throw notFound("Lead");
  attachLinks(db, [lead]);
  return lead;
}

export function findByPhone(db: DB, whatsapp: string): Lead | undefined {
  return db.prepare("SELECT * FROM leads WHERE whatsapp = ? AND whatsapp_valid = 1").get(whatsapp) as Lead | undefined;
}

export function findByNameLocation(db: DB, lead: Pick<NormalizedLead, "establishment_name" | "city" | "state">): Lead[] {
  const key = nameLocationKey(lead);
  return db.prepare("SELECT * FROM leads WHERE name_key = ?").all(key) as Lead[];
}

export interface DuplicateCheck {
  phone: Lead | null;
  nameLocation: Lead[];
}

export function checkDuplicates(db: DB, lead: NormalizedLead, excludeId?: number): DuplicateCheck {
  const phone = findByPhone(db, lead.whatsapp);
  return {
    phone: phone && phone.id !== excludeId ? phone : null,
    nameLocation: findByNameLocation(db, lead).filter((l) => l.id !== excludeId),
  };
}

interface WriteContext {
  userId: number;
  source?: "manual" | "import" | "seed";
  batchId?: number | null;
  registrationStatus?: string;
}

function writeLinks(db: DB, leadId: number, lead: NormalizedLead): void {
  const links: { url: string; type: LinkType; primary: boolean }[] = [];
  if (lead.digital_presence_url && lead.digital_presence_type) {
    links.push({ url: lead.digital_presence_url, type: lead.digital_presence_type, primary: true });
  }
  for (const extra of lead.extra_links) links.push({ url: extra.url, type: extra.type, primary: false });
  db.prepare("DELETE FROM lead_links WHERE lead_id = ?").run(leadId);
  const insert = db.prepare("INSERT OR IGNORE INTO lead_links (lead_id, url, link_type, is_primary) VALUES (?, ?, ?, ?)");
  for (const link of links) insert.run(leadId, link.url, link.type, link.primary ? 1 : 0);
  // Drop cached previews of links that no longer belong to the lead.
  const urls = links.map((l) => l.url);
  if (urls.length === 0) db.prepare("DELETE FROM link_previews WHERE lead_id = ?").run(leadId);
  else
    db.prepare(`DELETE FROM link_previews WHERE lead_id = ? AND original_url NOT IN (${urls.map(() => "?").join(",")})`).run(leadId, ...urls);
}

export function insertLead(db: DB, lead: NormalizedLead, ctx: WriteContext): number {
  const now = nowIso();
  const info = db
    .prepare(
      `INSERT INTO leads (establishment_name, name_key, segment, neighborhood, city, state, whatsapp, whatsapp_valid,
        digital_presence_url, digital_presence_type, cover_image_url, registration_status, source, import_batch_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      lead.establishment_name,
      nameLocationKey(lead),
      lead.segment,
      lead.neighborhood,
      lead.city,
      lead.state,
      lead.whatsapp,
      lead.digital_presence_url,
      lead.digital_presence_type,
      lead.cover_image_url,
      ctx.registrationStatus ?? "prospect",
      ctx.source ?? "manual",
      ctx.batchId ?? null,
      ctx.userId,
      now,
      now,
    );
  const id = Number(info.lastInsertRowid);
  writeLinks(db, id, lead);
  return id;
}

export function updateLeadRecord(db: DB, id: number, lead: NormalizedLead, registrationStatus?: string): void {
  const info = db
    .prepare(
      `UPDATE leads SET establishment_name = ?, name_key = ?, segment = ?, neighborhood = ?, city = ?, state = ?, whatsapp = ?,
        whatsapp_valid = 1, digital_presence_url = ?, digital_presence_type = ?, cover_image_url = ?,
        registration_status = COALESCE(?, registration_status), updated_at = ? WHERE id = ?`,
    )
    .run(
      lead.establishment_name,
      nameLocationKey(lead),
      lead.segment,
      lead.neighborhood,
      lead.city,
      lead.state,
      lead.whatsapp,
      lead.digital_presence_url,
      lead.digital_presence_type,
      lead.cover_image_url,
      registrationStatus ?? null,
      nowIso(),
      id,
    );
  if (info.changes === 0) throw notFound("Lead");
  writeLinks(db, id, lead);
}

// ---------------------------------------------------------------------------
// Contact status (manual) and the "WhatsApp aberto" event.
// ---------------------------------------------------------------------------

interface CampaignLeadRow {
  id: number;
  contact_status: ContactStatus;
  campaign_status: string;
}

function getCampaignLead(db: DB, campaignId: number, leadId: number): CampaignLeadRow {
  const row = db
    .prepare(
      `SELECT cl.id, cl.contact_status, c.status AS campaign_status FROM campaign_leads cl
       JOIN campaigns c ON c.id = cl.campaign_id WHERE cl.campaign_id = ? AND cl.lead_id = ?`,
    )
    .get(campaignId, leadId) as CampaignLeadRow | undefined;
  if (!row) throw new HttpError(404, "Este lead não faz parte da campanha.");
  return row;
}

function leadStatus(db: DB, leadId: number): ContactStatus {
  const row = db.prepare("SELECT contact_status FROM leads WHERE id = ?").get(leadId) as { contact_status: ContactStatus } | undefined;
  if (!row) throw notFound("Lead");
  return row.contact_status;
}

export function changeContactStatus(
  db: DB,
  input: { leadId: number; campaignId?: number | null; status: ContactStatus; notes?: string | null; userId: number },
): { previous: ContactStatus; current: ContactStatus } {
  if (!CONTACT_STATUSES.includes(input.status)) throw new HttpError(400, "Status de contato inválido.");
  return db.transaction(() => {
    const now = nowIso();
    let previous: ContactStatus;
    if (input.campaignId) {
      const cl = getCampaignLead(db, input.campaignId, input.leadId);
      previous = cl.contact_status;
      db.prepare(
        `UPDATE campaign_leads SET contact_status = ?, last_contact_at = CASE WHEN ? = 'not_contacted' THEN last_contact_at ELSE ? END,
         notes = COALESCE(?, notes), updated_at = ? WHERE id = ?`,
      ).run(input.status, input.status, now, input.notes || null, now, cl.id);
    } else {
      previous = leadStatus(db, input.leadId);
    }
    db.prepare("UPDATE leads SET contact_status = ?, updated_at = ? WHERE id = ?").run(input.status, now, input.leadId);
    db.prepare(
      `INSERT INTO contact_history (lead_id, campaign_id, event_type, previous_status, new_status, notes, changed_by, changed_at)
       VALUES (?, ?, 'status_change', ?, ?, ?, ?, ?)`,
    ).run(input.leadId, input.campaignId ?? null, previous, input.status, input.notes || null, input.userId, now);
    if (input.campaignId) db.prepare("UPDATE campaigns SET updated_at = ? WHERE id = ?").run(now, input.campaignId);
    return { previous, current: input.status };
  })();
}

/**
 * Records that the operator clicked "Enviar mensagem" and WhatsApp was opened.
 * It NEVER marks the message as sent: the only automatic transition allowed is
 * "Não contatado" -> "WhatsApp aberto".
 */
export function registerWhatsAppOpened(
  db: DB,
  input: { leadId: number; campaignId?: number | null; userId: number; messageType?: number | null; now?: Date },
): { previous: ContactStatus; current: ContactStatus; opened_at: string; message_type: number; quota: QuotaView } {
  return db.transaction(() => {
    const nowDate = input.now ?? new Date();
    const now = nowDate.toISOString();
    let previous: ContactStatus;
    let current: ContactStatus;
    if (input.campaignId) {
      const cl = getCampaignLead(db, input.campaignId, input.leadId);
      if (cl.campaign_status !== "in_progress") {
        throw new HttpError(409, "A campanha precisa estar em andamento para registrar contatos.");
      }
      previous = cl.contact_status;
      current = previous === "not_contacted" ? "whatsapp_opened" : previous;
      db.prepare("UPDATE campaign_leads SET contact_status = ?, whatsapp_opened_at = ?, last_contact_at = ?, updated_at = ? WHERE id = ?").run(
        current,
        now,
        now,
        now,
        cl.id,
      );
      db.prepare("UPDATE campaigns SET updated_at = ? WHERE id = ?").run(now, input.campaignId);
    } else {
      previous = leadStatus(db, input.leadId);
      current = previous === "not_contacted" ? "whatsapp_opened" : previous;
    }
    // Sending discipline per operator (sessions/pauses). Throws 429 while paused;
    // the whole transaction (status changes included) is then rolled back.
    const consumed = consumeQuota(db, input.userId, nowDate);
    const messageType = input.messageType && input.messageType >= 1 && input.messageType <= 3 ? input.messageType : consumed.messageType;
    const leadCurrent = leadStatus(db, input.leadId);
    if (leadCurrent === "not_contacted") {
      db.prepare("UPDATE leads SET contact_status = 'whatsapp_opened', updated_at = ? WHERE id = ?").run(now, input.leadId);
    }
    db.prepare(
      `INSERT INTO contact_history (lead_id, campaign_id, event_type, previous_status, new_status, notes, changed_by, changed_at, message_type)
       VALUES (?, ?, 'whatsapp_opened', ?, ?, ?, ?, ?, ?)`,
    ).run(input.leadId, input.campaignId ?? null, previous, current, `WhatsApp aberto pelo operador (mensagem ${messageType})`, input.userId, now, messageType);
    return { previous, current, opened_at: now, message_type: messageType, quota: consumed.quota };
  })();
}

export function leadHistory(db: DB, leadId: number): ContactHistoryEntry[] {
  return db
    .prepare(
      `SELECT h.*, c.name AS campaign_name, u.name AS changed_by_name FROM contact_history h
       LEFT JOIN campaigns c ON c.id = h.campaign_id LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.lead_id = ? ORDER BY h.changed_at DESC, h.id DESC LIMIT 200`,
    )
    .all(leadId) as ContactHistoryEntry[];
}

export function leadCampaigns(db: DB, leadId: number) {
  return db
    .prepare(
      `SELECT c.id, c.name, c.status, c.message_template, cl.contact_status, cl.whatsapp_opened_at, cl.last_contact_at
       FROM campaign_leads cl JOIN campaigns c ON c.id = cl.campaign_id WHERE cl.lead_id = ? ORDER BY c.updated_at DESC`,
    )
    .all(leadId);
}

export function distinctValues(db: DB) {
  const col = (field: string) =>
    (db.prepare(`SELECT DISTINCT ${field} AS v FROM leads WHERE ${field} <> '' ORDER BY ${field} COLLATE NOCASE LIMIT 500`).all() as { v: string }[]).map(
      (r) => r.v,
    );
  return {
    segments: col("segment"),
    neighborhoods: col("neighborhood"),
    cities: col("city"),
    states: col("state"),
    batches: db
      .prepare("SELECT id, original_filename, created_at FROM import_batches WHERE status <> 'failed' ORDER BY id DESC LIMIT 100")
      .all(),
  };
}
