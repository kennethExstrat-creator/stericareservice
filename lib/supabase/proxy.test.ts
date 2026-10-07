import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn(), getClaims: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));

const { updateSession } = await import("./proxy");

/** The options createServerClient was last called with. */
function lastOptions() {
  return mocks.createServerClient.mock.lastCall?.[2] as { cookieOptions: object };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createServerClient.mockReturnValue({ auth: { getClaims: mocks.getClaims } });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } }, error: null });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("updateSession", () => {
  it("refreshes the session with Secure cookies on an HTTPS request", async () => {
    const { claims } = await updateSession(new NextRequest("https://qc.example.com/inspections"));
    expect(claims).toEqual({ sub: "user-1" });
    expect(lastOptions().cookieOptions).toEqual({ path: "/", sameSite: "lax", secure: true });
  });

  it("leaves Secure off over plain http (the dev server on the LAN)", async () => {
    await updateSession(new NextRequest("http://192.168.1.20:3000/inspections"));
    expect(lastOptions().cookieOptions).toEqual({ path: "/", sameSite: "lax", secure: false });
  });

  it("writes refreshed cookies with the attributes it was handed", async () => {
    mocks.createServerClient.mockImplementation(
      (_url: string, _key: string, options: { cookies: { setAll: (cookies: unknown[], headers: object) => void } }) => ({
        auth: {
          getClaims: async () => {
            options.cookies.setAll(
              [{ name: "sb-project-auth-token", value: "base64-new", options: { path: "/", sameSite: "lax", secure: true } }],
              { "Cache-Control": "private, no-store" },
            );
            return { data: { claims: { sub: "user-1" } }, error: null };
          },
        },
      }),
    );

    const { response } = await updateSession(new NextRequest("https://qc.example.com/inspections"));

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^sb-project-auth-token=base64-new;/);
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/;\s*SameSite=lax/i);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("reports nobody when the session is missing or invalid", async () => {
    mocks.getClaims.mockResolvedValueOnce({ data: null, error: new Error("invalid JWT") });
    const { claims } = await updateSession(new NextRequest("https://qc.example.com/inspections"));
    expect(claims).toBeNull();
  });
});
