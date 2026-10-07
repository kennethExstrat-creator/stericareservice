import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseNotConfiguredError } from "@/lib/env";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  cookieStore: { getAll: vi.fn(), set: vi.fn() },
  requestHeaders: new Headers(),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("next/headers", () => ({
  cookies: async () => mocks.cookieStore,
  headers: async () => mocks.requestHeaders,
}));

const { createAuthClient, createClient } = await import("./server");

const PROJECT_URL = "https://project.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_test";
const SECRET_KEY = "sb_secret_test";

type ClientOptions = {
  cookies: { getAll(): unknown; setAll(cookies: { name: string; value: string; options: object }[]): void };
  cookieOptions: object;
  global?: { headers: Record<string, string> };
};

/** The [url, key, options] createServerClient was last called with. */
function lastCall(): [string, string, ClientOptions] {
  return mocks.createServerClient.mock.lastCall as [string, string, ClientOptions];
}

function request(headers: Record<string, string>) {
  mocks.requestHeaders = new Headers(headers);
}

beforeEach(() => {
  vi.clearAllMocks();
  // A stand-in client: `auth` is what createAuthClient hands out, `from` what it must not.
  mocks.createServerClient.mockImplementation((_url: string, key: string) => ({ key, auth: { key }, from: vi.fn() }));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PROJECT_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", PUBLISHABLE_KEY);
  vi.stubEnv("SUPABASE_SECRET_KEY", SECRET_KEY);
  vi.stubEnv("VERCEL", "");
  request({ "x-forwarded-proto": "http" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createClient", () => {
  it("acts as the user: publishable key, session cookies, no extra headers", async () => {
    await createClient();
    const [url, key, options] = lastCall();
    expect([url, key]).toEqual([PROJECT_URL, PUBLISHABLE_KEY]);
    expect(options.global).toBeUndefined();
  });

  it("marks the session cookies Secure when the request came over HTTPS", async () => {
    request({ "x-forwarded-proto": "https" });
    await createClient();
    expect(lastCall()[2].cookieOptions).toEqual({ path: "/", sameSite: "lax", secure: true });
  });

  it("leaves Secure off over plain http (the dev server on the LAN)", async () => {
    await createClient();
    expect(lastCall()[2].cookieOptions).toEqual({ path: "/", sameSite: "lax", secure: false });
  });

  it("reads and writes the request's cookies, and lets Server Components skip the writing", async () => {
    mocks.cookieStore.getAll.mockReturnValue([{ name: "sb-project-auth-token", value: "base64-abc" }]);
    await createClient();
    const { cookies } = lastCall()[2];

    expect(cookies.getAll()).toEqual([{ name: "sb-project-auth-token", value: "base64-abc" }]);
    cookies.setAll([{ name: "sb-project-auth-token", value: "base64-def", options: { secure: true } }]);
    expect(mocks.cookieStore.set).toHaveBeenCalledWith("sb-project-auth-token", "base64-def", { secure: true });

    mocks.cookieStore.set.mockImplementationOnce(() => {
      throw new Error("Cookies can only be modified in a Server Action or Route Handler.");
    });
    expect(() => cookies.setAll([{ name: "sb-project-auth-token", value: "x", options: {} }])).not.toThrow();
  });

  it("refuses to start without the Supabase settings", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    await expect(createClient()).rejects.toBeInstanceOf(SupabaseNotConfiguredError);
  });
});

describe("createAuthClient", () => {
  it("hands out only the auth API of a secret-key client, never one that can query", async () => {
    const auth = await createAuthClient();
    const client = mocks.createServerClient.mock.results.at(-1)?.value as { auth: unknown };

    expect(lastCall()[1]).toBe(SECRET_KEY);
    expect(auth).toBe(client.auth);
    expect(auth).not.toHaveProperty("from");
  });

  it("on Vercel, names the visitor's address in Sb-Forwarded-For", async () => {
    vi.stubEnv("VERCEL", "1");
    request({ "x-forwarded-proto": "https", "x-real-ip": "203.0.113.7", "x-forwarded-for": "203.0.113.7" });

    await createAuthClient();

    const [url, key, options] = lastCall();
    expect([url, key]).toEqual([PROJECT_URL, SECRET_KEY]);
    expect(options.global).toEqual({ headers: { "Sb-Forwarded-For": "203.0.113.7" } });
    expect(options.cookieOptions).toEqual({ path: "/", sameSite: "lax", secure: true });
  });

  it("sends no address that is not one", async () => {
    vi.stubEnv("VERCEL", "1");
    request({ "x-real-ip": "evil.example" });
    await createAuthClient();
    expect(lastCall()[2].global).toBeUndefined();
  });

  it("off Vercel, trusts no address header: the server's own address stays the key", async () => {
    request({ "x-forwarded-proto": "http", "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" });
    await createAuthClient();
    const [, key, options] = lastCall();
    expect(key).toBe(SECRET_KEY);
    expect(options.global).toBeUndefined();
    expect(options.cookieOptions).toEqual({ path: "/", sameSite: "lax", secure: false });
  });

  it.each([
    ["no secret key", ""],
    // Supabase takes Sb-Forwarded-For only with sb_secret_ keys, not the legacy service_role JWT.
    ["a legacy service_role key", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature"],
  ])("with %s, signs in with the publishable key as before", async (_label, secretKey) => {
    vi.stubEnv("SUPABASE_SECRET_KEY", secretKey);
    vi.stubEnv("VERCEL", "1");
    request({ "x-real-ip": "203.0.113.7" });

    const auth = await createAuthClient();

    const [, key, options] = lastCall();
    expect(key).toBe(PUBLISHABLE_KEY);
    expect(options.global).toBeUndefined();
    expect(auth).toEqual({ key: PUBLISHABLE_KEY });
  });

  it("refuses to start without the Supabase settings", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    await expect(createAuthClient()).rejects.toBeInstanceOf(SupabaseNotConfiguredError);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
});
