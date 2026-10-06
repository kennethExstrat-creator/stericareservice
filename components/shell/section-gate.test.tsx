import { readFileSync } from "node:fs";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hiddenSectionPaths, type UserRole } from "./nav";
import { SectionGate } from "./section-gate";

function render(pathname: string, role: UserRole): string {
  return renderToStaticMarkup(
    <PathnameContext.Provider value={pathname}>
      <SectionGate hidden={hiddenSectionPaths(role)}>
        <p>page</p>
      </SectionGate>
    </PathnameContext.Provider>,
  );
}

describe("SectionGate", () => {
  it("answers 404 when an inspector opens the admin area", () => {
    expect(() => render("/admin", "inspector")).toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(() => render("/admin/users", "inspector")).toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("renders the page for everyone else", () => {
    expect(render("/admin", "admin")).toBe("<p>page</p>");
    expect(render("/admin/users", "admin")).toBe("<p>page</p>");
    expect(render("/inspections", "inspector")).toBe("<p>page</p>");
    expect(render("/administration", "inspector")).toBe("<p>page</p>");
  });
});

describe("client components", () => {
  // The nav config lists every admin screen. Client components import the
  // matching rules only, so that list never ships to an inspector's browser.
  it.each(["nav-link.tsx", "section-gate.tsx", "user-menu.tsx", "error-screen.tsx"])("%s does not import the nav config", (file) => {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    expect(source).toMatch(/^"use client";/);
    expect(source).not.toMatch(/from "\.\/nav"|from "@\/components\/shell\/nav"/);
  });
});
