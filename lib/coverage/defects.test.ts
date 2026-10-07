import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defectCodesUsed, SAFEDON_DISPENSING_DEFECTS, VISUAL_DEFECTS, WATERTIGHT_LOCATIONS, type DefectLabel } from "./defects";
import { DEFECT_CLASSES } from "./keys";
import { TEMPLATE_CODES } from "./types";

/** defect_codes rows of supabase/seed.sql: code to description. */
function seedDefectCodes(): Map<string, string> {
  const sql = readFileSync(new URL("../../supabase/seed.sql", import.meta.url), "utf8");
  const insert = sql.slice(sql.indexOf("insert into public.defect_codes"));
  const rows = new Map<string, string>();
  for (const match of insert.matchAll(/\('([a-z][a-z0-9_]*)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)'\)/g)) {
    rows.set(match[1], match[3].replaceAll("''", "'"));
  }
  return rows;
}

const SEED = seedDefectCodes();

/** Case and a trailing ' :' do not matter when matching a label to the seed's description. */
const normalise = (label: string) => label.toLowerCase().replace(/\s*:\s*$/, "");

/** The quoted labels in a seed description. */
function seedLabels(code: string): string[] {
  return [...(SEED.get(code) ?? "").matchAll(/"([^"]+)"/g)].map((match) => normalise(match[1]));
}

/** The printed typos, as whole words ("ould" must not match "could"). */
const TYPOS = [/\bEmbeded\b/, /\bThin batch\b/, /\bsickiness\b/, /\bideallly\b/, /\bould\b/];

describe("seed.sql", () => {
  it("parses the 32 defect codes of BUILD_SPEC 11", () => {
    expect(SEED.size).toBe(32);
  });

  it("holds every defect code a template uses, and every seeded code is used", () => {
    const used = defectCodesUsed();
    for (const code of used) expect(SEED.has(code), code).toBe(true);
    expect([...SEED.keys()].sort()).toEqual([...used].sort());
  });
});

describe("visual defect lists", () => {
  it("maps every report label to a code whose seed description quotes it", () => {
    for (const template of ["STD_EG", "SAFEDON_EG"] as const) {
      for (const cls of DEFECT_CLASSES) {
        for (const { code, label } of VISUAL_DEFECTS[template][cls]) {
          expect(seedLabels(code), `${template} ${cls} ${label}`).toContain(normalise(label));
        }
      }
    }
  });

  it("lists each code once per class", () => {
    for (const template of TEMPLATE_CODES) {
      for (const cls of DEFECT_CLASSES) {
        const codes = VISUAL_DEFECTS[template][cls].map((defect) => defect.code);
        expect(new Set(codes).size, `${template} ${cls}`).toBe(codes.length);
      }
    }
  });

  // The report's words in Title Case (Kenneth, 8 October 2026); sources.ts keeps them as printed.
  it("keeps the report order and words of STD_EG", () => {
    const labels = (cls: (typeof DEFECT_CLASSES)[number]) => VISUAL_DEFECTS.STD_EG[cls].map((defect) => defect.label);
    expect(labels("critical")).toEqual(["Embedded Insects", "Embedded Metal Debris"]);
    expect(labels("major")).toEqual([
      "Thin Area Between Fingers (Crotch)",
      "Ring-Shaped Thin Area (Crotch)",
      "Thin Area on Glove Body",
      "Thin Spot on Glove Body",
      "Non-Removable Dirt",
      "Oil Stain",
      "Residue Material / Foreign Matter",
      "Defective Bead",
      "Big Lumps (>2mm)",
    ]);
    expect(labels("minor")).toEqual([
      "Small Dirt / Stain",
      "Sticky Pleats (< 5mm)",
      "Lumps (<2mm)",
      "Poor Beading",
      "Rolled Bead",
      "Defective Beads",
    ]);
  });

  it("keeps the report order and words of SAFEDON_EG", () => {
    const labels = (cls: (typeof DEFECT_CLASSES)[number]) => VISUAL_DEFECTS.SAFEDON_EG[cls].map((defect) => defect.label);
    expect(labels("critical")).toEqual(["Embedded Insects", "Embedded Metal Debris"]);
    expect(labels("major")).toEqual([
      "Thin Ring Between Fingers (Crotch)",
      "Thin Area Between Fingers (Crotch)",
      "Thin Patch / Area (Body)",
      "Thin Spot",
      "Non-Removable Dirt",
      "Stain",
      "Powder Mark",
      "Bead Blister",
    ]);
    expect(labels("minor")).toEqual([
      "Small Dirt / Stain",
      "Sticky Pleats (< 5mm)",
      "Lumps (<2mm)",
      "Thin Bead",
      "Thin Bead / Small Beading Defect",
    ]);
  });

  it("sets severity per template: one code, major as 'Defective Bead', minor as 'Defective Beads' (rule 4.2.4)", () => {
    const find = (cls: (typeof DEFECT_CLASSES)[number]) =>
      VISUAL_DEFECTS.STD_EG[cls].find((defect) => defect.code === "bead_defective");
    expect(find("major")?.label).toBe("Defective Bead");
    expect(find("minor")?.label).toBe("Defective Beads");
    expect(find("critical")).toBeUndefined();
  });

  it("counts 'Oil Stain' and 'Stain' together under one code", () => {
    const stain = (template: "STD_EG" | "SAFEDON_EG") =>
      VISUAL_DEFECTS[template].major.find((defect) => defect.code === "stain")?.label;
    expect(stain("STD_EG")).toBe("Oil Stain");
    expect(stain("SAFEDON_EG")).toBe("Stain");
  });
});

