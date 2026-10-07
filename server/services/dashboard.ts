import { CONTACTED_STATUSES } from "../../shared/constants.js";
import type { CampaignTracking, CampaignTrackingSummary, DashboardMetrics } from "../../shared/types.js";
import { brWeekRange, REPLY_GOAL, ruleCapacity } from "../../shared/campaignRule.js";
import { campaignRule } from "./campaignRules.js";
import type { DB } from "../db/core.js";

const CONTACTED = CONTACTED_STATUSES.map((s) => `'${s}'`).join(",");

/** All metrics are computed from real data. */
export function dashboardMetrics(db: DB): DashboardMetrics {
  const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  const conversionByPotential = db
    .prepare(
      `SELECT COALESCE(ev.potential_level, 'none') AS level, COUNT(*) AS total,
        SUM(CASE WHEN l.contact_status IN ('interested','partnership') THEN 1 ELSE 0 END) AS interested,
        SUM(CASE WHEN l.contact_status = 'partnership' THEN 1 ELSE 0 END) AS partnerships
       FROM leads l LEFT JOIN prospect_evaluations ev ON ev.lead_id = l.id AND ev.campaign_id IS NULL
       GROUP BY COALESCE(ev.potential_level, 'none')`,
    )
    .all() as DashboardMetrics["conversion_by_potential"];
  const order = ["high", "medium", "low", "none"];
  conversionByPotential.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));

  const byCampaign = db
    .prepare(
      `SELECT c.id, c.name, c.status, COUNT(cl.id) AS total,
        SUM(CASE WHEN cl.contact_status IN (${CONTACTED}) THEN 1 ELSE 0 END) AS contacted,
        SUM(CASE WHEN cl.contact_status IN ('interested','partnership') THEN 1 ELSE 0 END) AS interested,
        SUM(CASE WHEN cl.contact_status = 'partnership' THEN 1 ELSE 0 END) AS partnerships
       FROM campaigns c LEFT JOIN campaign_leads cl ON cl.campaign_id = c.id
       GROUP BY c.id ORDER BY c.status = 'in_progress' DESC, c.updated_at DESC LIMIT 8`,
    )
    .all() as DashboardMetrics["conversion_by_campaign"];

  return {
    total_leads: one("SELECT COUNT(*) AS c FROM leads"),
    total_prospects: one("SELECT COUNT(*) AS c FROM leads WHERE registration_status = 'prospect'"),
    imported_prospects: one("SELECT COUNT(*) AS c FROM leads WHERE source = 'import'"),
    with_presence: one("SELECT COUNT(*) AS c FROM leads WHERE digital_presence_url IS NOT NULL"),
    without_link: one("SELECT COUNT(*) AS c FROM leads WHERE digital_presence_url IS NULL"),
    evaluated: one("SELECT COUNT(DISTINCT lead_id) AS c FROM prospect_evaluations"),
    high_potential: one("SELECT COUNT(*) AS c FROM prospect_evaluations WHERE campaign_id IS NULL AND potential_level = 'high'"),
    campaigns_in_progress: one("SELECT COUNT(*) AS c FROM campaigns WHERE status = 'in_progress'"),
    contacted: one(`SELECT COUNT(*) AS c FROM leads WHERE contact_status IN (${CONTACTED})`),
    interested: one("SELECT COUNT(*) AS c FROM leads WHERE contact_status IN ('interested','partnership')"),
    partnerships: one("SELECT COUNT(*) AS c FROM leads WHERE contact_status = 'partnership'"),
    previews_problem: one(
      `SELECT COUNT(*) AS c FROM link_previews WHERE preview_status IN ('error','invalid_link')
        OR (preview_status = 'available' AND expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    ),
    conversion_by_potential: conversionByPotential,
    conversion_by_campaign: byCampaign,
    tracking: campaignTracking(db),
  };
}

const REPLIED_SQL = "'replied','interested','not_interested','partnership'";

/** Campaign tracking for the main dashboard (active + scheduled campaigns, this week, 20% reply goal). */
export function campaignTracking(db: DB, now = new Date()): CampaignTrackingSummary {
  const { start: weekStart, end: weekEnd } = brWeekRange(now);
  const ws = weekStart.toISOString();
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.status, c.scheduled_start_at, c.scheduled_end_at, c.started_at, c.send_limit, c.send_window_hours,
        COUNT(cl.id) AS total,
        SUM(CASE WHEN cl.contact_status = 'not_contacted' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN cl.contact_status <> 'not_contacted' THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN cl.contact_status IN (${REPLIED_SQL}) THEN 1 ELSE 0 END) AS replied,
        SUM(CASE WHEN cl.contact_status IN ('interested','partnership') THEN 1 ELSE 0 END) AS interested,
        (SELECT COUNT(*) FROM contact_history h WHERE h.campaign_id = c.id AND h.event_type IN ('whatsapp_opened','whatsapp_sent') AND h.changed_at >= ?) AS sent_this_week
       FROM campaigns c LEFT JOIN campaign_leads cl ON cl.campaign_id = c.id
       WHERE c.status IN ('ready','in_progress','paused') OR (c.status = 'completed' AND c.completed_at >= ?)
       GROUP BY c.id
       ORDER BY CASE c.status WHEN 'in_progress' THEN 0 WHEN 'ready' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END, COALESCE(c.scheduled_start_at, c.updated_at)`,
    )
    .all(ws, ws) as (Omit<CampaignTracking, "rule" | "planned_this_week"> & { send_limit: number | null; send_window_hours: number | null })[];

  const campaigns: CampaignTracking[] = rows.map((r) => {
    const rule = campaignRule(db, r, now);
    let plannedRemaining = 0;
    const open = r.status === "in_progress" || (r.status === "ready" && Boolean(r.scheduled_start_at));
    if (open && r.pending > 0) {
      const from = new Date(Math.max(now.getTime(), r.scheduled_start_at ? Date.parse(r.scheduled_start_at) : 0));
      const until = new Date(Math.min(weekEnd.getTime(), r.scheduled_end_at ? Date.parse(r.scheduled_end_at) : Number.POSITIVE_INFINITY));
      if (from < until) {
        // a campaign that has not started yet has its whole limit available
        const ruleNow = from.getTime() > now.getTime() ? { ...rule, remaining: rule.limit, next_slot_at: null } : rule;
        plannedRemaining = Math.min(r.pending, ruleCapacity(ruleNow, from, until));
      }
    }
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      scheduled_start_at: r.scheduled_start_at,
      scheduled_end_at: r.scheduled_end_at,
      started_at: r.started_at,
      rule,
      total: r.total,
      pending: r.pending ?? 0,
      sent: r.sent ?? 0,
      replied: r.replied ?? 0,
      interested: r.interested ?? 0,
      sent_this_week: r.sent_this_week,
      planned_this_week: r.sent_this_week + plannedRemaining,
    };
  });

  const totals = db
    .prepare(
      `SELECT SUM(CASE WHEN cl.contact_status <> 'not_contacted' THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN cl.contact_status IN (${REPLIED_SQL}) THEN 1 ELSE 0 END) AS replied
       FROM campaign_leads cl`,
    )
    .get() as { sent: number | null; replied: number | null };

  return {
    week_start: weekStart.toISOString(),
    week_end: weekEnd.toISOString(),
    reply_goal: REPLY_GOAL,
    active_campaigns: campaigns.filter((c) => c.status === "in_progress").length,
    scheduled_campaigns: campaigns.filter((c) => c.status === "ready" && c.rule.phase === "scheduled").length,
    planned_this_week: campaigns.reduce((t, c) => t + c.planned_this_week, 0),
    sent_this_week: (
      db.prepare("SELECT COUNT(*) AS c FROM contact_history WHERE campaign_id IS NOT NULL AND event_type IN ('whatsapp_opened','whatsapp_sent') AND changed_at >= ?").get(ws) as {
        c: number;
      }
    ).c,
    sent_total: totals.sent ?? 0,
    replied_total: totals.replied ?? 0,
    campaigns,
  };
}
