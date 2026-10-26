import { describe, expect, it } from "vitest";
import { GLOVE_COLOURS, listedColour } from "./colours";

describe("Glove Colour's list (Kenneth, 26 October 2026)", () => {
  it("names each colour once, each with a dot to show", () => {
    const names = GLOVE_COLOURS.map((colour) => colour.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("Pink");
    for (const colour of GLOVE_COLOURS) expect(colour.swatch).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("finds a saved name whatever its case or spaces, and nothing for one not listed", () => {
    expect(listedColour("pink")?.name).toBe("Pink");
    expect(listedColour("  LIGHT blue ")?.name).toBe("Light Blue");
    expect(listedColour("Cobalt")).toBeNull();
    expect(listedColour(null)).toBeNull();
  });
});
