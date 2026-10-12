// The shortform panel as it first draws: the fields in order, the Type radios
// named for Chrome, the codes it sends, the picker's chosen codes, and the
// note when a defect has no code yet. The sheet is drawn in place here (a
// portal draws nothing on the server); e2e/defects adds and deletes one in
// the browser.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildShortformItems, type LibraryCode } from "@/lib/admin/shortforms";
import type { GlossaryEntry } from "@/lib/schemas/ai-settings";
import { radioNames } from "../../_components/radio-card.testing";

vi.mock("../actions", () => ({ saveShortform: vi.fn(), deleteShortform: vi.fn() }));
vi.mock("@/components/ui/sheet", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { Sheet: Part, SheetContent: Part, SheetDescription: Part, SheetFooter: Part, SheetHeader: Part, SheetTitle: Part };
});

import { ShortformPanel } from "./shortform-panel";

/** What React draws for `<form action={fn}>` on the server: such a form is reset after every action. */
const FUNCTION_ACTION = "React form unexpectedly submitted";

const LIBRARY: LibraryCode[] = [
  { code: "bead_defective", name: "Defective bead", active: true },
  { code: "bead_poor", name: "Poor beading", active: true },
  { code: "bead_old", name: "Old bead", active: false },
  { code: "skin_visual", name: "Skin visual", active: true },
];

const ENTRIES: GlossaryEntry[] = [
  { short: "IB", meaning: "Improper Beading", confirmed: true, kind: "defect", codes: ["bead_defective", "bead_old"] },
  { short: "SKV", meaning: "Skin Visual: a visual defect of the glove skin", confirmed: false, kind: "defect", codes: [] },
  { short: "WTT", meaning: "Watertight test", confirmed: true, kind: "term", codes: [] },
  { short: "TA", meaning: "Thin Area", confirmed: true, kind: "defect", codes: ["bead_defective", "bead_poor", "skin_visual"] },
];
const ITEMS = buildShortformItems(ENTRIES, LIBRARY);
const itemOf = (short: string) => ITEMS.find((item) => item.short === short)!;

function draw(short?: string): string {
  return renderToStaticMarkup(
    <ShortformPanel
      open
      target={short ? { mode: "edit", short } : { mode: "create" }}
      item={short ? itemOf(short) : null}
      library={LIBRARY}
      onClose={() => {}}
      onDeleted={() => {}}
      returnFocus={() => {}}
    />,
  );
}

/** The value of the hidden input named `name`, or each value when there are several. */
function hidden(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`<input type="hidden" name="${name}" value="([^"]*)"`, "g"))].map(([, value]) =>
    value.replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
  );
}

describe("ShortformPanel", () => {
  it("names each Type radio by its choice and describes it, so Chrome does not leave it unnamed", () => {
    expect(radioNames(draw())).toEqual([
      { name: "Defect", description: "Counted under a defect code." },
      { name: "Other Term", description: "A test, product or factory word." },
    ]);
  });

  it("adds a shortform: a confirmed defect to start with, no code yet, and submitted by hand", () => {
    const html = draw();
    expect(html).toContain("Add Shortform");
    expect(html).toContain("What inspectors write, and what it means.");
    expect(html).toContain("<form");
    expect(html).not.toContain(FUNCTION_ACTION);
    expect(hidden(html, "original")).toEqual([""]);
    expect(hidden(html, "kind")).toEqual(["defect"]);
    expect(hidden(html, "confirmed")).toEqual(["true"]);
    expect(hidden(html, "codes")).toEqual([]);
    expect(html).toContain("Choose a code");
    expect(html).toContain("No code yet: Steri-AI records it as a new label for you to map.");
    // Never while adding: the link leaves the page, and the unsaved shortform with it.
    expect(html).not.toContain("Add a Code");
    expect(html).not.toContain("Delete Shortform");
    // The fields in order: Shortform, Type, Defect Codes, Meaning, Confirmed.
    const order = ["Shortform</label>", "Type</legend>", "Defect Codes</legend>", "Meaning</label>", "Confirmed by an Inspector"].map(
      (text) => html.indexOf(text),
    );
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("edits a defect: sends the version it opened and each code, and lists the codes chosen with a remove button", () => {
    const html = draw("IB");
    expect(html).toContain("Edit Shortform");
    expect(html).toContain("Steri-AI uses changes from the next form it reads.");
    expect(JSON.parse(hidden(html, "original")[0])).toEqual(ENTRIES[0]);
    expect(hidden(html, "codes")).toEqual(["bead_defective", "bead_old"]);
    expect(html).toContain('aria-label="Remove bead_defective"');
    // An inactive code it links stays, with its badge; it can be removed, not added again.
    expect(html).toContain('aria-label="Remove bead_old"');
    expect(html).toContain("Inactive Code");
    expect(html).toContain("Add Another Code");
    expect(html).toContain("Delete Shortform");
    expect(html).toContain("Steri-AI stops using it from the next form it reads.");
  });

  it("offers to add a code for a saved defect without one, named after its meaning", () => {
    const html = draw("SKV");
    expect(html).toContain("No code yet: Steri-AI records it as a new label for you to map.");
    expect(html).toContain('href="/admin/defects?add=skin_visual_2&amp;name=Skin+Visual"');
    expect(hidden(html, "confirmed")).toEqual(["false"]);
  });

  it("sends no code for an other term, and hides the picker", () => {
    const html = draw("WTT");
    expect(hidden(html, "kind")).toEqual(["term"]);
    expect(hidden(html, "codes")).toEqual([]);
    expect(html).not.toContain("Defect Codes");
    expect(html).toMatch(/<button[^>]*role="radio"[^>]*aria-checked="true"[^>]*value="term"/);
  });

  it("takes no fourth code: the picker's button goes at three", () => {
    const html = draw("TA");
    expect(hidden(html, "codes")).toHaveLength(3);
    expect(html).not.toContain("Add Another Code");
    expect(html).not.toContain("Choose a code");
  });
});
