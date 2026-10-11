// The attachment line with the screen's file slot in it (the capture
// screen's lab report and documents lines): the slot takes the place of the
// line's own words, calc's warnings stay under it. The line's own words, with
// no slot, are tested with the rest of the kit (kit.test.tsx).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AttachmentStatus } from "./attachment-status";

const SLOT = '<span data-test="screen-slot">No lab report detected by Steri-AI.</span>';
const slot = <span data-test="screen-slot">No lab report detected by Steri-AI.</span>;
const lineOf = (html: string) => /<div[^>]*data-slot="attachment-status"[^>]*>/.exec(html)?.[0] ?? "";

describe("AttachmentStatus with the screen's file slot", () => {
  it("shows the slot in place of its own words, the Not Done pill and the requirement included", () => {
    const html = renderToStaticMarkup(
      <AttachmentStatus label="Lab Report" state="none" required issuePath={["labReport"]}>
        {slot}
      </AttachmentStatus>,
    );
    expect(html).toContain(">Lab Report</span>");
    expect(html).toContain(`<div data-slot="attachment-file" class="flex min-w-[min(14rem,100%)] flex-1 items-center">${SLOT}</div>`);
    expect(html).not.toContain("Not Attached");
    expect(html).not.toContain("Required before this section is done.");
    expect(html).not.toContain('data-slot="status-pill"');
    // Still the notice an issue link lands on.
    expect(lineOf(html)).toContain('tabindex="-1"');
    expect(lineOf(html)).toContain('data-state="none"');
  });

  it("keeps the line as tall as the slot's buttons, linked or not, so nothing below moves when Steri-AI links a file", () => {
    const classes = (html: string) => (/class="([^"]*)"/.exec(lineOf(html))?.[1] ?? "").split(" ");
    const withSlot = renderToStaticMarkup(
      <AttachmentStatus label="Lab Report" state="attached">
        {slot}
      </AttachmentStatus>,
    );
    expect(classes(withSlot)).toEqual(expect.arrayContaining(["min-h-8", "touch:min-h-11"]));
    expect(classes(renderToStaticMarkup(<AttachmentStatus label="Lab Report" state="attached" />))).not.toContain("min-h-8");
  });

  it("keeps calc's warning under the slot for a kept file that is gone", () => {
    const warning = "Lab Report: the file attached here is not among this inspection's files.";
    const html = renderToStaticMarkup(
      <AttachmentStatus label="Lab Report" state="missing" required warning={warning}>
        {slot}
      </AttachmentStatus>,
    );
    expect(lineOf(html)).toContain('data-state="missing"');
    expect(html).toContain("lucide-file-x");
    expect(html).toContain(SLOT);
    expect(html).toContain(warning.replaceAll("'", "&#x27;"));
    expect(html.indexOf(SLOT)).toBeLessThan(html.indexOf("text-warn"));
  });
});
