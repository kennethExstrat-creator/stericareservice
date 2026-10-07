import { AuthApiError } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// redirect() ends a Route Handler by throwing; the stand-in does the same so
// the tests can see where it pointed.
const { Redirect, mocks } = vi.hoisted(() => {
  class Redirect extends Error {
    constructor(readonly url: string) {
      super(`redirect ${url}`);
    }
  }
  return {
    Redirect,
    mocks: { createAuthClient: vi.fn(), createClient: vi.fn(), isSupabaseConfigured: vi.fn(), verifyOtp: vi.fn() },
  };
});

vi.mock("@/lib/supabase/server", () => ({ createAuthClient: mocks.createAuthClient, createClient: mocks.createClient }));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  isSupabaseConfigured: mocks.isSupabaseConfigured,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));

const { GET } = await import("./route");

/** Opens an email link and returns where the route sent the browser. */
async function open(query: string): Promise<string> {
  const thrown = await GET(new NextRequest(`http://localhost:3000/auth/confirm?${query}`)).then(
    () => null,
    (error: unknown) => error,
  );
  if (!(thrown instanceof Redirect)) throw new Error(`expected a redirect, got ${String(thrown)}`);
  return thrown.url;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isSupabaseConfigured.mockReturnValue(true);
  mocks.verifyOtp.mockResolvedValue({ data: { session: {} }, error: null });
  mocks.createAuthClient.mockResolvedValue({ verifyOtp: mocks.verifyOtp });
});

describe("GET /auth/confirm", () => {
  it("checks a reset link through the auth client and opens the password screen", async () => {
    expect(await open("token_hash=abc123&type=recovery")).toBe("/reset-password?flow=recovery");
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "abc123" });
    // The secret-key auth client checks the link; the user's data client is not needed here.
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("sends an invite to the first-password screen", async () => {
    expect(await open("token_hash=abc123&type=invite")).toBe("/reset-password?flow=invite");
  });

  it("follows a safe ?next= for other link types, and only a safe one", async () => {
    expect(await open("token_hash=abc123&type=email&next=%2Finspections%3Fstatus%3Ddraft")).toBe("/inspections?status=draft");
    expect(await open("token_hash=abc123&type=email&next=https%3A%2F%2Fevil.example")).toBe("/inspections");
  });

  it("turns an expired or used link into the sign-in screen's notice", async () => {
    mocks.verifyOtp.mockResolvedValueOnce({ data: {}, error: new AuthApiError("Email link is invalid or has expired", 403, "otp_expired") });
    expect(await open("token_hash=abc123&type=recovery")).toBe("/login?error=link_invalid");
  });

  it.each([
    ["no token", "type=recovery"],
    ["no type", "token_hash=abc123"],
    ["a type it does not take", "token_hash=abc123&type=magiclink"],
  ])("refuses a link with %s without asking Supabase", async (_label, query) => {
    expect(await open(query)).toBe("/login?error=link_invalid");
    expect(mocks.createAuthClient).not.toHaveBeenCalled();
  });

  it("refuses every link while Supabase is not configured", async () => {
    mocks.isSupabaseConfigured.mockReturnValue(false);
    expect(await open("token_hash=abc123&type=recovery")).toBe("/login?error=link_invalid");
    expect(mocks.createAuthClient).not.toHaveBeenCalled();
  });
});
