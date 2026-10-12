import { describe, expect, it } from "vitest";
import type { GlossaryEntry } from "@/lib/schemas/ai-settings";
import { glossaryText } from "./reading-guide";

const defect = (short: string, meaning: string, codes: string[], confirmed = true): GlossaryEntry => ({
  short,
  meaning,
  confirmed,
  kind: "defect",
  codes,
});
const term = (short: string, meaning: string, confirmed = true): GlossaryEntry => ({ short, meaning, confirmed, kind: "term", codes: [] });

/** The active defect codes, as source-reader.ts passes them. */
const LIBRARY = [
  { code: "hole_crotch", name: "Hole between fingers (crotch)" },
  { code: "hole_finger", name: "Hole in finger" },
  { code: "bead_defective", name: "Defective bead" },
  { code: "bead_poor", name: "Poor beading" },
];

const GLOSSARY = [
  defect("BF", "Between Finger: watertight hole between the fingers", ["hole_crotch"]),
  defect("IB", "Improper Beading: Defective Bead when major, Poor Beading when minor", ["bead_defective", "bead_poor"]),
  defect("SKV", "Skin Visual: a visual defect of the glove skin", []),
  defect("FS", "Seen on a watertight row: probably SF (Side Finger) written the other way round.", ["hole_finger"], false),
  term("WTT", "Watertight test"),
  term("TG32", "A manufacturer's factory code as written", false),
];

describe("glossaryText", () => {
  it("lists each defect with its codes and their library names, then the other words", () => {
    expect(glossaryText(GLOSSARY, LIBRARY)).toBe(
      [
        `Shortforms some inspectors write (examples, not a standard). A defect's codes are SteriCare defect library codes: count it under that code when the template lists it, else put it under "unmapped" with the code's library name.`,
        "- BF: Between Finger: watertight hole between the fingers. Code: hole_crotch (Hole between fingers (crotch)).",
        "- IB: Improper Beading: Defective Bead when major, Poor Beading when minor. Codes: bead_defective (Defective bead), bead_poor (Poor beading).",
        "- SKV: Skin Visual: a visual defect of the glove skin. No code yet.",
        "- FS: Seen on a watertight row: probably SF (Side Finger) written the other way round. Code: hole_finger (Hole in finger). A guess, not confirmed by an inspector yet.",
        "",
        "Other words inspectors write (not defects):",
        "- WTT: Watertight test.",
        "- TG32: A manufacturer's factory code as written. A guess, not confirmed by an inspector yet.",
      ].join("\n"),
    );
  });

  it("gives a code without a name when the active library lacks it, or no library is passed", () => {
    const inactive = [defect("Stain", "Oil Stain when major", ["stain", "hole_finger"])];
    expect(glossaryText(inactive, LIBRARY)).toContain("- Stain: Oil Stain when major. Codes: stain, hole_finger (Hole in finger).");
    // The order-document reader passes no library.
    expect(glossaryText(GLOSSARY)).toContain("- BF: Between Finger: watertight hole between the fingers. Code: hole_crotch.");
  });

  it("adds a full stop only when the meaning has none", () => {
    expect(glossaryText([term("PF", "Powder free.")])).toBe("Other words inspectors write (not defects):\n- PF: Powder free.");
    expect(glossaryText([term("EG", "Examination gloves?")])).toContain("- EG: Examination gloves?");
  });

  it("keeps each shortform on one line when its meaning was typed over several", () => {
    expect(glossaryText([defect("IB", "Improper Beading:\nDefective Bead when major,\r\n  Poor Beading when minor.\n", ["bead_poor"])], LIBRARY)).toContain(
      "\n- IB: Improper Beading: Defective Bead when major, Poor Beading when minor. Code: bead_poor (Poor beading).",
    );
  });

  it("leaves out a block with nothing in it, and gives nothing for an empty list", () => {
    expect(glossaryText([])).toBe("");
    expect(glossaryText([defect("BF", "Between Finger", ["hole_crotch"])], LIBRARY)).not.toContain("Other words");
  });
});
