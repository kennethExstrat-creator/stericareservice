import { describe, expect, it } from "vitest";
import { isHttpsRequest, sessionCookieOptions } from "./cookie-options";

describe("sessionCookieOptions", () => {
  it("marks the session cookies Secure over HTTPS", () => {
    expect(sessionCookieOptions(true)).toEqual({ path: "/", sameSite: "lax", secure: true });
  });

  it("leaves Secure off over plain http, so the dev server keeps working on the LAN", () => {
    expect(sessionCookieOptions(false)).toEqual({ path: "/", sameSite: "lax", secure: false });
  });

  it("never sets a name, domain or lifetime of its own", () => {
    // The name would rename the cookies (and sign everyone out); @supabase/ssr owns Max-Age.
    expect(Object.keys(sessionCookieOptions(true)).sort()).toEqual(["path", "sameSite", "secure"]);
  });
});

describe("isHttpsRequest", () => {
  it.each([
    ["https", true],
    ["HTTPS", true],
    ["https, http", true],
    [" https ", true],
    ["http", false],
    ["http, https", false],
    ["", false],
  ])("x-forwarded-proto %j is HTTPS: %s", (proto, expected) => {
    expect(isHttpsRequest(new Headers({ "x-forwarded-proto": proto }))).toBe(expected);
  });

  it("treats a request without the header as plain http", () => {
    expect(isHttpsRequest(new Headers())).toBe(false);
  });
});
