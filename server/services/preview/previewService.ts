// Digital presence preview service: cache, status tracking, de-duplication,
// rate limiting and a small concurrency-limited *technical* job runner.
// IMPORTANT: this runner is exclusively for preview captures. WhatsApp
// messages are never queued or processed in the background.

import crypto from "node:crypto";
import path from "node:path";
import type { LinkType, PreviewStatus } from "../../../shared/constants.js";
import type { LinkPreview } from "../../../shared/types.js";
import { detectLinkType, describeLink, normalizeUrl } from "../../../shared/url.js";
import { nowIso, type DB } from "../../db/core.js";
import { HttpError, notFound } from "../../lib/http.js";
import { extractMetadata } from "./metadata.js";
import type { Screenshotter } from "./screenshot.js";
import { PreviewFetchError, safeFetchHtml, type SafeFetchOptions } from "./ssrf.js";

/** Platforms that are never fetched automatically (official methods only). */
const OFFICIAL_ONLY: LinkType[] = ["instagram", "facebook", "tiktok", "google_maps"];

export interface PreviewServiceOptions {
  ttlMs?: number;
  refreshCooldownMs?: number;
  maxConcurrent?: number;
  fetchOptions?: SafeFetchOptions;
  screenshotter?: Screenshotter | null;
  storageDir?: string;
  now?: () => Date;
}

interface PreviewRow extends Omit<LinkPreview, "refreshing" | "next_refresh_allowed_at" | "screenshot_url"> {
  last_requested_at: string | null;
}

interface CaptureResult {
  status: PreviewStatus;
  final_url: string | null;
  page_title: string | null;
  page_description: string | null;
  domain: string | null;
  favicon_url: string | null;
  open_graph_image_url: string | null;
  screenshot_storage_path: string | null;
  error_code: string | null;
  error_message: string | null;
}

export class PreviewService {
  private inFlight = new Map<string, Promise<void>>();
  private byUrl = new Map<string, Promise<CaptureResult>>();
  private running = 0;
  private waiting: (() => void)[] = [];
  readonly ttlMs: number;
  readonly cooldownMs: number;
  private maxConcurrent: number;
  private now: () => Date;

  constructor(
    private db: DB,
    private options: PreviewServiceOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? Number(process.env.PREVIEW_TTL_DAYS ?? 7) * 24 * 3600 * 1000;
    this.cooldownMs = options.refreshCooldownMs ?? Number(process.env.PREVIEW_REFRESH_COOLDOWN_SECONDS ?? 60) * 1000;
    this.maxConcurrent = options.maxConcurrent ?? 3;
    this.now = options.now ?? (() => new Date());
  }

  private key(leadId: number, normalized: string) {
    return `${leadId}|${normalized}`;
  }

  private links(leadId: number): { url: string; link_type: LinkType }[] {
    const exists = this.db.prepare("SELECT id FROM leads WHERE id = ?").get(leadId);
    if (!exists) throw notFound("Lead");
    return this.db.prepare("SELECT url, link_type FROM lead_links WHERE lead_id = ? ORDER BY is_primary DESC, id").all(leadId) as {
      url: string;
      link_type: LinkType;
    }[];
  }

  private row(leadId: number, normalized: string): PreviewRow | undefined {
    return this.db.prepare("SELECT * FROM link_previews WHERE lead_id = ? AND normalized_url = ?").get(leadId, normalized) as PreviewRow | undefined;
  }

  private present(row: PreviewRow | undefined, leadId: number, link: { url: string; link_type: LinkType }, normalized: string): LinkPreview {
    const now = this.now().getTime();
    const refreshing = this.inFlight.has(this.key(leadId, normalized));
    if (!row) {
      let domain: string | null = null;
      try {
        domain = new URL(normalized).hostname.replace(/^www\./, "");
      } catch {
        /* keep null */
      }
      return {
        id: null,
        lead_id: leadId,
        link_type: link.link_type,
        original_url: link.url,
        normalized_url: normalized,
        final_url: null,
        page_title: null,
        page_description: null,
        domain,
        favicon_url: null,
        open_graph_image_url: null,
        screenshot_storage_path: null,
        screenshot_url: null,
        preview_status: refreshing ? "processing" : "not_requested",
        error_code: null,
        error_message: null,
        captured_at: null,
        expires_at: null,
        refreshing,
        next_refresh_allowed_at: null,
      };
    }
    let status = row.preview_status;
    if (status === "available" && row.expires_at && Date.parse(row.expires_at) < now) status = "stale";
    const nextAllowed = row.last_requested_at ? Date.parse(row.last_requested_at) + this.cooldownMs : 0;
    const rest: Omit<PreviewRow, "last_requested_at"> & { last_requested_at?: string | null } = { ...row };
    delete rest.last_requested_at;
    return {
      ...rest,
      preview_status: status,
      refreshing,
      screenshot_url: row.screenshot_storage_path ? `/api/previews/${row.id}/screenshot` : null,
      next_refresh_allowed_at: nextAllowed > now ? new Date(nextAllowed).toISOString() : null,
    };
  }

