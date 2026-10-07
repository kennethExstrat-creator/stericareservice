import { afterEach, describe, expect, it, vi } from "vitest";
import { trustedVisitorIp } from "./forwarded-for";

const headers = (entries: Record<string, string>) => new Headers(entries);

describe("trustedVisitorIp on Vercel", () => {
  it("takes x-real-ip, which Vercel sets on every request", () => {
    expect(trustedVisitorIp(headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }), true)).toBe(
      "203.0.113.7",
    );
  });

  it("falls back to the first x-forwarded-for entry", () => {
    expect(trustedVisitorIp(headers({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" }), true)).toBe("203.0.113.7");
  });

  it("passes IPv6 addresses through", () => {
    expect(trustedVisitorIp(headers({ "x-real-ip": "2001:db8::42" }), true)).toBe("2001:db8::42");
  });

  it.each([
    ["no header at all", {}],
    ["an empty header", { "x-real-ip": "" }],
    ["a host name", { "x-real-ip": "evil.example" }],
    ["an address with a port", { "x-forwarded-for": "203.0.113.7:4431" }],
    ["two addresses in x-real-ip", { "x-real-ip": "203.0.113.7, 198.51.100.1" }],
    ["text after an address", { "x-forwarded-for": "203.0.113.7 or 1=1" }],
  ])("gives nothing for %s", (_label, entries: Record<string, string>) => {
    expect(trustedVisitorIp(headers(entries), true)).toBeNull();
  });
});

describe("trustedVisitorIp anywhere else", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("trusts no header: under next dev and next start the visitor writes them", () => {
    expect(trustedVisitorIp(headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "203.0.113.7" }), false)).toBeNull();
  });

  it("knows Vercel by its VERCEL=1 environment variable", () => {
    const visitor = headers({ "x-real-ip": "203.0.113.7" });
    vi.stubEnv("VERCEL", "1");
    expect(trustedVisitorIp(visitor)).toBe("203.0.113.7");
    vi.stubEnv("VERCEL", "");
    expect(trustedVisitorIp(visitor)).toBeNull();
  });
});
