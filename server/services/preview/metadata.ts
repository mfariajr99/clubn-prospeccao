import { sanitizeText } from "../../../shared/text.js";

export interface PageMetadata {
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
  siteName: string | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (whole, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith("#x")) {
      const n = parseInt(lower.slice(2), 16);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    if (lower.startsWith("#")) {
      const n = parseInt(lower.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[lower] ?? whole;
  });
}

/** Removes markup, scripts and control characters from remote metadata. */
export function sanitizeMetadata(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null;
  const decoded = decodeEntities(value).replace(/<script[\s\S]*?<\/script>/gi, " ");
  const clean = sanitizeText(decodeEntities(decoded), maxLength);
  return clean || null;
}

function attributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (const m of tag.matchAll(re)) attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? "";
  return attrs;
}

/** Only absolute http(s) URLs are kept; relative URLs are resolved against the page. */
export function safeResourceUrl(value: string | undefined | null, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(decodeEntities(value.trim()), base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    const host = url.hostname;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host.startsWith("[")) return null;
    return url.toString().slice(0, 2048);
  } catch {
    return null;
  }
}

export function extractMetadata(html: string, pageUrl: string): PageMetadata {
  const head = html.slice(0, 600_000).replace(/<!--[\s\S]*?-->/g, "");
  const metas = new Map<string, string>();
  for (const m of head.matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const a = attributes(m[0]);
    const key = (a.property ?? a.name ?? a.itemprop ?? "").toLowerCase();
    if (key && a.content !== undefined && !metas.has(key)) metas.set(key, a.content);
  }
  let favicon: string | null = null;
  for (const m of head.matchAll(/<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const a = attributes(m[0]);
    const rel = (a.rel ?? "").toLowerCase();
    if (rel.split(/\s+/).includes("icon") || rel === "shortcut icon" || rel === "apple-touch-icon") {
      favicon = safeResourceUrl(a.href, pageUrl);
      if (favicon) break;
    }
  }
  if (!favicon) favicon = safeResourceUrl("/favicon.ico", pageUrl);
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  return {
    title: sanitizeMetadata(metas.get("og:title") ?? metas.get("twitter:title") ?? titleTag, 200),
    description: sanitizeMetadata(metas.get("og:description") ?? metas.get("description") ?? metas.get("twitter:description"), 400),
    image: safeResourceUrl(metas.get("og:image") ?? metas.get("og:image:url") ?? metas.get("twitter:image"), pageUrl),
    favicon,
    siteName: sanitizeMetadata(metas.get("og:site_name"), 120),
  };
}
