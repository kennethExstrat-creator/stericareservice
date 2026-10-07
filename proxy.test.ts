import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SECURITY_HEADERS } from "@/lib/auth/security-headers";

const mocks = vi.hoisted(() => ({ updateSession: vi.fn() }));
vi.mock("@/lib/supabase/proxy", () => ({ updateSession: mocks.updateSession }));

const { proxy } = await import("./proxy");

/** What updateSession reports: the user signed in or not, and the response it built. */
function session(signedIn: boolean, response: NextResponse = NextResponse.next()) {
  mocks.updateSession.mockResolvedValueOnce({ response, claims: signedIn ? { sub: "user-1" } : null });
  return response;
}

function expectSecurityHeaders(response: Response) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(response.headers.get(name), name).toBe(value);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("proxy", () => {
  it("lets a signed-in page request through with the security headers", async () => {
    const refreshed = session(true);
    const response = await proxy(new NextRequest("http://localhost:3000/inspections"));
    expect(response).toBe(refreshed);
    expectSecurityHeaders(response);
  });

  it("puts the security headers on the sign-in page", async () => {
    session(false);
    expectSecurityHeaders(await proxy(new NextRequest("http://localhost:3000/login")));
  });

  it("puts them on Server Action posts, which it never redirects", async () => {
    session(false);
    const response = await proxy(new NextRequest("http://localhost:3000/inspections", { method: "POST" }));
    expect(response.status).toBe(200);
    expectSecurityHeaders(response);
  });

  it("puts them on its redirects too, which keep the refreshed session and its cache headers", async () => {
    const refreshed = NextResponse.next();
    refreshed.cookies.set("sb-project-auth-token", "base64-new", { path: "/", sameSite: "lax", secure: true });
    refreshed.headers.set("cache-control", "private, no-store");
    session(true, refreshed);

    // Signed in, the sign-in screen sends you on.
    const response = await proxy(new NextRequest("https://qc.example.com/login"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://qc.example.com/inspections");
    expect(response.headers.get("set-cookie")).toMatch(/^sb-project-auth-token=base64-new;.*Secure/i);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expectSecurityHeaders(response);
  });

  it("sends a signed-out visitor to /login with the headers on the redirect", async () => {
    session(false);
    const response = await proxy(new NextRequest("http://localhost:3000/inspections?status=draft"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?next=%2Finspections%3Fstatus%3Ddraft");
    expectSecurityHeaders(response);
  });
});
