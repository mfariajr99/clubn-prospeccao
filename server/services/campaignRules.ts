import { buildRuleView, fmtBrDateTime, lotAt, lotWindow, type CampaignRuleView, type LotsView } from "../../shared/campaignRule.js";
import type { DB } from "../db/core.js";
import { HttpError, notFound } from "../lib/http.js";

export const SEND_EVENTS = "('whatsapp_opened','whatsapp_sent')";

/** Rule usage of a campaign right now. */
export function campaignRule(
  db: DB,
  c: { id: number; send_limit?: number | null; send_window_hours?: number | null; scheduled_start_at?: string | null; scheduled_end_at?: string | null },
  now = new Date(),
): CampaignRuleView {
  let times: string[] = [];
  if (c.send_limit && c.send_window_hours) {
    const since = new Date(now.getTime() - c.send_window_hours * 3600_000).toISOString();
    times = (
      db
        .prepare(`SELECT changed_at FROM contact_history WHERE campaign_id = ? AND event_type IN ${SEND_EVENTS} AND changed_at > ? ORDER BY changed_at`)
        .all(c.id, since) as { changed_at: string }[]
    ).map((r) => r.changed_at);
  }
  return buildRuleView(c, times, now);
}

/** Throws 429 when the campaign's schedule or dispatch rule does not allow one more message now. */
export function assertCampaignCanSend(db: DB, campaignId: number, now = new Date()): CampaignRuleView {
  const c = db.prepare("SELECT id, send_limit, send_window_hours, scheduled_start_at, scheduled_end_at FROM campaigns WHERE id = ?").get(campaignId) as
    | { id: number; send_limit: number | null; send_window_hours: number | null; scheduled_start_at: string | null; scheduled_end_at: string | null }
    | undefined;
  if (!c) throw notFound("Campanha");
  const rule = campaignRule(db, c, now);
  if (rule.blocked_reason) throw new HttpError(429, rule.blocked_reason, { campaign_rule: rule, campaign_id: campaignId });
  return rule;
}

/**
 * Applies schedules: a "ready" campaign starts by itself at its start time and any
 * open campaign is completed at its end time. Only statuses change — no message is
 * ever sent by the system.
 */
export function syncScheduledCampaigns(db: DB, now = new Date()): void {
  const iso = now.toISOString();
  const due = db
    .prepare(
      `SELECT 1 FROM campaigns WHERE (status = 'ready' AND scheduled_start_at IS NOT NULL AND scheduled_start_at <= ?)
        OR (status IN ('ready','in_progress','paused') AND scheduled_end_at IS NOT NULL AND scheduled_end_at <= ?) LIMIT 1`,
    )
    .get(iso, iso);
  if (!due) return;
  db.transaction(() => {
    db.prepare(
      `UPDATE campaigns SET status = 'completed', completed_at = ?, updated_at = ?
       WHERE status IN ('ready','in_progress','paused') AND scheduled_end_at IS NOT NULL AND scheduled_end_at <= ?`,
    ).run(iso, iso, iso);
    db.prepare(
      `UPDATE campaigns SET status = 'in_progress', started_at = COALESCE(started_at, scheduled_start_at), updated_at = ?
       WHERE status = 'ready' AND scheduled_start_at IS NOT NULL AND scheduled_start_at <= ?
         AND EXISTS (SELECT 1 FROM campaign_leads cl WHERE cl.campaign_id = campaigns.id)`,
    ).run(iso, iso);
  })();
}


// ---------------- Lots ----------------

type LotCampaign = { id: number; batch_size?: number | null; batch_hours?: number | null; scheduled_start_at?: string | null };
const isLotCampaign = (c: LotCampaign): c is LotCampaign & { batch_size: number; batch_hours: number; scheduled_start_at: string } =>
  Boolean(c.batch_size && c.batch_hours && c.scheduled_start_at);

