import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS, withSecurityHeaders } from "./security-headers";

describe("SECURITY_HEADERS", () => {
  it("refuses framing by any site, the old way and the CSP way", () => {
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
  });

  it("keeps the policy to directives that cannot block the app's own scripts, styles or images", () => {
    const directives = SECURITY_HEADERS["Content-Security-Policy"].split(";").map((directive) => directive.trim().split(" ")[0]);
    expect(directives).toEqual(["frame-ancestors", "base-uri", "object-src"]);
  });

  it("sends only the origin to other sites and stops content-type guessing", () => {
    expect(SECURITY_HEADERS["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("keeps the camera for photos and turns the other device features off", () => {
    const policy = SECURITY_HEADERS["Permissions-Policy"];
    expect(policy).toContain("camera=(self)");
    for (const feature of ["microphone", "geolocation", "payment", "usb"]) expect(policy).toContain(`${feature}=()`);
  });
});

describe("withSecurityHeaders", () => {
  it("sets every header on the response, replacing any value already there, and returns it", () => {
    const response = new Response(null, { headers: { "X-Frame-Options": "ALLOWALL", "Cache-Control": "no-store" } });

    expect(withSecurityHeaders(response)).toBe(response);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(response.headers.get(name)).toBe(value);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