describe("[sic] corrections", () => {
  const all: DefectLabel[] = [
    ...TEMPLATE_CODES.flatMap((template) => DEFECT_CLASSES.flatMap((cls) => VISUAL_DEFECTS[template][cls])),
    ...TEMPLATE_CODES.flatMap((template) => WATERTIGHT_LOCATIONS[template]),
    ...SAFEDON_DISPENSING_DEFECTS,
  ];

  it("fixes 'Embeded' and 'Thin batch' and keeps the printed text", () => {
    const printed = all.filter((defect) => defect.printed !== undefined);
    expect(new Set(printed.map((defect) => `${defect.printed} -> ${defect.label}`))).toEqual(
      new Set([
        "Embeded Insects -> Embedded Insects",
        "Embeded metal debris -> Embedded Metal Debris",
        "Thin batch / area (body) -> Thin Patch / Area (Body)",
      ]),
    );
  });

  it("uses no typo in any label or hint the app shows", () => {
    const shown = [...all.map((defect) => defect.label), ...SAFEDON_DISPENSING_DEFECTS.map((defect) => defect.hint)];
    for (const text of shown) for (const typo of TYPOS) expect(text, text).not.toMatch(typo);
  });
});

describe("watertight locations", () => {
  it("maps every location to a hole code (or glove burst) whose seed description quotes the label", () => {
    for (const template of ["STD_EG", "SAFEDON_EG"] as const) {
      for (const { code, label } of WATERTIGHT_LOCATIONS[template]) {
        expect(code, label).toMatch(/^(hole_|glove_burst$)/);
        expect(seedLabels(code), `${template} ${label}`).toContain(normalise(label));
      }
    }
  });

  it("adds glove burst in SAFEDON_EG only, in the report's order", () => {
    expect(WATERTIGHT_LOCATIONS.STD_EG.map((location) => location.code)).toEqual([
      "hole_crotch",
      "hole_palm",
      "hole_finger",
      "hole_cuff",
      "hole_other",
    ]);
    expect(WATERTIGHT_LOCATIONS.SAFEDON_EG.map((location) => location.code)).toEqual([
      "hole_crotch",
      "hole_palm",
      "hole_cuff",
      "hole_finger",
      "glove_burst",
      "hole_other",
    ]);
  });
});

describe("Safedon dispensing defects", () => {
  it("lists the six defects of the onsite sheet with the app's definitions (onsite/SAFEDON_EG.md)", () => {
    expect(SAFEDON_DISPENSING_DEFECTS.map(({ code, label, hint }) => [code, label, hint])).toEqual([
      ["no_cuff", "No Cuff", "Cuff should ideally be at least 2 cm out"],
      ["finger_out", "Finger Out", "Only the cuff, not a finger, should come out first"],
      ["multiple_out", "Multiple Gloves Out", "Only one glove should come out at a time"],
      ["stuck", "Glove Stuck", "Glove could not be dispensed or was very difficult to dispense"],
      ["sticky", "Sticky Glove", "Two or more gloves out at once because they stick together"],
      ["faulty_cuff", "Faulty Cuff", "Deformed or misshapen cuff causing a dispensing problem"],
    ]);
  });

  it("matches the seed's labels and definitions", () => {
    for (const { code, label, hint } of SAFEDON_DISPENSING_DEFECTS) {
      expect(seedLabels(code), code).toContain(normalise(label));
      expect(SEED.get(code), code).toContain(hint);
    }
  });

  it("keeps the printed definitions and fixes only their typos", () => {
    for (const defect of SAFEDON_DISPENSING_DEFECTS) {
      if (defect.correctedHint === undefined) {
        for (const typo of TYPOS) expect(defect.printedHint).not.toMatch(typo);
      } else {
        expect(TYPOS.some((typo) => typo.test(defect.printedHint)), defect.code).toBe(true);
        for (const typo of TYPOS) expect(defect.correctedHint).not.toMatch(typo);
      }
    }
  });
});