/** Lots of a campaign with their windows and numbers, plus the spacing guide. */
export function campaignLots(db: DB, c: LotCampaign, now = new Date()): LotsView | null {
  if (!isLotCampaign(c)) return null;
  const rows = db
    .prepare(
      `SELECT batch_number AS number, COUNT(*) AS total,
        SUM(CASE WHEN contact_status <> 'not_contacted' THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN contact_status IN ('replied','interested','not_interested','partnership') THEN 1 ELSE 0 END) AS replied
       FROM campaign_leads WHERE campaign_id = ? AND batch_number IS NOT NULL GROUP BY batch_number ORDER BY batch_number`,
    )
    .all(c.id) as { number: number; total: number; sent: number; replied: number }[];
  const totalLots = rows.length ? rows[rows.length - 1].number : 0;
  const at = lotAt(c.scheduled_start_at, c.batch_hours, now);
  const current = at >= 1 && at <= totalLots ? at : null;
  const nextNumber = at < 1 ? 1 : at + 1;
  const gap = Math.max(1, Math.floor((c.batch_hours * 60) / c.batch_size));
  let suggested: string | null = null;
  if (current) {
    const last = db
      .prepare(`SELECT MAX(changed_at) AS t FROM contact_history WHERE campaign_id = ? AND event_type IN ${SEND_EVENTS}`)
      .get(c.id) as { t: string | null };
    const next = last.t ? Date.parse(last.t) + gap * 60_000 : now.getTime();
    suggested = new Date(Math.max(next, now.getTime())).toISOString();
  }
  return {
    size: c.batch_size,
    hours: c.batch_hours,
    total_lots: totalLots,
    current,
    next_start: nextNumber <= totalLots ? lotWindow(c.scheduled_start_at, c.batch_hours, nextNumber).start : null,
    lots: rows.map((r) => ({ ...r, sent: r.sent ?? 0, replied: r.replied ?? 0, ...lotWindow(c.scheduled_start_at, c.batch_hours, r.number) })),
    gap_minutes: gap,
    suggested_next_at: suggested,
  };
}

/**
 * Puts leads without a lot into lots (filling the last lot first, never a lot whose
 * window already ended) and moves the campaign end to the end of the last lot.
 */
export function assignLots(db: DB, campaignId: number, now = new Date()): void {
  const c = db.prepare("SELECT id, batch_size, batch_hours, scheduled_start_at FROM campaigns WHERE id = ?").get(campaignId) as LotCampaign | undefined;
  if (!c) return;
  if (!isLotCampaign(c)) {
    db.prepare("UPDATE campaign_leads SET batch_number = NULL WHERE campaign_id = ? AND batch_number IS NOT NULL").run(campaignId);
    return;
  }
  const counts = new Map(
    (db.prepare("SELECT batch_number AS n, COUNT(*) AS c FROM campaign_leads WHERE campaign_id = ? AND batch_number IS NOT NULL GROUP BY batch_number").all(campaignId) as { n: number; c: number }[]).map(
      (r) => [r.n, r.c],
    ),
  );
  const pending = db.prepare("SELECT id FROM campaign_leads WHERE campaign_id = ? AND batch_number IS NULL ORDER BY id").all(campaignId) as { id: number }[];
  let lot = Math.max(1, lotAt(c.scheduled_start_at, c.batch_hours, now), counts.size ? Math.max(...counts.keys()) : 1);
  const set = db.prepare("UPDATE campaign_leads SET batch_number = ? WHERE id = ?");
  for (const row of pending) {
    while ((counts.get(lot) ?? 0) >= c.batch_size) lot++;
    set.run(lot, row.id);
    counts.set(lot, (counts.get(lot) ?? 0) + 1);
  }
  const last = counts.size ? Math.max(...counts.keys()) : 1;
  db.prepare("UPDATE campaigns SET scheduled_end_at = ? WHERE id = ?").run(lotWindow(c.scheduled_start_at, c.batch_hours, last).end, campaignId);
}

/** A lead of a future lot cannot be contacted yet (earlier, late lots stay open). */
export function assertLeadLotOpen(db: DB, campaignId: number, leadId: number, now = new Date()): void {
  const row = db
    .prepare(
      `SELECT cl.batch_number, c.batch_size, c.batch_hours, c.scheduled_start_at FROM campaign_leads cl JOIN campaigns c ON c.id = cl.campaign_id
       WHERE cl.campaign_id = ? AND cl.lead_id = ?`,
    )
    .get(campaignId, leadId) as { batch_number: number | null; batch_size: number | null; batch_hours: number | null; scheduled_start_at: string | null } | undefined;
  if (!row?.batch_number || !row.batch_hours || !row.scheduled_start_at) return;
  const window = lotWindow(row.scheduled_start_at, row.batch_hours, row.batch_number);
  if (Date.parse(window.start) > now.getTime()) {
    throw new HttpError(429, `Este lead é do lote ${row.batch_number}, liberado em ${fmtBrDateTime(window.start)}.`, { lot: row.batch_number, lot_start: window.start });
  }
}
