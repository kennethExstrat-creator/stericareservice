import { describe, expect, it } from "vitest";
import { classifyPath, CREATE_ACCOUNT_PATH, HOME_PATH, proxyDecision, safeNextPath } from "./routes";

describe("proxyDecision", () => {
  const request = (overrides: Partial<Parameters<typeof proxyDecision>[0]>) =>
    proxyDecision({ method: "GET", pathname: "/", search: "", next: null, signedIn: false, ...overrides });

  it("sends signed-out page visits to /login with the page as next", () => {
    expect(request({ pathname: "/inspections", search: "?status=draft" })).toEqual({
      action: "redirect",
      location: "/login?next=%2Finspections%3Fstatus%3Ddraft",
    });
    expect(request({ pathname: "/" })).toEqual({ action: "redirect", location: "/login" });
    expect(request({ method: "HEAD", pathname: "/admin" })).toEqual({
      action: "redirect",
      location: "/login?next=%2Fadmin",
    });
  });

  it("sends signed-in visitors away from the sign-in screens, only to a safe next", () => {
    expect(request({ pathname: "/login", signedIn: true })).toEqual({ action: "redirect", location: HOME_PATH });
    expect(request({ pathname: "/login", signedIn: true, next: "/admin/users" })).toEqual({
      action: "redirect",
      location: "/admin/users",
    });
    expect(request({ pathname: "/login", signedIn: true, next: "/.//evil.example" })).toEqual({
      action: "redirect",
      location: HOME_PATH,
    });
  });

  it("lets Server Actions and other non-navigation methods through to answer for themselves", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(request({ method, pathname: "/login", signedIn: true })).toEqual({ action: "pass" });
      expect(request({ method, pathname: "/inspections/abc", signedIn: false })).toEqual({ action: "pass" });
    }
  });

  it("never redirects API routes or open pages", () => {
    expect(request({ pathname: "/api/inspections/1/export" })).toEqual({ action: "pass" });
    expect(request({ pathname: "/auth/confirm", signedIn: true })).toEqual({ action: "pass" });
    expect(request({ pathname: "/reset-password", signedIn: true })).toEqual({ action: "pass" });
  });

  it("lets Account Creation through signed in (the invitation's session) and signed out (an expired link)", () => {
    expect(request({ pathname: CREATE_ACCOUNT_PATH, signedIn: true })).toEqual({ action: "pass" });
    expect(request({ pathname: CREATE_ACCOUNT_PATH, signedIn: false })).toEqual({ action: "pass" });
  });

  it("passes signed-in page visits and signed-out sign-in screens", () => {
    expect(request({ pathname: "/inspections", signedIn: true })).toEqual({ action: "pass" });
    expect(request({ pathname: "/login" })).toEqual({ action: "pass" });
  });
});

describe("classifyPath", () => {
  it.each([
    ["/login", "guest"],
    ["/forgot-password", "guest"],
    ["/reset-password", "open"],
    ["/create-account", "open"],
    ["/auth/confirm", "open"],
    ["/auth/sign-out", "open"],
    ["/design", "open"],
    ["/api/inspections/1/export", "api"],
    ["/api", "api"],
    ["/", "protected"],
    ["/inspections", "protected"],
    ["/inspections/new", "protected"],
    ["/admin/users", "protected"],
  ] as const)("%s is %s", (path, kind) => {
    expect(classifyPath(path)).toBe(kind);
  });

  it("does not treat look-alike prefixes as public", () => {
    expect(classifyPath("/login-help")).toBe("protected");
    expect(classifyPath("/designer")).toBe("protected");
    expect(classifyPath("/authority")).toBe("protected");
    expect(classifyPath("/apis")).toBe("protected");
    expect(classifyPath("/create-accounts")).toBe("protected");
  });
});

describe("safeNextPath", () => {
  it("keeps same-origin paths with their query and hash", () => {
    expect(safeNextPath("/inspections/abc?tab=visual#size-M")).toBe("/inspections/abc?tab=visual#size-M");
    expect(safeNextPath("/admin/users")).toBe("/admin/users");
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["inspections"],
    ["https://evil.example/phish"],
    ["//evil.example"],
    ["/\\evil.example"],
    ["\\\\evil.example"],
    ["javascript:alert(1)"],
    // Dot segments collapse during parsing into a protocol-relative URL.
    ["/.//evil.example"],
    ["/..//evil.example"],
    ["/%2e//evil.example"],
    ["/%2e%2e//evil.example"],
    ["/x/..//evil.example"],
    ["/x/../..//evil.example/path?q=1"],
  ])("falls back for %s", (raw) => {
    expect(safeNextPath(raw)).toBe(HOME_PATH);
  });

  it("never sends the user back into the sign-in screens", () => {
    expect(safeNextPath("/login")).toBe(HOME_PATH);
    expect(safeNextPath("/forgot-password")).toBe(HOME_PATH);
    expect(safeNextPath("/auth/confirm?token_hash=x")).toBe(HOME_PATH);
  });

  it("uses the given fallback", () => {
    expect(safeNextPath(null, "/reset-password")).toBe("/reset-password");
  });
});
