import type { LinkType } from "./constants.js";

export type UrlResult =
  | { ok: true; empty: true }
  | { ok: true; empty: false; url: string; type: LinkType; label: string }
  | { ok: false; error: string };

const INSTAGRAM_HANDLE = /^[A-Za-z0-9._]{1,30}$/;
const BLOCKED_SCHEME = /^(javascript|data|file|vbscript|blob|about|mailto|tel|ftp|ws|wss|chrome|view-source):/i;
const EXPLICIT_SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;

export function detectLinkType(url: URL): LinkType {
  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  const path = url.pathname.toLowerCase();
  if (host === "instagram.com" || host === "instagr.am") return "instagram";
  if (host === "facebook.com" || host === "fb.com" || host === "fb.me" || host.endsWith(".facebook.com")) return "facebook";
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (host === "linktr.ee" || host === "linktree.com") return "linktree";
  if (
    host === "maps.google.com" ||
    host === "maps.app.goo.gl" ||
    (host === "goo.gl" && path.startsWith("/maps")) ||
    (/^google\.[a-z.]+$/.test(host) && path.startsWith("/maps"))
  )
    return "google_maps";
  if (host === "wa.me" || host === "api.whatsapp.com" || host === "youtube.com" || host === "youtu.be" || host === "x.com" || host === "twitter.com")
    return "other";
  return "site";
}

/** Human label: "@perfil" for social profiles, domain for sites. */
export function describeLink(url: URL, type: LinkType): string {
  const host = url.hostname.replace(/^www\./, "");
  const firstSegment = url.pathname.split("/").filter(Boolean)[0];
  if ((type === "instagram" || type === "tiktok") && firstSegment) {
    return firstSegment.startsWith("@") ? firstSegment : `@${firstSegment}`;
  }
  if ((type === "facebook" || type === "linktree") && firstSegment) return `${host}/${firstSegment}`;
  return host;
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
}

/**
 * Validates and normalizes a digital presence link.
 * Unknown platforms are accepted (type "site"); the path/query are never rewritten.
 */
export function normalizeUrl(input: unknown): UrlResult {
  if (input === null || input === undefined) return { ok: true, empty: true };
  let raw = String(input).trim().replace(/\s+/g, "");
  if (!raw) return { ok: true, empty: true };
  if (raw.length > 2048) return { ok: false, error: "URL muito longa." };

  if (raw.startsWith("@")) {
    const handle = raw.slice(1).replace(/\/$/, "");
    if (!INSTAGRAM_HANDLE.test(handle)) return { ok: false, error: "Perfil do Instagram inválido." };
    const url = `https://www.instagram.com/${handle}/`;
    return { ok: true, empty: false, url, type: "instagram", label: `@${handle}` };
  }

  if (BLOCKED_SCHEME.test(raw)) return { ok: false, error: "Tipo de endereço não permitido." };
  const scheme = EXPLICIT_SCHEME.exec(raw)?.[1]?.toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") return { ok: false, error: "Tipo de endereço não permitido." };
  if (!scheme) raw = `https://${raw.replace(/^\/\//, "")}`;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "URL inválida." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, error: "Tipo de endereço não permitido." };
  if (parsed.username || parsed.password) return { ok: false, error: "URL com credenciais não é permitida." };
  const host = parsed.hostname;
  if (!host || (!host.includes(".") && !isIpLiteral(host))) return { ok: false, error: "URL inválida." };
  if (!isIpLiteral(host) && !/^[a-z0-9.-]+$/i.test(host)) return { ok: false, error: "URL inválida." };
  const tld = host.split(".").pop() ?? "";
  if (!isIpLiteral(host) && (tld.length < 2 || /^\d+$/.test(tld))) return { ok: false, error: "URL inválida." };

  const type = detectLinkType(parsed);
  return { ok: true, empty: false, url: parsed.toString(), type, label: describeLink(parsed, type) };
}

/** Safe label for a stored URL (never throws). */
export function linkLabel(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return describeLink(parsed, detectLinkType(parsed));
  } catch {
    return url;
  }
}
