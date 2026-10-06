// The approve dialog's description, server-rendered inside its dialog. The
// dialog names its description in aria-describedby, so whatever sits in it
// is read out with the title when the dialog opens.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/inspections/review/actions", () => ({ approveInspection: vi.fn(), reopenInspection: vi.fn() }));

import { AlertDialog } from "@/components/ui/alert-dialog";
import type { ApprovalFacts } from "@/lib/inspections/review/approval";
import { ApproveDescription } from "./review-actions";

function render(facts: ApprovalFacts): string {
  return renderToStaticMarkup(
    <AlertDialog open>
      <ApproveDescription {...facts} />
    </AlertDialog>,
  );
}

/** The text as textContent has it: tags dropped without adding spaces. */
function plain(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
}

describe("ApproveDescription", () => {
  it("makes the results and every caution part of the dialog's description", () => {
    const html = render({ finalResult: "pass", suggestedResult: "fail", errors: 2 });
    // One element, the dialog's description (with the id the dialog points at), around all of it.
    const opening = html.slice(0, html.indexOf(">") + 1);
    expect(opening).toMatch(/^<div /);
    expect(opening).toContain('data-slot="alert-dialog-description"');
    expect(opening).toMatch(/ id="[^"]+"/);
    expect(html.match(/data-slot="alert-dialog-description"/g)).toHaveLength(1);
    expect(html.endsWith("</div>")).toBe(true);

    expect(plain(html)).toBe(
      "An approved inspection is final: nobody can change its results, photos or files afterwards. Only the choice of report photos stays open. " +
        "Final result Passed Suggested result Failed " +
        "The final result differs from the suggested result. " +
        "The checks found 2 errors. Reopen it instead if the inspector should fix them first.",
    );
  });

  it("says nothing was checked when the results could not be worked out, instead of reading as clean", () => {
    const text = plain(render({ finalResult: "fail", suggestedResult: null, errors: null }));
    expect(text).toContain("Suggested result Could not be worked out");
    expect(text).toContain("The results could not be worked out, so nothing was checked. Ask a developer before you approve it.");
    expect(text).not.toContain("The checks found");
  });

  it("lists no cautions when there is nothing to weigh", () => {
    expect(render({ finalResult: "pass", suggestedResult: "pass", errors: 0 })).not.toContain("<ul");
  });
});
