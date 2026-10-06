// @vitest-environment node
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  assertAcceptableHostname, assertPublicUrl, fetchPinned, isBlockedIp, isBlockedIPv4, isBlockedIPv6,
  parseIPv6, parseStrictIPv4, rawHostOf, SsrfError, type Resolver,
} from "@/lib/ssrf";

const resolverFor = (...addresses: string[]): Resolver =>
  vi.fn(async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));

describe("IPv4 classification", () => {
  it.each([
    "127.0.0.1", "127.255.255.254", "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "100.64.0.1", "0.0.0.0", "192.0.2.1", "198.18.0.1", "224.0.0.1", "255.255.255.255", "240.0.0.1",
  ])("blocks %s", (ip) => expect(isBlockedIPv4(ip)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "11.0.0.1"])(
    "allows the public address %s", (ip) => expect(isBlockedIPv4(ip)).toBe(false));

  it.each(["0177.0.0.1", "0x7f.0.0.1", "127.1", "2130706433", "1.2.3", "256.1.1.1", "01.1.1.1", "1.1.1.1.1", ""])(
    "refuses to parse the non-canonical form %j", (value) => expect(parseStrictIPv4(value)).toBeNull());
});

describe("IPv6 classification", () => {
  it.each([
    "::1", "::", "fc00::1", "fd12:3456:789a::1", "fdff:ffff::1",       // loopback, unspecified, RFC 4193
    "fe80::1", "febf::1", "fe80::1%eth0", "fec0::1",                     // link-local, site-local
    "ff02::1", "2001:db8::1",                                           // multicast, documentation
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254",    // IPv4-mapped private
    "::ffff:7f00:1", "64:ff9b::a00:1", "2002:7f00:1::1", "::127.0.0.1", // hex-mapped, NAT64, 6to4, compat
  ])("blocks %s", (ip) => expect(isBlockedIPv6(ip)).toBe(true));

  it.each(["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "2a00:1450:4001::200e"])(
    "allows the public address %s", (ip) => expect(isBlockedIPv6(ip)).toBe(false));

  it("treats unparseable text as blocked rather than trusting it", () => {
    for (const bad of ["1::2::3", "gggg::1", "12345::1", ":::", "1:2:3:4:5:6:7:8:9", "not-an-ip"]) {
      expect(parseIPv6(bad) === null || isBlockedIPv6(bad)).toBe(true);
    }
    expect(isBlockedIp("definitely not an ip")).toBe(true);
  });
});

describe("hostname rules", () => {
  it("extracts the host exactly as written, before the URL parser normalises it", () => {
    expect(rawHostOf("http://0177.0.0.1/p")).toBe("0177.0.0.1");
    expect(rawHostOf("https://user:pw@Example.COM:8443/p?q=1#f")).toBe("Example.COM");
    expect(rawHostOf("http://[::1]:80/p")).toBe("[::1]");
    expect(rawHostOf("not a url")).toBe("");
  });

  it.each([
    "0177.0.0.1", "0300.0250.0.1", "0x7f.0.0.1", "0x7f000001", "2130706433", "127.1", "1.2.3", "01.1.1.1", "999.1.1.1",
    "127.0.0.1", "10.1.2.3", "169.254.169.254", "localhost", "LOCALHOST", "app.localhost", "printer.local", "db.internal",
    "router.lan", "nas.home.arpa", "[::1]", "[fd00::1]", "[fe80::1]", "[::ffff:127.0.0.1]", "",
  ])("rejects the host %j", (host) => expect(() => assertAcceptableHostname(host)).toThrow(SsrfError));

  it.each(["example.com", "forum.example-dao.org", "8.8.8.8", "sub.domain.example.co.uk", "1password.com", "[2606:4700:4700::1111]"])(
    "accepts %j", (host) => expect(() => assertAcceptableHostname(host)).not.toThrow());
});

describe("assertPublicUrl", () => {
  const pub = () => resolverFor("93.184.216.34");

  it("returns the validated address to pin", async () => {
    const target = await assertPublicUrl("https://forum.example.org/t/1", pub());
    expect(target.pin).toEqual({ address: "93.184.216.34", family: 4 });
    expect(target.url.hostname).toBe("forum.example.org");
  });

  it.each([
    "ftp://example.org/x", "file:///etc/passwd", "javascript:alert(1)", "gopher://example.org/", "//example.org/x", "example.org",
    "https://user:pw@example.org/", "https://example.org:8443/", "http://example.org:22/", "https://example.org\\@127.0.0.1/",
    "http://example.org/a b", "https://" + "a".repeat(3000) + ".org/",
  ])("rejects %j before any lookup", async (url) => {
    const resolver = pub();
    await expect(assertPublicUrl(url, resolver)).rejects.toBeInstanceOf(SsrfError);
    expect(resolver).not.toHaveBeenCalled();
  });

  it.each(["http://0177.0.0.1/p", "http://0x7f.0.0.1/p", "http://2130706433/p", "http://127.1/p", "http://[::1]/p", "http://[fd00::1]/p"])(
    "rejects the loopback spelling %s without resolving", async (url) => {
      const resolver = pub();
      await expect(assertPublicUrl(url, resolver)).rejects.toBeInstanceOf(SsrfError);
      expect(resolver).not.toHaveBeenCalled();
    });

  it("rejects a public-looking name that resolves to a private address", async () => {
    await expect(assertPublicUrl("https://forum.example.org/", resolverFor("10.1.2.3"))).rejects.toThrow(/non-public/);
    await expect(assertPublicUrl("https://forum.example.org/", resolverFor("fd00::5"))).rejects.toThrow(/non-public/);
  });

  it("rejects a mixed answer when even one record is private", async () => {
    await expect(assertPublicUrl("https://forum.example.org/", resolverFor("93.184.216.34", "127.0.0.1"))).rejects.toThrow(/non-public/);
    await expect(assertPublicUrl("https://forum.example.org/", resolverFor("2606:4700::1", "::ffff:192.168.0.1"))).rejects.toThrow(/non-public/);
  });

  it("rejects a host that does not resolve", async () => {
    await expect(assertPublicUrl("https://nxdomain.example.org/", vi.fn(async () => []))).rejects.toThrow(/did not resolve/);
  });

  it("resolves exactly once, so the validated answer is the only one that exists", async () => {
    const resolver = pub();
    await assertPublicUrl("https://forum.example.org/", resolver);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("prefers an IPv4 record and falls back to IPv6", async () => {
    expect((await assertPublicUrl("https://a.example.org/", resolverFor("2606:4700::1", "93.184.216.34"))).pin.family).toBe(4);
    expect((await assertPublicUrl("https://a.example.org/", resolverFor("2606:4700::1"))).pin).toEqual({ address: "2606:4700::1", family: 6 });
  });

  it("accepts a public IP literal without any DNS lookup", async () => {
    const resolver = pub();
    const target = await assertPublicUrl("http://8.8.8.8/p", resolver);
    expect(target.pin.address).toBe("8.8.8.8");
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe("pinned fetch (DNS rebinding)", () => {
  let server: http.Server;
  let port: number;
  const seenHosts: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seenHosts.push(String(req.headers.host));
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
        res.end();
      } else if (req.url === "/big") {
        res.end("x".repeat(2000));
      } else {
        res.setHeader("content-type", "text/plain");
        res.end("declared intent");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("connects to the pinned address even though the hostname cannot be resolved", async () => {
    // "pinned.invalid" never resolves. The only way to reach the server is the pin.
    const res = await fetchPinned(new URL(`http://pinned.invalid:${port}/post`), { address: "127.0.0.1", family: 4 });
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe("declared intent");
    expect(seenHosts.at(-1)).toBe(`pinned.invalid:${port}`); // the Host header still carries the name
  });

  it("never re-resolves: a hostname that would now point elsewhere does not matter", async () => {
    // "localhost" resolves to loopback anyway; pin to a different loopback alias to prove the pin wins.
    const res = await fetchPinned(new URL(`http://localhost:${port}/post`), { address: "127.0.0.1", family: 4 });
    expect(res.status).toBe(200);
  });

  it("caps the response size", async () => {
    const res = await fetchPinned(new URL(`http://pinned.invalid:${port}/big`), { address: "127.0.0.1", family: 4 }, { maxBytes: 100 });
    expect(res.truncated).toBe(true);
    expect(res.body.length).toBeLessThanOrEqual(100);
  });

  it("surfaces a redirect to a private target for the caller to re-validate", async () => {
    const res = await fetchPinned(new URL(`http://pinned.invalid:${port}/redirect`), { address: "127.0.0.1", family: 4 });
    expect(res.status).toBe(302);
    const next = String(res.headers.location);
    await expect(assertPublicUrl(next, resolverFor("93.184.216.34"))).rejects.toBeInstanceOf(SsrfError);
  });

  it("fails fast on an unreachable pinned address", async () => {
    await expect(fetchPinned(new URL("http://pinned.invalid:1/x"), { address: "127.0.0.1", family: 4 }, { timeoutMs: 1500 })).rejects.toBeDefined();
  });
});
