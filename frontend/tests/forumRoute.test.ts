// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/forum/route";

const call = (url: string, ip: string) =>
  GET(new NextRequest(`http://localhost/api/forum?url=${encodeURIComponent(url)}`, { headers: { "x-real-ip": ip } }));

// Every URL here is rejected before any DNS lookup or network access.
describe("/api/forum", () => {
  it.each([
    "http://127.0.0.1/", "http://0177.0.0.1/", "http://0x7f.0.0.1/", "http://2130706433/", "http://169.254.169.254/latest/meta-data",
    "http://[::1]/", "http://[fd00::1]/", "http://[::ffff:10.0.0.1]/", "http://localhost/", "https://db.internal/", "file:///etc/passwd", "",
  ])("refuses %j with a 400 and no fetch", async (url) => {
    // A distinct client per case, so the rate limiter never interferes with what is being tested.
    const res = await call(url, `203.0.113.${Math.floor(Math.random() * 250) + 1}-${url}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.available).toBe(false);
    expect(typeof body.error).toBe("string");
  });

  it("limits each client to 10 requests a minute and says when to retry", async () => {
    const ip = "198.51.100.77";
    for (let i = 0; i < 10; i++) expect((await call("http://127.0.0.1/", ip)).status).toBe(400);   // allowed, then refused as private
    const limited = await call("http://127.0.0.1/", ip);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(limited.headers.get("RateLimit-Remaining")).toBe("0");
    expect((await limited.json()).error).toMatch(/rate limit/i);
  });

  it("counts clients separately", async () => {
    for (let i = 0; i < 11; i++) await call("http://127.0.0.1/", "198.51.100.88");
    expect((await call("http://127.0.0.1/", "198.51.100.89")).status).toBe(400);
  });
});
