// Offline preview provider for the demo: shows cached previews and, for new
// requests, the same fallbacks the real service uses — without network access.
import type { LinkType } from "../../shared/constants";
import type { LinkPreview } from "../../shared/types";
import { describeLink, normalizeUrl } from "../../shared/url";
import type { DB } from "../../server/db/core";
import type { PreviewProvider } from "../../server/router";
import { HttpError, notFound } from "../../server/lib/http";

const OFFICIAL_ONLY: LinkType[] = ["instagram", "facebook", "tiktok", "google_maps"];

type Row = Omit<LinkPreview, "refreshing" | "next_refresh_allowed_at" | "screenshot_url"> & { last_requested_at: string | null };

export function createDemoPreviews(db: DB): PreviewProvider {
  const links = (leadId: number) => {
    if (!db.prepare("SELECT id FROM leads WHERE id = ?").get(leadId)) throw notFound("Lead");
    return db.prepare("SELECT url, link_type FROM lead_links WHERE lead_id = ? ORDER BY is_primary DESC, id").all(leadId) as { url: string; link_type: LinkType }[];
  };
  const norm = (url: string) => {
    const r = normalizeUrl(url);
    return r.ok && !r.empty ? r.url : url;
  };
  const domainOf = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  };
  const present = (leadId: number, link: { url: string; link_type: LinkType }): LinkPreview => {
    const n = norm(link.url);
    const row = db.prepare("SELECT * FROM link_previews WHERE lead_id = ? AND normalized_url = ?").get(leadId, n) as Row | undefined;
    if (!row) {
      return {
        id: null, lead_id: leadId, link_type: link.link_type, original_url: link.url, normalized_url: n, final_url: null, page_title: null,
        page_description: null, domain: domainOf(n), favicon_url: null, open_graph_image_url: null, screenshot_storage_path: null,
        screenshot_url: null, preview_status: "not_requested", error_code: null, error_message: null, captured_at: null, expires_at: null,
        refreshing: false, next_refresh_allowed_at: null,
      };
    }
    const status = row.preview_status === "available" && row.expires_at && Date.parse(row.expires_at) < Date.now() ? "stale" : row.preview_status;
    return { ...row, preview_status: status, refreshing: false, screenshot_url: null, next_refresh_allowed_at: null };
  };

  return {
    listForLead: (leadId) => links(leadId).map((l) => present(leadId, l)),
    request(leadId, url) {
      const link = links(leadId).find((l) => l.url === url);
      if (!link) throw new HttpError(404, "Este link não pertence ao lead.");
      const n = norm(link.url);
      const now = new Date();
      const official = OFFICIAL_ONLY.includes(link.link_type);
      let label: string | null;
      try {
        label = describeLink(new URL(n), link.link_type);
      } catch {
        label = null;
      }
      const values = official
        ? ["blocked", label, "OFFICIAL_ACCESS_REQUIRED", "Esta plataforma só permite prévias por integração oficial. Use a imagem de capa cadastrada ou abra o link."]
        : ["error", null, "DEMO_OFFLINE", "A versão de demonstração não acessa sites externos. Na versão instalada, a prévia é gerada pelo servidor."];
      db.prepare("DELETE FROM link_previews WHERE lead_id = ? AND normalized_url = ?").run(leadId, n);
      db.prepare(
        `INSERT INTO link_previews (lead_id, link_type, original_url, normalized_url, final_url, page_title, domain, preview_status, error_code, error_message, captured_at, expires_at, last_requested_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(leadId, link.link_type, link.url, n, n, values[1], domainOf(n), values[0], values[2], values[3], now.toISOString(), new Date(now.getTime() + 7 * 864e5).toISOString(), now.toISOString());
      return present(leadId, link);
    },
  };
}
