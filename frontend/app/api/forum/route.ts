import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextRequest, NextResponse } from "next/server";

// Server-side reader for the "declared intent" panel: fetches the forum post the
// way a validator does and returns plain text. Because it makes outbound
// requests on behalf of a visitor, it refuses anything that is not a public
// http(s) host (resolved IPs included) and never follows redirects blindly.
export const dynamic = "force-dynamic";

const MAX_BYTES = 512 * 1024;
const MAX_CHARS = 4000;
const MAX_REDIRECTS = 3;

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  );
}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIPv4(ip);
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateIPv4(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") ||
    v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb");
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) URLs are allowed.");
  if (url.username || url.password) throw new Error("Credentials in URLs are not allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || /\.(local|localhost|internal|lan)$/.test(host)) throw new Error("Host is not public.");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) throw new Error("Host is not public.");
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url") ?? "";
  try {
    let url = new URL(raw);
    for (let hop = 0; ; hop++) {
      await assertPublic(url);
      const res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
        headers: { "user-agent": "ArgusGov-Inspector/0.1", accept: "text/html,text/plain" },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects.");
        url = new URL(res.headers.get("location")!, url);
        continue;
      }
      if (!res.ok) return NextResponse.json({ available: false, status: res.status, text: "" });
      const reader = res.body?.getReader();
      let received = 0;
      const chunks: Uint8Array[] = [];
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        chunks.push(value);
        if (received > MAX_BYTES) { await reader.cancel(); break; }
      }
      const body = Buffer.concat(chunks).toString("utf-8");
      const text = htmlToText(body).slice(0, MAX_CHARS);
      return NextResponse.json({ available: text.length > 0, status: res.status, text });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fetch failed.";
    return NextResponse.json({ available: false, status: 0, text: "", error: message });
  }
}
