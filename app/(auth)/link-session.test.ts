import { beforeEach, describe, expect, it, vi } from "vitest";

const { getClaims } = vi.hoisted(() => ({ getClaims: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims } }) }));

const { LINK_SESSION_MAX_AGE_SECONDS, sessionStartedByRecentLink, startedByRecentLink } = await import("./link-session");

const NOW = 1_791_284_644; // seconds

describe("startedByRecentLink", () => {
  // What hosted Supabase put in the JWT on 2026-10-06 (e2e probe): a reset or
  // invite link signs in as "otp", a password sign-in as "password".
  it("accepts a session an email link started a moment ago", () => {
    expect(startedByRecentLink([{ method: "otp", timestamp: NOW - 5 }], NOW)).toBe(true);
  });

  it("accepts it up to an hour later, the links' own lifetime", () => {
    expect(startedByRecentLink([{ method: "otp", timestamp: NOW - LINK_SESSION_MAX_AGE_SECONDS }], NOW)).toBe(true);
    expect(startedByRecentLink([{ method: "otp", timestamp: NOW - LINK_SESSION_MAX_AGE_SECONDS - 1 }], NOW)).toBe(false);
  });

  it("refuses a password sign-in, however recent", () => {
    expect(startedByRecentLink([{ method: "password", timestamp: NOW }], NOW)).toBe(false);
  });

  it.each(["recovery", "invite", "magiclink"])("accepts the alternative method name %s", (method) => {
    expect(startedByRecentLink([{ method, timestamp: NOW - 60 }], NOW)).toBe(true);
  });

  it("refuses a sign-in time from the future beyond clock skew", () => {
    expect(startedByRecentLink([{ method: "otp", timestamp: NOW + 30 }], NOW)).toBe(true);
    expect(startedByRecentLink([{ method: "otp", timestamp: NOW + 3600 }], NOW)).toBe(false);
  });

  it("reads the plain RFC 8176 form by method only (it has no time)", () => {
    expect(startedByRecentLink(["otp"], NOW)).toBe(true);
    expect(startedByRecentLink(["password", "mfa/totp"], NOW)).toBe(false);
  });

  it("refuses a session with no amr claim", () => {
    expect(startedByRecentLink(undefined, NOW)).toBe(false);
    expect(startedByRecentLink([], NOW)).toBe(false);
  });
});

describe("sessionStartedByRecentLink", () => {
  beforeEach(() => getClaims.mockReset());

  it("checks the signed-in user's verified claims", async () => {
    getClaims.mockResolvedValue({ data: { claims: { amr: [{ method: "otp", timestamp: Date.now() / 1000 - 10 }] } }, error: null });
    await expect(sessionStartedByRecentLink()).resolves.toBe(true);

    getClaims.mockResolvedValue({ data: { claims: { amr: [{ method: "password", timestamp: Date.now() / 1000 }] } }, error: null });
    await expect(sessionStartedByRecentLink()).resolves.toBe(false);
  });

  it("refuses when the claims cannot be verified", async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error("invalid JWT") });
    await expect(sessionStartedByRecentLink()).resolves.toBe(false);
  });
});
