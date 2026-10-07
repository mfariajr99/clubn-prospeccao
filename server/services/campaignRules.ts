import { buildRuleView, type CampaignRuleView } from "../../shared/campaignRule.js";
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

