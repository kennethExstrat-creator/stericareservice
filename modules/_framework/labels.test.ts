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
});
