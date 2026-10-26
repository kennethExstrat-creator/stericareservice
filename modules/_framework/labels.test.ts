import { describe, expect, it } from "vitest";
import { effectiveLabels, labelFor } from "./labels";

const LABELS = {
  thin_spot: "Thin spot on glove body",
  bead_defective: "Defective bead",
  "minor.bead_defective": "Defective beads",
  "carton.lot_no": " ",
};

describe("labelFor", () => {
  it("reads the most specific key first: one defect worded per class (BUILD_SPEC 4.2 rule 4)", () => {
    expect(labelFor(LABELS, "minor", "bead_defective")).toBe("Defective beads");
    expect(labelFor(LABELS, "major", "bead_defective")).toBe("Defective bead");
    expect(labelFor(LABELS, "thin_spot")).toBe("Thin spot on glove body");
  });

  it("shows the key itself when no label is set or the label is blank, never undefined", () => {
    expect(labelFor(LABELS, "minor", "dirt_small")).toBe("dirt_small");
    expect(labelFor(LABELS, "carton", "lot_no")).toBe("lot_no");
    expect(labelFor(LABELS)).toBe("");
  });
});

describe("effectiveLabels", () => {
  it("keeps the template's wording and fills keys it lacks from the module's defaults", () => {
    const definition = { labels: { colour: "Glove colour", length: "Glove length" } };
    // Resolved before the module had a `length` label.
    const resolved = { labels: { colour: "Colour of glove" } };
    expect(effectiveLabels(definition, resolved)).toEqual({ colour: "Colour of glove", length: "Glove length" });
  });

  it("lays what a module words itself over the template's wording (shownLabels, 6.2 rule 11)", () => {
    const definition = {
      labels: { cases: "# of Case", gloves: "# of Gloves" },
      shownLabels: (labels: Readonly<Record<string, string>>) => ({ ...labels, cases: "# of Case" }),
    };
    // A template version saved before the module's own wording keeps it for the rest.
    expect(effectiveLabels(definition, { labels: { cases: "Case", gloves: "Gloves" } })).toEqual({ cases: "# of Case", gloves: "Gloves" });
  });

  it("keeps the template's labels, every one, when the hook throws or leaves some out", () => {
    const resolved = { labels: { cases: "Case", gloves: "Gloves" } };
    const throws = {
      labels: {},
      shownLabels: (): Readonly<Record<string, string>> => {
        throw new Error("broken");
      },
    };
    expect(effectiveLabels(throws, resolved)).toEqual({ cases: "Case", gloves: "Gloves" });
    const partial = { labels: {}, shownLabels: () => ({ cases: "# of Case" }) };
    expect(effectiveLabels(partial, resolved)).toEqual({ cases: "# of Case", gloves: "Gloves" });
  });
});
