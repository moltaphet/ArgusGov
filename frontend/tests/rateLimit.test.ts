// @vitest-environment node
import { describe, expect, it } from "vitest";
import { clientKey, SlidingWindowLimiter } from "@/lib/rateLimit";

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

describe("sliding-window rate limiter", () => {
  it("allows 10 requests a minute and rejects the 11th", () => {
    const t = clock();
    const limiter = new SlidingWindowLimiter(10, 60_000, t.now);
    for (let i = 0; i < 10; i++) {
      const r = limiter.check("1.2.3.4");
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(9 - i);
    }
    const blocked = limiter.check("1.2.3.4");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBe(60_000);
  });

  it("slides rather than resetting on a fixed boundary", () => {
    const t = clock();
    const limiter = new SlidingWindowLimiter(3, 60_000, t.now);
    limiter.check("a");                 // t = 0
    t.advance(30_000);
    limiter.check("a");                 // t = 30s
    limiter.check("a");                 // t = 30s
    expect(limiter.check("a").allowed).toBe(false);
    t.advance(29_999);                  // t = 59.999s: the first hit is still inside the window
    expect(limiter.check("a").allowed).toBe(false);
    t.advance(1);                       // t = 60s: the first hit slides out, one slot opens
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
  });

  it("reports how long to wait", () => {
    const t = clock();
    const limiter = new SlidingWindowLimiter(1, 60_000, t.now);
    limiter.check("a");
    t.advance(45_000);
    expect(limiter.check("a").retryAfterMs).toBe(15_000);
  });

  it("does not let a rejected request extend the lockout", () => {
    const t = clock();
    const limiter = new SlidingWindowLimiter(2, 60_000, t.now);
    limiter.check("a");
    limiter.check("a");
    for (let i = 0; i < 20; i++) { t.advance(1000); limiter.check("a"); }   // hammering while blocked
    t.advance(40_000);                                                      // 60s after the first two hits
    expect(limiter.check("a").allowed).toBe(true);
  });

  it("keeps clients independent", () => {
    const limiter = new SlidingWindowLimiter(1, 60_000, clock().now);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("b").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
  });

  it("bounds memory by evicting the least recently used keys", () => {
    const t = clock();
    const limiter = new SlidingWindowLimiter(5, 60_000, t.now, 100);
    for (let i = 0; i < 1000; i++) limiter.check(`ip-${i}`);
    expect(limiter.size).toBeLessThanOrEqual(100);
  });

  it("prunes idle keys once their window has passed", () => {
    const t = clock();
    const limiter = new SlidingWindowLimiter(5, 1000, t.now, 10);
    for (let i = 0; i < 10; i++) limiter.check(`ip-${i}`);
    t.advance(5000);
    limiter.check("fresh");
    for (let i = 0; i < 10; i++) limiter.check(`late-${i}`);
    expect(limiter.size).toBeLessThanOrEqual(10);
  });
});

describe("clientKey", () => {
  const headers = (h: Record<string, string>) => ({ get: (name: string) => h[name.toLowerCase()] ?? null });
  it("prefers the platform address over a spoofable forwarded header", () => {
    expect(clientKey(headers({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "6.6.6.6, 7.7.7.7" }))).toBe("9.9.9.9");
  });
  it("falls back to the first forwarded hop, then to a shared bucket", () => {
    expect(clientKey(headers({ "x-forwarded-for": "6.6.6.6, 7.7.7.7" }))).toBe("6.6.6.6");
    expect(clientKey(headers({}))).toBe("unknown");
  });
});
