import { CONTACTED_STATUSES } from "../../shared/constants.js";
import type { DashboardMetrics } from "../../shared/types.js";
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
  };
}
