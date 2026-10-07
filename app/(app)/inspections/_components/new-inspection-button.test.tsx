// "New Inspection" is a real link to /inspections/new, not a switched-off button.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NEW_INSPECTION_PATH, NewInspectionButton } from "./new-inspection-button";

describe("NewInspectionButton", () => {
  it("links to the new inspection screen", () => {
    const html = renderToStaticMarkup(<NewInspectionButton />);
    expect(NEW_INSPECTION_PATH).toBe("/inspections/new");
    expect(html).toMatch(/^<a [^>]*href="\/inspections\/new"[^>]*>.*New Inspection<\/a>$/);
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it("is a pill button that grows to 44 px on touch, never switched off", () => {
    const html = renderToStaticMarkup(<NewInspectionButton />);
    expect(html).toContain('data-slot="button"');
    expect(html).toMatch(/class="[^"]*\btouch:h-11\b/);
    // Attributes, not the button's disabled: styles.
    expect(html).not.toMatch(/\s(aria-disabled|disabled)=|data-slot="tooltip/);
  });
});
