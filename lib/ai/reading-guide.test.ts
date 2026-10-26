import { describe, expect, it } from "vitest";
import type { GlossaryEntry } from "@/lib/schemas/ai-settings";
import { glossaryText, PAPER_FORM_GUIDE, WEIGHT_GUIDE } from "./reading-guide";

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

describe("the paper form guide", () => {
  it("reads a box number and a carton number as one box/carton number, copied as written (Kenneth, 13 October 2026)", () => {
    const line = PAPER_FORM_GUIDE.split("\n").find((entry) => entry.startsWith("- A box number and a carton number")) ?? "";
    expect(line).toContain("are the same number, a box/carton number");
    expect(line).toContain("the size's sampled cartons (the Finished Goods Sampling Information)");
    expect(line).toContain("Copy each box/carton number as written, even one that is not among the sampled ones");
    expect(PAPER_FORM_GUIDE).toContain("(by size: box/carton number, layering %, dispensing %, stickiness code, others)");
  });

  it("puts each box/carton number a document gives into the size's sampled cartons too, the whole list even where one is held (Kenneth, 14 and 26 October 2026)", () => {
    const lines = PAPER_FORM_GUIDE.split("\n");
    const at = lines.findIndex((entry) => entry.startsWith("- So each box/carton number a document gives for a size's boxes"));
    // Straight after the line that makes a box number and a carton number one number.
    expect(at).toBe(lines.findIndex((entry) => entry.startsWith("- A box number and a carton number")) + 1);
    const line = lines[at];
    expect(line).toContain("(a dispensing or packing result, the labelling boxes, a list of the sampled cartons, a carton's label)");
    expect(line).toContain("also goes into carton_sampling's cartonNumbers for that size, besides its own test's field");
    expect(line).toContain(
      "in the order the document lists them, each number once (the list never repeats a number, though a test may use one carton twice), as written.",
    );
    // A carton sheet read after the dispensing page completes its list (Kenneth, 26 October 2026).
    expect(line).not.toContain("Only while that size's list is empty");
    expect(line).toContain("Give the document's whole list for each size even when that size's list already holds numbers");
    expect(line).toContain("Never pad the list to the cases sampled, never add a number the documents do not state");
    expect(line).toContain("leave out a packing list's carton numbering (the shipment's cartons, not the sample)");
  });

  it("reads a dimension table's Spec row into the inspection's specs, NA included, never a P/F (Kenneth, 26 October 2026)", () => {
    const line = PAPER_FORM_GUIDE.split("\n").find((entry) => entry.startsWith("- A dimension table prints a \"Spec.\" row")) ?? "";
    expect(line).toContain("such as ≥240, ≤80, 80±10, 230-250 or NA (no spec)");
    expect(line).toContain("Put it into dimensions' specOverrides for that size and column");
    expect(line).toContain('(NA is {"kind": "na"})');
    expect(line).toContain("only where it differs from that size's spec in the module settings and the current data has none");
    expect(line).toContain("never from the readings or a result");
    expect(line).toContain("Never write dimensions' manualResults");
  });

  it("reads a packing row marked as an aged sample into the size's aged sample, never into its boxes (Kenneth, 26 October 2026)", () => {
    const lines = PAPER_FORM_GUIDE.split("\n");
    const at = lines.findIndex((entry) => entry.startsWith("- An aged sample is not a box"));
    // With the box/carton number lines, after them.
    expect(at).toBe(lines.findIndex((entry) => entry.startsWith("- So each box/carton number a document gives for a size's boxes")) + 1);
    const line = lines[at];
    expect(line).toContain('a dispensing or packing row marked as one (a remark such as "Aged sample" or "aged" in Others, usually with no box/carton number)');
    expect(line).toContain("goes into that size's agedSample in dispensing_packing");
    expect(line).toContain("(its layering %, dispensing %, stickiness code, and the remark as its note), never into its boxes.");
    expect(line).toContain("Each size has at most one aged sample.");
  });
});

describe("the sampling plan's inner boxes (Kenneth, 27 October 2026)", () => {
  it("reads the form's Sampling Plan inner boxes as those sampled in all, not per case", () => {
    const line = PAPER_FORM_GUIDE.split("\n").find((entry) => entry.startsWith("- One form per purchase order and lot")) ?? "";
    expect(line).toContain('"Sampling Plan" (cases, inner boxes and gloves sampled, the inner boxes in all, not per case; gloves for watertight (WTT) and visual;');
  });
});

describe("the sampling plan's counts and the weight (Kenneth, 26 October 2026)", () => {
  it("never fills the sampling plan's glovesWeight: the app has no such row", () => {
    const line = PAPER_FORM_GUIDE.split("\n").find((entry) => entry.startsWith("- Each test has its own count")) ?? "";
    expect(line).toContain("never copy one test's count into another's");
    expect(line).toContain("Never fill the sampling plan's glovesWeight: the app has no gloves-for-weight row");
    expect(line).not.toContain("its own n");
  });

  it("reads one value per size, the average weight a dimension sheet prints, and never works it out", () => {
    const [heading, average, never] = WEIGHT_GUIDE.split("\n");
    expect(heading).toBe('How to read the glove weight ("weight"):');
    expect(average).toContain("Per size, one value: the size's average weight in g as a document prints it");
    expect(average).toContain('the "Weight (g)" row or column of a dimension sheet');
    expect(average).toContain('as that size\'s "values": [3.4]');
    expect(average).toContain("its P/F or remark (\"Info only\") are not data: leave them out");
    expect(never).toContain("a document that lists each glove's weight without the size's average gives nothing for weight");
  });
});

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
