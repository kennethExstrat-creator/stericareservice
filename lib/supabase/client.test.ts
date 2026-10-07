import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createBrowserClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createBrowserClient: mocks.createBrowserClient }));

const { createClient } = await import("./client");

function visit(protocol: "https:" | "http:") {
  vi.stubGlobal("window", { location: { protocol } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("createClient (browser)", () => {
  it("writes Secure session cookies on an HTTPS page, with the publishable key only", () => {
    visit("https:");
    createClient();
    expect(mocks.createBrowserClient).toHaveBeenCalledWith("https://project.supabase.co", "sb_publishable_test", {
      cookieOptions: { path: "/", sameSite: "lax", secure: true },
    });
  });

  it("leaves Secure off on a plain http page (the dev server on the LAN)", () => {
    visit("http:");
    createClient();
    expect(mocks.createBrowserClient.mock.lastCall?.[2]).toEqual({ cookieOptions: { path: "/", sameSite: "lax", secure: false } });
  });

  it("does not reach for window while a page renders on the server", () => {
    createClient();
    expect(mocks.createBrowserClient.mock.lastCall?.[2]).toEqual({ cookieOptions: { path: "/", sameSite: "lax", secure: false } });
  });
});
