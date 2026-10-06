import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { isIP } from "node:net";

// Server-side request guard for the forum reader. The reader fetches a URL on behalf
// of a visitor, so every hop must (1) name a public host, (2) resolve only to public
// addresses, and (3) connect to the very address that was validated.

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

export interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;

/** Resolve every A/AAAA record. */
export const systemResolver: Resolver = (hostname) => dns.lookup(hostname, { all: true, verbatim: true });

// ---------------------------------------------------------------------------- IPv4
/** Strict dotted-decimal quad to a 32-bit integer; anything else (octal, hex, short forms) is null. */
export function parseStrictIPv4(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null; // no leading zeros: 0177 is ambiguous with octal
    const n = Number(part);
    if (n > 255) return null;
    out = out * 256 + n;
  }
  return out;
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

export function isBlockedIPv4(ip: string): boolean {
  const n = parseStrictIPv4(ip);
  if (n === null) return true; // an address we cannot read strictly is never trusted
  return V4_BLOCKS.some(([base, bits]) => {
    const b = parseStrictIPv4(base) as number;
    const size = 2 ** (32 - bits);
    return Math.floor(n / size) === Math.floor(b / size);
  });
}

// ---------------------------------------------------------------------------- IPv6
/** Parse an IPv6 literal into eight 16-bit groups, or null when it is not valid. */
export function parseIPv6(input: string): number[] | null {
  let text = input.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  if (!text.includes(":")) return null;
  // An embedded dotted-quad tail (::ffff:1.2.3.4) occupies two groups.
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseStrictIPv4(tail);
    if (v4 === null) return null;
    text = `${text.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const toGroups = (s: string) => (s === "" ? [] : s.split(":"));
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...rest];
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

export function isBlockedIPv6(ip: string): boolean {
  const g = parseIPv6(ip);
  if (g === null) return true;
  const allZero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  const embeddedV4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  if (allZero(0, 7) && (g[7] === 0 || g[7] === 1)) return true;         // :: and ::1
  if (allZero(0, 5) && g[5] === 0xffff) return isBlockedIPv4(embeddedV4); // IPv4-mapped ::ffff:a.b.c.d
  if (allZero(0, 6)) return true;                                          // IPv4-compatible ::a.b.c.d (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && allZero(2, 6)) return isBlockedIPv4(embeddedV4); // NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return true;                             // fc00::/7  unique local (RFC 4193)
  if ((g[0] & 0xffc0) === 0xfe80) return true;                             // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true;                             // fec0::/10 deprecated site-local
  if ((g[0] & 0xff00) === 0xff00) return true;                             // ff00::/8  multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;                     // 2001:db8::/32 documentation
  if (g[0] === 0x2002) return isBlockedIPv4(`${g[1] >> 8}.${g[1] & 255}.${g[2] >> 8}.${g[2] & 255}`); // 6to4
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedIPv4(ip);
  if (family === 6) return isBlockedIPv6(ip);
  return true;
}

// ---------------------------------------------------------------------------- hostnames
/** The authority's host exactly as the caller wrote it, before the URL parser rewrites it. */
export function rawHostOf(input: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(input.trim());
  if (!m) return "";
  const authority = m[1];
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.replace(/:\d*$/, "");
}

const NUMERIC_LABEL = /^(0x[0-9a-f]+|[0-9]+)$/i;

/** Rejects hosts that are literal, loopback-style, internal-suffixed or written in an ambiguous numeric notation. */
export function assertAcceptableHostname(rawHost: string): void {
  const host = rawHost.replace(/\.$/, "").toLowerCase();
  if (host === "") throw new SsrfError("The URL has no host.");
  if (host.startsWith("[") || host.includes(":")) {
    if (isBlockedIPv6(host.replace(/^\[|\]$/g, ""))) throw new SsrfError("IPv6 address is not public.");
    return;
  }
  if (host === "localhost" || /\.(localhost|local|internal|lan|home\.arpa|corp|intranet)$/.test(host)) {
    throw new SsrfError("Host is not public.");
  }
  const labels = host.split(".");
  if (labels.every((l) => NUMERIC_LABEL.test(l))) {
    // Numeric host: only a canonical dotted-decimal quad passes, which rejects octal (0177.0.0.1),
    // hex (0x7f.0.0.1, 0x7f000001), integer (2130706433) and short (127.1) spellings outright.
    if (parseStrictIPv4(host) === null) throw new SsrfError("Numeric hosts must be canonical dotted-decimal addresses.");
    if (isBlockedIPv4(host)) throw new SsrfError("IP address is not public.");
  }
}

export interface ValidatedTarget {
  url: URL;
  pin: PinnedAddress;
}

/**
 * Validate a URL and resolve it once. Every returned address is checked (a single private
 * record in a mixed answer rejects the host) and the first public one is returned to be
 * pinned, so the connection can never land on a different address than the one validated.
 */
export async function assertPublicUrl(input: string, resolve: Resolver = systemResolver): Promise<ValidatedTarget> {
  if (input.length > 2048 || /[\s\\]/.test(input)) throw new SsrfError("The URL is malformed.");
  const raw = rawHostOf(input);
  assertAcceptableHostname(raw);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SsrfError("The URL is malformed.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new SsrfError("Only http(s) URLs are allowed.");
  if (url.username || url.password) throw new SsrfError("Credentials in URLs are not allowed.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new SsrfError("Only the default web ports are allowed.");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(host);
  const answers = literal ? [{ address: host, family: literal }] : await resolve(host);
  if (answers.length === 0) throw new SsrfError("The host did not resolve.");
  if (answers.some((a) => isBlockedIp(a.address))) throw new SsrfError("The host resolves to a non-public address.");
  const chosen = answers.find((a) => a.family === 4) ?? answers[0];
  return { url, pin: { address: chosen.address, family: chosen.family === 6 ? 6 : 4 } };
}

// ---------------------------------------------------------------------------- pinned fetch
export interface PinnedResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  truncated: boolean;
}

/**
 * GET `url`, connecting to `pin.address` regardless of what the hostname resolves to now.
 * The Host header and TLS server name still use the hostname, so virtual hosting and
 * certificate checks work, and DNS is never consulted again (no rebinding window).
 */
export function fetchPinned(url: URL, pin: PinnedAddress, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<PinnedResponse> {
  const { timeoutMs = 8000, maxBytes = 512 * 1024 } = opts;
  const secure = url.protocol === "https:";
  const client = secure ? https : http;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        protocol: url.protocol,
        hostname,
        port: url.port || (secure ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { host: url.host, "user-agent": "ArgusGov-Inspector/0.1", accept: "text/html,text/plain,text/markdown" },
        timeout: timeoutMs,
        ...(secure && !isIP(hostname) ? { servername: hostname } : {}),
        lookup: (_host, options, callback) => {
          // The pinned address answers every lookup, in whichever shape this Node version asks for.
          if ((options as { all?: boolean })?.all) (callback as unknown as (e: null, a: unknown) => void)(null, [{ address: pin.address, family: pin.family }]);
          else callback(null, pin.address, pin.family);
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let received = 0;
        let truncated = false;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBytes) {
            truncated = true;
            req.destroy();
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), truncated });
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), truncated }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new SsrfError("The request timed out.")));
    req.on("error", reject);
    req.end();
  });
}
