// The approve dialog's description, server-rendered inside its dialog. The
// dialog names its description in aria-describedby, so whatever sits in it
// is read out with the title when the dialog opens.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/inspections/review/actions", () => ({ approveInspection: vi.fn(), reopenInspection: vi.fn() }));
vi.mock("@/components/capture/photos", () => ({ refreshInspectionMedia: vi.fn(() => Promise.resolve()) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn() } }));

import { toast } from "sonner";
import { refreshInspectionMedia } from "@/components/capture/photos";
import { AlertDialog } from "@/components/ui/alert-dialog";
import type { ApprovalFacts } from "@/lib/inspections/review/approval";
import { ApproveDescription, settle } from "./review-actions";

const INSPECTION_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("settle", () => {
  it("closes with a toast after an approve or reopen, and reads the photos again with the new status", () => {
    const onClose = vi.fn();
    settle(INSPECTION_ID, { status: "success", message: "INS-2026-0001 is approved." }, onClose);
    expect(toast.success).toHaveBeenCalledWith("INS-2026-0001 is approved.");
    expect(onClose).toHaveBeenCalledOnce();
    expect(refreshInspectionMedia).toHaveBeenCalledWith(INSPECTION_ID);
  });

  it("does the same when someone else acted first: the status moved on all the same", () => {
    const onClose = vi.fn();
    settle(INSPECTION_ID, { status: "warning", message: "It changed after you opened it." }, onClose);
    expect(toast.warning).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(refreshInspectionMedia).toHaveBeenCalledWith(INSPECTION_ID);
  });

  it("keeps the dialog open on an error, with nothing to read again", () => {
    const onClose = vi.fn();
    const result = settle(INSPECTION_ID, { status: "error", message: "Could not approve. Try again." }, onClose);
    expect(result).toEqual({ status: "error", message: "Could not approve. Try again." });
    expect(onClose).not.toHaveBeenCalled();
    expect(refreshInspectionMedia).not.toHaveBeenCalled();
  });
});

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
