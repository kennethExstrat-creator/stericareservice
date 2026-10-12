// Sections and Order on the Inspection Summary card: the moves and switches
// behind it (Result stays first and on, nothing moves past either end) and
// the field as it draws, closed and open. e2e opens it in the browser.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import { DEFAULT_SUMMARY_STYLE, type SummarySection } from "@/lib/schemas/summary-style";
import { atEnd, moveSection, sectionsLine, SummarySectionsField, switchSection, tickOverview } from "./summary-sections-field";

const SECTIONS = DEFAULT_SUMMARY_STYLE.sections;
const keys = (sections: readonly SummarySection[]) => sections.map((section) => section.key);

function draw(props: Partial<Parameters<typeof SummarySectionsField>[0]> = {}): string {
  return renderToStaticMarkup(
    <SummarySectionsField
      sections={SECTIONS}
      overview={DEFAULT_SUMMARY_STYLE.overview}
      onSectionsChange={() => {}}
      onOverviewChange={() => {}}
      open={false}
      onOpenChange={() => {}}
      {...props}
    />,
  );
}

/** The button whose name is `name`, as markup. */
function button(html: string, name: string): string | undefined {
  return html.match(new RegExp(`<button[^>]*aria-label="${name}"[^>]*>`))?.[0];
}

describe("the parts and their order", () => {
  it("names the parts that are on, in order", () => {
    expect(sectionsLine(SECTIONS)).toBe(
      "Result, Remark, Issues First, Order Overview, Sampling Plan, Test Results, Defects Found, Inspector Comments, Next Step.",
    );
    expect(sectionsLine(switchSection(SECTIONS, "remark", false))).not.toContain("Remark");
  });

  it("moves a part one place, never above Result or past the end", () => {
    expect(keys(moveSection(SECTIONS, "sampling", -1)).slice(3, 5)).toEqual(["sampling", "overview"]);
    expect(keys(moveSection(SECTIONS, "overview", 1)).slice(3, 5)).toEqual(["sampling", "overview"]);
    expect(moveSection(SECTIONS, "remark", -1)).toEqual(SECTIONS);
    expect(moveSection(SECTIONS, "next_step", 1)).toEqual(SECTIONS);
    expect(moveSection(SECTIONS, "result", 1)).toEqual(SECTIONS);
    expect([atEnd(SECTIONS, "remark", -1), atEnd(SECTIONS, "remark", 1), atEnd(SECTIONS, "next_step", 1)]).toEqual([true, false, true]);
  });

  it("keeps Result on and ticks Order Overview's details in their own order", () => {
    expect(switchSection(SECTIONS, "result", false)[0]).toEqual({ key: "result", on: true });
    expect(switchSection(SECTIONS, "excluded", true).find((section) => section.key === "excluded")?.on).toBe(true);
    expect(tickOverview(["sizes", "product"], "po", true)).toEqual(["product", "po", "sizes"]);
    expect(tickOverview(["product", "po"], "product", false)).toEqual(["po"]);
  });
});

describe("the field", () => {
  it("is one line with Change while closed", () => {
    const html = draw();
    expect(html).toContain(">Sections and Order</span>");
    expect(html).toContain(
      "Result, Remark, Issues First, Order Overview, Sampling Plan, Test Results, Defects Found, Inspector Comments, Next Step.",
    );
    expect(html).toContain("The order is also the priority");
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>.*Change<span class="sr-only"> Sections and Order<\/span><\/button>/);
    expect(html).not.toContain("<ol");
  });

  it("opens in place: a switch and Move Up / Move Down per part, greyed but focusable at either end", () => {
    const html = draw({ open: true });
    expect(html).toMatch(/<button[^>]*aria-expanded="true"[^>]*aria-controls="[^"]+-list"[^>]*>.*Done<\/button>/);
    expect(html.match(/<li /g)).toHaveLength(10);
    expect(html).toContain("Always On");
    // Result has no move buttons; the part after it cannot move up, the last cannot move down.
    expect(button(html, "Move Up: Result")).toBeUndefined();
    expect(button(html, "Move Up: Remark")).toContain('aria-disabled="true"');
    expect(button(html, "Move Down: Remark")).not.toContain('aria-disabled="true"');
    expect(button(html, "Move Down: Next Step")).toContain('aria-disabled="true"');
    expect(button(html, "Move Up: Next Step")).not.toMatch(/aria-disabled="true"|disabled=""/);
    // Sections Switched Off is off by default.
    expect(html).toMatch(/data-section="excluded" data-on="false"/);
  });

  it("lists Order Overview's details under it while it is on", () => {
    const html = draw({ open: true });
    for (const label of ["Product", "PO Number", "Sizes", "Quantities (Cartons and Gloves)", "Client", "Manufacturer and Factory", "Lot Numbers", "Inspection Date"]) {
      expect(html).toContain(`>${label}</label>`);
    }
    expect(html).toContain("The report&#x27;s header already prints them.");
    expect(draw({ open: true, sections: switchSection(SECTIONS, "overview", false) })).not.toContain('data-testid="summary-overview"');
  });

  it("says what a save refused, and greys everything while the settings cannot be saved", () => {
    expect(draw({ error: "List each part once." })).toContain("List each part once.");
    const html = draw({ open: true, disabled: true });
    expect(button(html, "Move Down: Remark")).toContain('disabled=""');
  });

  it("words its buttons in Title Case", () => {
    expect(["Change", "Done", "Always On", "Move Up: Remark", "Move Down: Next Step"].filter((label) => lowerCaseWords(label).length > 0)).toEqual([]);
  });
});
