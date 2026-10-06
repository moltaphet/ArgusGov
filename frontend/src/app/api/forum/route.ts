import { NextRequest, NextResponse } from "next/server";
import { clientKey, SlidingWindowLimiter } from "@/lib/rateLimit";
import { assertPublicUrl, fetchPinned, SsrfError } from "@/lib/ssrf";

// Server-side reader for the "declared intent" panel: fetches the forum post the way a
// validator does and returns plain text. It makes outbound requests on behalf of a
// visitor, so it is hardened against SSRF: strict host validation (including octal and hex
// spellings), every resolved address checked, the validated address pinned for the
// connection (no DNS rebinding window), redirects re-validated hop by hop, and a
// per-client sliding-window rate limit.
export const dynamic = "force-dynamic";

const MAX_CHARS = 4000;
const MAX_REDIRECTS = 3;
const RATE_LIMIT = 10; // requests
const RATE_WINDOW_MS = 60_000;

const limiter = new SlidingWindowLimiter(RATE_LIMIT, RATE_WINDOW_MS);

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/** Plain text with light structure kept (headings, list items, paragraph breaks) so the
 * dashboard can render it as markdown. Raw markdown / plain-text bodies pass through. */
function toReadableText(body: string): string {
  const isHtml = /<(html|body|p|div|h[1-6]|ul|li|br|article)\b/i.test(body);
  let text = body;
  if (isHtml) {
    text = text
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<h([1-6])[^>]*>/gi, (_m, n) => "\n" + "#".repeat(Number(n)) + " ")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|article|section)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m);
  }
  return text
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function json(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers });
}

export async function GET(request: NextRequest) {
  const limit = limiter.check(clientKey(request.headers));
  const rateHeaders = { "RateLimit-Limit": String(limit.limit), "RateLimit-Remaining": String(limit.remaining) };
  if (!limit.allowed) {
    const retryAfter = String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000)));
    return json({ available: false, status: 429, text: "", error: "Rate limit exceeded. Try again shortly." }, 429, { ...rateHeaders, "Retry-After": retryAfter });
  }

  const raw = request.nextUrl.searchParams.get("url") ?? "";
  try {
    let target = await assertPublicUrl(raw);
    for (let hop = 0; ; hop++) {
      const res = await fetchPinned(target.url, target.pin);
      const location = res.headers.location;
      if (res.status >= 300 && res.status < 400 && typeof location === "string") {
        if (hop >= MAX_REDIRECTS) throw new SsrfError("Too many redirects.");
        // A redirect is a brand new request: validate, resolve and pin it again.
        target = await assertPublicUrl(new URL(location, target.url).toString());
        continue;
      }
      if (res.status < 200 || res.status >= 300) return json({ available: false, status: res.status, text: "" }, 200, rateHeaders);
      const text = toReadableText(res.body.toString("utf-8")).slice(0, MAX_CHARS);
      return json({ available: text.length > 0, status: res.status, text }, 200, rateHeaders);
    }
  } catch (error) {
    const blocked = error instanceof SsrfError;
    const message = blocked ? error.message : "The post could not be fetched.";
    return json({ available: false, status: 0, text: "", error: message }, blocked ? 400 : 200, rateHeaders);
  }
}
