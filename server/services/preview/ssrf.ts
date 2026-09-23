// Outbound request guard used ONLY by the preview service.
// Protects against SSRF: private/loopback/link-local/metadata addresses,
// DNS rebinding (address is validated at connect time and pinned),
// dangerous redirects, slow responses and huge bodies.

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export class PreviewFetchError extends Error {
  constructor(
    public code:
      | "INVALID_URL"
      | "BLOCKED_ADDRESS"
      | "DNS_FAILURE"
      | "TOO_MANY_REDIRECTS"
      | "TIMEOUT"
      | "TOO_LARGE"
      | "HTTP_ERROR"
      | "BLOCKED_BY_SITE"
      | "UNSUPPORTED_CONTENT"
      | "NETWORK_ERROR",
    message: string,
    public httpStatus?: number,
  ) {
    super(message);
  }
}

const BLOCKED_HOSTNAMES = [/^localhost$/i, /\.localhost$/i, /\.local$/i, /\.internal$/i, /\.lan$/i, /\.home\.arpa$/i, /^metadata$/i, /^metadata\.google\.internal$/i];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local + cloud metadata (169.254.169.254)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isBlockedV4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(base) & mask);
  });
}

function expandV6(ip: string): number[] | null {
  let address = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = address.indexOf("%");
  if (zone >= 0) address = address.slice(0, zone);
  // Embedded IPv4 (::ffff:1.2.3.4)
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (v4) {
    const n = ipv4ToInt(v4[1]);
    address = address.replace(v4[1], `${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`);
  }
  const [head, tail] = address.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail !== undefined && tail ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (address.includes("::") ? missing < 0 : headParts.length !== 8) return null;
  const parts = [...headParts, ...Array(address.includes("::") ? missing : 0).fill("0"), ...tailParts].map((p) => parseInt(p || "0", 16));
  return parts.length === 8 && parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 0xffff) ? parts : null;
}

