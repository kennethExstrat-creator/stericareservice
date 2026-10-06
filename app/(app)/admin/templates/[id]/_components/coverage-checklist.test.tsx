// The coverage form keeps its last tick through a refused confirmation: it is
// submitted by hand (lib/admin/submit.ts), never through a function `action`,
// which React resets after every action, clearing the Checkbox. e2e/templates
// refuses a confirmation in the browser and checks the tick stays.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CoverageChecklist as Checklist } from "@/lib/admin/templates";

vi.mock("./actions", () => ({ confirmCoverage: vi.fn() }));

import { CoverageChecklist } from "./coverage-checklist";

/** What React draws for `<form action={fn}>` on the server: such a form is reset after every action. */
const FUNCTION_ACTION = "React form unexpectedly submitted";

const checklist: Checklist = {
  mode: "none",
  inventoryCode: null,
  documents: [],
  fields: 0,
  missing: 0,
  blocking: false,
  sectionKeys: [],
};

describe("CoverageChecklist", () => {
  it("submits by hand, so a refused confirmation never clears the last tick", () => {
    const html = renderToStaticMarkup(
      <CoverageChecklist
        templateId="1b4e28ba-2fa1-4d2b-9f3a-1c2d3e4f5a6b"
        seen="2026-10-06T10:45:02.066067+00:00"
        code="E2E_EG"
        checklist={checklist}
        confirmed={null}
        blocker={null}
        unresolvedAdvice=""
        sourceFileName="form.pdf"
      />,
    );
    expect(html).toContain("<form");
    expect(html).not.toContain(FUNCTION_ACTION);
    expect(html).toMatch(/<button[^>]*role="checkbox"[^>]*aria-checked="false"[^>]*value="yes"/);
    expect(html).toContain("I have checked <span");
  });
});
