import { describe, expect, it } from "vitest";
import {
  DEFAULT_GLOSSARY,
  GlossaryEntrySchema,
  GlossarySchema,
  StoredGlossarySchema,
  sameShortform,
  upgradeGlossary,
  type GlossaryEntry,
} from "./ai-settings";

const entry = (overrides: Partial<GlossaryEntry> = {}): GlossaryEntry => ({
  short: "BF",
  meaning: "Between Finger: watertight hole between the fingers",
  confirmed: true,
  kind: "defect",
  codes: ["hole_crotch"],
  ...overrides,
});

/** The first message for each path, as the forms show them. */
function messages(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return Object.fromEntries((result.error?.issues ?? []).map((issue) => [issue.path.join("."), issue.message]));
}

describe("GlossaryEntrySchema", () => {
  it("takes a defect with up to three codes, and an other term with none", () => {
    expect(GlossaryEntrySchema.parse(entry({ short: " IB ", codes: ["bead_defective", "bead_poor"] }))).toMatchObject({
      short: "IB",
      codes: ["bead_defective", "bead_poor"],
    });
    expect(GlossaryEntrySchema.parse(entry({ kind: "defect", codes: [] })).codes).toEqual([]);
    expect(GlossaryEntrySchema.safeParse(entry({ short: "WTT", meaning: "Watertight test", kind: "term", codes: [] })).success).toBe(true);
  });

  it("names what is wrong under its field", () => {
    expect(messages(GlossaryEntrySchema.safeParse(entry({ short: " ", meaning: "" })))).toEqual({
      short: "Enter the shortform.",
      meaning: "Enter what it means.",
    });
    expect(messages(GlossaryEntrySchema.safeParse(entry({ codes: ["a", "b", "c", "d"] })))).toEqual({
      codes: "Choose up to 3 codes.",
    });
    expect(messages(GlossaryEntrySchema.safeParse(entry({ kind: "term", codes: ["hole_crotch"] })))).toEqual({
      codes: "Other terms have no defect code.",
    });
    expect(messages(GlossaryEntrySchema.safeParse(entry({ codes: ["stain", "stain"] })))).toEqual({
      codes: "Choose each code once.",
    });
  });

  it("takes only codes in the defect_codes shape, and only a known kind", () => {
    expect(GlossaryEntrySchema.safeParse(entry({ codes: ["Hole Crotch"] })).success).toBe(false);
    expect(GlossaryEntrySchema.safeParse(entry({ codes: ["9_lives"] })).success).toBe(false);
    expect(GlossaryEntrySchema.safeParse({ ...entry(), kind: "test" }).success).toBe(false);
    expect(GlossaryEntrySchema.safeParse({ short: "BF", meaning: "Between Finger", confirmed: true }).success).toBe(false);
  });
});

describe("GlossarySchema", () => {
  it("refuses a shortform twice, ignoring case, and more than 200", () => {
    expect(messages(GlossarySchema.safeParse([entry(), entry({ short: "FT" }), entry({ short: "bf" })]))).toEqual({
      "2.short": "“bf” is in the list twice.",
    });
    const many = Array.from({ length: 201 }, (_, index) => entry({ short: `S${index}` }));
    expect(messages(GlossarySchema.safeParse(many))).toEqual({ "": "Keep the list to 200 shortforms." });
  });

  it("holds the starting list: unique, valid, a term never with a code", () => {
    expect(GlossarySchema.safeParse(DEFAULT_GLOSSARY).success).toBe(true);
    const byShort = new Map(DEFAULT_GLOSSARY.map((item) => [item.short, item]));
    expect(byShort.get("BF")).toMatchObject({ kind: "defect", codes: ["hole_crotch"], confirmed: true });
    expect(byShort.get("IB")?.codes).toEqual(["bead_defective", "bead_poor"]);
    // Codes of their own since 12 October 2026 (Kenneth: "yes").
    expect(byShort.get("SKV")?.codes).toEqual(["skin_visual"]);
    expect(byShort.get("FM")?.codes).toEqual(["flow_mark"]);
    expect(byShort.get("FS")).toMatchObject({ codes: ["hole_finger"], confirmed: false });
    expect(DEFAULT_GLOSSARY.filter((item) => item.kind === "term").map((item) => item.short)).toEqual([
      "TG32",
      "BK",
      "WTT",
      "FAB",
      "PF",
      "EG",
    ]);
    // Meanings no longer quote a template's wording.
    expect(DEFAULT_GLOSSARY.some((item) => item.meaning.includes("(template:"))).toBe(false);
  });
});

describe("sameShortform", () => {
  it("ignores case and spaces at the ends", () => {
    expect(sameShortform("BF", " bf")).toBe(true);
    expect(sameShortform("BF", "FB")).toBe(false);
  });
});

describe("upgradeGlossary", () => {
  /** A list as saved before 13 October 2026: no kind, no codes. */
  const legacy = [
    { short: "bf", meaning: "Between Finger: watertight hole between the fingers (template: Between fingers)", confirmed: true },
    { short: "IB", meaning: "Improper Beading", confirmed: false },
    { short: "WTT", meaning: "Watertight test", confirmed: true },
    { short: "PH", meaning: "Pinhole", confirmed: true },
  ];

  it("takes kind and codes from the starting list's entry with the same shortform, keeping its own meaning and confirmation", () => {
    const { entries, legacy: wasLegacy } = upgradeGlossary(StoredGlossarySchema.parse(legacy));
    expect(wasLegacy).toBe(true);
    expect(entries).toEqual([
      {
        short: "bf",
        meaning: "Between Finger: watertight hole between the fingers (template: Between fingers)",
        confirmed: true,
        kind: "defect",
        codes: ["hole_crotch"],
      },
      // One code for each case the meaning names.
      { short: "IB", meaning: "Improper Beading", confirmed: false, kind: "defect", codes: ["bead_defective", "bead_poor"] },
      { short: "WTT", meaning: "Watertight test", confirmed: true, kind: "term", codes: [] },
      // Not in the starting list: a defect with no code yet.
      { short: "PH", meaning: "Pinhole", confirmed: true, kind: "defect", codes: [] },
    ]);
    // What comes out is a valid list in today's shape.
    expect(GlossarySchema.safeParse(entries).success).toBe(true);
  });

  it("keeps a list in today's shape as it is, and says it is not legacy", () => {
    const saved = [entry({ codes: [] }), entry({ short: "TG32", meaning: "A factory", kind: "term", codes: [] })];
    expect(upgradeGlossary(StoredGlossarySchema.parse(saved))).toEqual({ entries: saved, legacy: false });
  });

  it("upgrades only the entries saved without a kind", () => {
    const mixed = StoredGlossarySchema.parse([entry({ short: "BF", codes: [] }), { short: "FT", meaning: "Finger Tip", confirmed: true }]);
    const { entries, legacy: wasLegacy } = upgradeGlossary(mixed);
    expect(wasLegacy).toBe(true);
    // BF was saved with no code on purpose: it stays so.
    expect(entries.map((item) => [item.short, item.codes])).toEqual([
      ["BF", []],
      ["FT", ["hole_finger"]],
    ]);
  });

  it("refuses a saved list that repeats a shortform or breaks an entry's rules", () => {
    expect(StoredGlossarySchema.safeParse([...legacy, { short: "WTT", meaning: "Again", confirmed: true }]).success).toBe(false);
    expect(StoredGlossarySchema.safeParse([{ ...entry(), kind: "term" }]).success).toBe(false);
  });
});