function isBlockedV6(ip: string): boolean {
  const p = expandV6(ip);
  if (!p) return true;
  const allZeroPrefix = p.slice(0, 5).every((x) => x === 0);
  if (p.every((x) => x === 0)) return true; // ::
  if (allZeroPrefix && p[5] === 0 && p[6] === 0 && p[7] === 1) return true; // ::1
  if (allZeroPrefix && p[5] === 0xffff) return isBlockedV4(`${p[6] >> 8}.${p[6] & 255}.${p[7] >> 8}.${p[7] & 255}`); // v4-mapped
  if (allZeroPrefix && p[5] === 0) return true; // deprecated v4-compatible
  if (p[0] === 0x64 && p[1] === 0xff9b) return isBlockedV4(`${p[6] >> 8}.${p[6] & 255}.${p[7] >> 8}.${p[7] & 255}`); // NAT64
  if ((p[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local (includes AWS fd00:ec2::254)
  if ((p[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((p[0] & 0xffc0) === 0xfec0) return true; // site-local (deprecated)
  if ((p[0] & 0xff00) === 0xff00) return true; // multicast
  if (p[0] === 0x2001 && p[1] === 0x0db8) return true; // documentation
  if (p[0] === 0x2002) return true; // 6to4 can embed private v4
  if (p[0] === 0x2001 && p[1] === 0) return true; // Teredo
  return false;
}

/** true only for globally routable unicast addresses. */
export function isPublicAddress(ip: string): boolean {
  const kind = net.isIP(ip.replace(/^\[|\]$/g, ""));
  if (kind === 4) return !isBlockedV4(ip);
  if (kind === 6) return !isBlockedV6(ip);
  return false;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.replace(/\.$/, "");
  return BLOCKED_HOSTNAMES.some((re) => re.test(host));
}

const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

/** Static checks that do not require DNS. */
export function assertUrlAllowed(raw: string | URL): URL {
  let url: URL;
  try {
    url = typeof raw === "string" ? new URL(raw) : raw;
  } catch {
    throw new PreviewFetchError("INVALID_URL", "URL inválida.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new PreviewFetchError("INVALID_URL", "Somente endereços http e https são permitidos.");
  if (url.username || url.password) throw new PreviewFetchError("INVALID_URL", "URL com credenciais não é permitida.");
  if (!ALLOWED_PORTS.has(url.port)) throw new PreviewFetchError("BLOCKED_ADDRESS", "Porta não permitida.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || isBlockedHostname(host)) throw new PreviewFetchError("BLOCKED_ADDRESS", "Endereço interno não permitido.");
  if (net.isIP(host) && !isPublicAddress(host)) throw new PreviewFetchError("BLOCKED_ADDRESS", "Endereço de rede privada não permitido.");
  return url;
}

export type Resolver = (hostname: string) => Promise<string[]>;

export const systemResolver: Resolver = async (hostname) => {
  const results = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
};

/** Resolves and validates that EVERY address is public. Returns the first address. */
export async function resolvePublicAddress(hostname: string, resolver: Resolver): Promise<string> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) throw new PreviewFetchError("BLOCKED_ADDRESS", "Endereço de rede privada não permitido.");
    return host;
  }
  let addresses: string[];
  try {
    addresses = await resolver(host);
  } catch {
    throw new PreviewFetchError("DNS_FAILURE", "Não foi possível localizar o domínio.");
  }
  if (addresses.length === 0) throw new PreviewFetchError("DNS_FAILURE", "Não foi possível localizar o domínio.");
  if (addresses.some((a) => !isPublicAddress(a))) throw new PreviewFetchError("BLOCKED_ADDRESS", "O domínio aponta para uma rede privada.");
  return addresses[0];
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  destroy(): void;
}

export type Transport = (url: URL, pinnedAddress: string, signal: AbortSignal) => Promise<TransportResponse>;

/** Real HTTP transport: connects ONLY to the pre-validated address (no second DNS lookup). */
export const nodeTransport: Transport = (url, pinnedAddress, signal) =>
  new Promise((resolve, reject) => {
    const family = net.isIP(pinnedAddress);
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        signal,
        agent: false, // no connection reuse, no shared state
        headers: {
          "User-Agent": "ClubnPreviewBot/1.0 (+link preview; no-cookies)",
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
        },
        lookup: (_hostname, options, callback) => {
          const cb = callback as unknown as (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void;
          if ((options as { all?: boolean })?.all) cb(null, [{ address: pinnedAddress, family }]);
          else cb(null, pinnedAddress, family);
        },
      },
      (res) => {
        const headers: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(res.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
        resolve({ status: res.statusCode ?? 0, headers, body: res, destroy: () => res.destroy() });
      },
    );
    req.on("error", reject);
    req.end();
  });

export interface SafeFetchOptions {
  resolver?: Resolver;
  transport?: Transport;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
}

/** GETs an HTML page safely. Non-HTML responses are never downloaded. */
export async function safeFetchHtml(input: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const resolver = options.resolver ?? systemResolver;
  const transport = options.transport ?? nodeTransport;
  const timeoutMs = options.timeoutMs ?? 8000;
  const maxBytes = options.maxBytes ?? 1_500_000;
  const maxRedirects = options.maxRedirects ?? 4;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new PreviewFetchError("TIMEOUT", "Tempo limite excedido.")), timeoutMs);

  const withAbort = <T>(promise: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (controller.signal.aborted) return reject(new PreviewFetchError("TIMEOUT", "Tempo limite excedido."));
      const onAbort = () => reject(new PreviewFetchError("TIMEOUT", "Tempo limite excedido."));
      controller.signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (v) => {
          controller.signal.removeEventListener("abort", onAbort);
          resolve(v);
        },
        (e) => {
          controller.signal.removeEventListener("abort", onAbort);
          reject(controller.signal.aborted ? new PreviewFetchError("TIMEOUT", "Tempo limite excedido.") : e);
        },
      );
    });

  try {
    let current = assertUrlAllowed(input);
    for (let hop = 0; ; hop++) {
      const address = await withAbort(resolvePublicAddress(current.hostname, resolver));
      let response: TransportResponse;
      try {
        response = await withAbort(transport(current, address, controller.signal));
      } catch (error) {
        if (error instanceof PreviewFetchError) throw error;
        throw new PreviewFetchError("NETWORK_ERROR", "Não foi possível conectar ao endereço.");
      }
      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        response.destroy();
        if (hop >= maxRedirects) throw new PreviewFetchError("TOO_MANY_REDIRECTS", "Redirecionamentos em excesso.");
        let next: URL;
        try {
          next = new URL(response.headers.location, current);
        } catch {
          throw new PreviewFetchError("INVALID_URL", "Redirecionamento inválido.");
        }
        current = assertUrlAllowed(next); // re-validated on every hop (DNS is checked at the top of the loop)
        continue;
      }
      if (response.status === 401 || response.status === 403 || response.status === 429 || response.status === 999) {
        response.destroy();
        throw new PreviewFetchError("BLOCKED_BY_SITE", "O site bloqueou o acesso automático.", response.status);
      }
      if (response.status >= 400) {
        response.destroy();
        throw new PreviewFetchError("HTTP_ERROR", `O site respondeu com erro ${response.status}.`, response.status);
      }
      const contentType = (response.headers["content-type"] ?? "").toLowerCase();
      if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        response.destroy();
        throw new PreviewFetchError("UNSUPPORTED_CONTENT", "O endereço não é uma página web.");
      }
      const declared = Number(response.headers["content-length"] ?? 0);
      if (declared > maxBytes * 4) {
        response.destroy();
        throw new PreviewFetchError("TOO_LARGE", "Página muito grande.");
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      let truncated = false;
      const reader = (async () => {
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          if (size > maxBytes) {
            chunks.push(chunk.subarray(0, chunk.byteLength - (size - maxBytes)));
            truncated = true;
            response.destroy();
            break;
          }
          chunks.push(chunk);
        }
      })();
      await withAbort(reader);
      const body = Buffer.concat(chunks).toString("utf8");
      return { finalUrl: current.toString(), status: response.status, contentType, body, truncated };
    }
  } finally {
    clearTimeout(timer);
  }
}
