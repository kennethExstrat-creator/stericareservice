import { describe, expect, it } from "vitest";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import { SECTIONS, sectionLabel } from "./sections";

describe("the /design index", () => {
  it.each(SECTIONS.map((section) => section.label))("names %j in Title Case (docs/DESIGN.md, Capitalisation)", (label) => {
    expect(lowerCaseWords(label)).toEqual([]);
  });

  it("heads each section with its name in the index", () => {
    expect(sectionLabel("colours")).toBe("Colour Tokens");
    expect(sectionLabel("pills")).toBe("Results and Saving");
    expect(SECTIONS.map(({ id }) => sectionLabel(id))).toEqual(SECTIONS.map(({ label }) => label));
  });
});