  /** Lists cached previews for every link of the lead. Never triggers a capture. */
  listForLead(leadId: number): LinkPreview[] {
    return this.links(leadId).map((link) => {
      const normalized = this.normalize(link.url);
      return this.present(this.row(leadId, normalized), leadId, link, normalized);
    });
  }

  private normalize(url: string): string {
    const result = normalizeUrl(url);
    return result.ok && !result.empty ? result.url : url;
  }

  /**
   * Requests a preview. Uses the cache when fresh; `force` asks for a manual
   * refresh (rate limited). Returns immediately; capture runs in the background.
   */
  request(leadId: number, url: string, force = false): LinkPreview {
    const link = this.links(leadId).find((l) => l.url === url);
    if (!link) throw new HttpError(404, "Este link não pertence ao lead.");
    const normalized = this.normalize(link.url);
    const key = this.key(leadId, normalized);
    const existing = this.row(leadId, normalized);
    const now = this.now();

    if (this.inFlight.has(key)) return this.present(existing, leadId, link, normalized);

    const fresh = existing?.expires_at && Date.parse(existing.expires_at) > now.getTime() && existing.preview_status !== "processing" && existing.preview_status !== "pending";
    if (!force && existing && fresh) return this.present(existing, leadId, link, normalized);

    if (force && existing?.last_requested_at) {
      const next = Date.parse(existing.last_requested_at) + this.cooldownMs;
      if (next > now.getTime()) {
        throw new HttpError(429, "Aguarde alguns instantes para atualizar novamente esta prévia.", { next_refresh_allowed_at: new Date(next).toISOString() });
      }
    }

    const stamp = now.toISOString();
    if (existing) {
      const hasData = existing.preview_status === "available" || existing.page_title || existing.open_graph_image_url;
      this.db
        .prepare("UPDATE link_previews SET last_requested_at = ?, preview_status = ?, updated_at = ? WHERE id = ?")
        .run(stamp, hasData ? existing.preview_status : "pending", stamp, existing.id);
    } else {
      let domain: string | null;
      try {
        domain = new URL(normalized).hostname.replace(/^www\./, "");
      } catch {
        domain = null;
      }
      this.db
        .prepare(
          `INSERT INTO link_previews (lead_id, link_type, original_url, normalized_url, domain, preview_status, last_requested_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .run(leadId, link.link_type, link.url, normalized, domain, stamp, stamp, stamp);
    }

    const job = this.runLimited(async () => {
      const current = this.row(leadId, normalized);
      if (current && current.preview_status === "pending") {
        this.db.prepare("UPDATE link_previews SET preview_status = 'processing', updated_at = ? WHERE id = ?").run(nowIso(), current.id);
      }
      const result = await this.captureShared(normalized, link.link_type, leadId);
      this.store(leadId, normalized, result);
    })
      .catch((error) => {
        this.store(leadId, normalized, this.failure(error));
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, job);
    return this.present(this.row(leadId, normalized), leadId, link, normalized);
  }

  /** Waits until all running captures finish (used by tests and graceful shutdown). */
  async idle(): Promise<void> {
    while (this.inFlight.size) await Promise.allSettled([...this.inFlight.values()]);
  }

  private async runLimited<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.maxConcurrent) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }

  /** Avoids simultaneous captures of the same address (even for different leads). */
  private captureShared(normalized: string, type: LinkType, leadId: number): Promise<CaptureResult> {
    const existing = this.byUrl.get(normalized);
    if (existing) return existing;
    const promise = this.capture(normalized, type, leadId).finally(() => this.byUrl.delete(normalized));
    this.byUrl.set(normalized, promise);
    return promise;
  }

  private async capture(normalized: string, type: LinkType, leadId: number): Promise<CaptureResult> {
    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      return this.failure(new PreviewFetchError("INVALID_URL", "URL inválida."));
    }
    const domain = parsed.hostname.replace(/^www\./, "");
    const effectiveType = type ?? detectLinkType(parsed);
    if (OFFICIAL_ONLY.includes(effectiveType)) {
      return {
        status: "blocked",
        final_url: normalized,
        page_title: describeLink(parsed, effectiveType),
        page_description: null,
        domain,
        favicon_url: null,
        open_graph_image_url: null,
        screenshot_storage_path: null,
        error_code: "OFFICIAL_ACCESS_REQUIRED",
        error_message: "Esta plataforma só permite prévias por integração oficial. Use a imagem de capa cadastrada ou abra o link.",
      };
    }
    const page = await safeFetchHtml(normalized, this.options.fetchOptions);
    const meta = extractMetadata(page.body, page.finalUrl);
    let screenshotPath: string | null = null;
    if (this.options.screenshotter && this.options.storageDir) {
      const file = `${leadId}-${crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 16)}.jpg`;
      try {
        await this.options.screenshotter(page.finalUrl, path.join(this.options.storageDir, file));
        screenshotPath = file;
      } catch {
        screenshotPath = null; // metadata is still useful without the capture
      }
    }
    return {
      status: "available",
      final_url: page.finalUrl,
      page_title: meta.title ?? meta.siteName,
      page_description: meta.description,
      domain: new URL(page.finalUrl).hostname.replace(/^www\./, ""),
      favicon_url: meta.favicon,
      open_graph_image_url: meta.image,
      screenshot_storage_path: screenshotPath,
      error_code: null,
      error_message: null,
    };
  }

  private failure(error: unknown): CaptureResult {
    const base = {
      final_url: null,
      page_title: null,
      page_description: null,
      domain: null,
      favicon_url: null,
      open_graph_image_url: null,
      screenshot_storage_path: null,
    };
    if (error instanceof PreviewFetchError) {
      const status: PreviewStatus =
        error.code === "INVALID_URL" || error.code === "BLOCKED_ADDRESS" ? "invalid_link" : error.code === "BLOCKED_BY_SITE" ? "blocked" : "error";
      return { ...base, status, error_code: error.code, error_message: error.message };
    }
    return { ...base, status: "error", error_code: "UNKNOWN", error_message: "Erro inesperado ao gerar a prévia." };
  }

  private store(leadId: number, normalized: string, result: CaptureResult): void {
    const row = this.row(leadId, normalized);
    if (!row) return; // link removed meanwhile
    const now = this.now();
    const failed = result.status !== "available" && result.error_code !== "OFFICIAL_ACCESS_REQUIRED";
    // On failure keep the last good capture visible (only status/error change).
    if (failed && row.captured_at && (row.page_title || row.open_graph_image_url || row.screenshot_storage_path)) {
      this.db
        .prepare("UPDATE link_previews SET preview_status = ?, error_code = ?, error_message = ?, updated_at = ? WHERE id = ?")
        .run(result.status, result.error_code, result.error_message, now.toISOString(), row.id);
      return;
    }
    const expires = new Date(now.getTime() + (failed ? Math.min(this.ttlMs, 24 * 3600 * 1000) : this.ttlMs)).toISOString();
    this.db
      .prepare(
        `UPDATE link_previews SET preview_status = ?, final_url = ?, page_title = ?, page_description = ?, domain = COALESCE(?, domain),
          favicon_url = ?, open_graph_image_url = ?, screenshot_storage_path = COALESCE(?, screenshot_storage_path),
          error_code = ?, error_message = ?, captured_at = ?, expires_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        result.status,
        result.final_url,
        result.page_title,
        result.page_description,
        result.domain,
        result.favicon_url,
        result.open_graph_image_url,
        result.screenshot_storage_path,
        result.error_code,
        result.error_message,
        now.toISOString(),
        expires,
        now.toISOString(),
        row.id,
      );
  }

  screenshotFile(previewId: number): string | null {
    const row = this.db.prepare("SELECT screenshot_storage_path FROM link_previews WHERE id = ?").get(previewId) as
      | { screenshot_storage_path: string | null }
      | undefined;
    if (!row?.screenshot_storage_path || !this.options.storageDir) return null;
    const file = path.basename(row.screenshot_storage_path);
    return path.join(this.options.storageDir, file);
  }
}
