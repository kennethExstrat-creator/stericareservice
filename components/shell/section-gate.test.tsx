import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UserRole } from "./nav";
import { SectionGate } from "./section-gate";

function render(pathname: string, role: UserRole): string {
  return renderToStaticMarkup(
    <PathnameContext.Provider value={pathname}>
      <SectionGate role={role}>
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
  });
});
