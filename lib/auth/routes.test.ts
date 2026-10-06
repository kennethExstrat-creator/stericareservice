import { describe, expect, it } from "vitest";
import { classifyPath, HOME_PATH, safeNextPath } from "./routes";

describe("classifyPath", () => {
  it.each([
    ["/login", "guest"],
    ["/forgot-password", "guest"],
    ["/reset-password", "open"],
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
