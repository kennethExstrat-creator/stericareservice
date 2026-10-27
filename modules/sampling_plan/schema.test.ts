import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  dataKeys,
  defaultConfig,
  defaultLabels,
  labelOverrides,
  mergeConfig,
  moduleConfig,
  SAMPLING_COLUMNS as DICTIONARY_COLUMNS,
  seedConfig,
  TEMPLATE_CODES,
  TEMPLATES,
  type ConfigObject,
  type TemplateCode,
} from "@/lib/coverage";
import { applyProposals } from "@/lib/inspections/source-documents";
import type { InspectionData } from "@/modules/_framework";
import { MODULE_REGISTRY } from "@/modules/registry";
import { resolveSeed } from "./__fixtures__/seeds";
import {
  columnGroups,
  SAMPLING_COLUMNS,
  SAMPLING_PLAN_DEFAULT_CONFIG,
  SAMPLING_PLAN_LABELS,
  SamplingPlanConfigSchema,
  shownColumns,
  type SamplingPlanConfig,
} from "./config";
import {
  autoSamplingReplaces,
  CODE_LETTER_REASON_MAX,
  codeLetterReason,
  emptySamplingPlan,
  emptySamplingSize,
  samplingSettings,
  SamplingPlanDataSchema,
  watertightVisualFollows,
  withCodeLetterStep,
  withCount,
  withRowOff,
  withSamplingSettings,
  withWorkedInnerUnits,
  type AutoSampling,
  type SamplingPlanData,
  type SamplingSize,
} from "./schema";

const FILLED_M = {
  cases: 50,
  innerUnitsPerCase: null,
  innerUnits: 50,
  gloves: 500,
  codeLetter: null,
  codeLetterReason: null,
  glovesWatertightVisual: 500,
  glovesDimensions: 13,
  glovesPhysical: 13,
  glovesWeight: 13,
  innerUnitsDispensing: 13,
  pouches: null,
  pouchesDyeLeak: null,
};

describe("sampling_plan data", () => {
  it("reads a size saved before # Gloves for Weight existed as empty there, everything else kept; one that has it still loads", () => {
    const saved = Object.fromEntries(Object.entries(FILLED_M).filter(([column]) => column !== "glovesWeight"));
    expect(SamplingPlanDataSchema.parse({ sizes: { M: saved } }).sizes.M).toEqual({ ...FILLED_M, glovesWeight: null });
    // Saved from 12 to 26 October 2026, while the row was shown: kept, unused.
    expect(SamplingPlanDataSchema.parse({ sizes: { M: FILLED_M } }).sizes.M.glovesWeight).toBe(13);
  });

  it("starts empty and accepts a draft with anything missing, per size", () => {
    expect(emptySamplingPlan()).toEqual({ sizes: {} });
    expect(emptySamplingSize()).toEqual({
      ...Object.fromEntries(SAMPLING_COLUMNS.map((column) => [column, null])),
      innerUnitsPerCase: null,
      codeLetter: null,
      codeLetterReason: null,
    });
    expect(SamplingPlanDataSchema.parse({ sizes: { M: { cases: 50 } } })).toEqual({
      sizes: { M: { ...emptySamplingSize(), cases: 50 } },
    });
    expect(SamplingPlanDataSchema.parse({ sizes: { M: FILLED_M, "7.0": { pouches: 4 } } }).sizes).toEqual({
      M: FILLED_M,
      "7.0": { ...emptySamplingSize(), pouches: 4 },
    });
  });

  it("stores counts as whole numbers from 0, never as text or dates (6.2 rules 1 and 3)", () => {
    for (const bad of ["50", "5 0", "2025-01-01", 1.5, -1, Number.NaN]) {
      expect(SamplingPlanDataSchema.safeParse({ sizes: { M: { cases: bad } } }).success, String(bad)).toBe(false);
    }
    expect(SamplingPlanDataSchema.parse({ sizes: { M: { glovesWatertightVisual: 0 } } }).sizes.M.glovesWatertightVisual).toBe(0);
  });

  it("keeps computed values out of the data: plans, the lot's letter and totals are calculated (6.2 rule 2)", () => {
    for (const key of ["planSampleSize", "lotSizeGloves", "orderQty", "putBack", "codeLetterReduced", "reducedFrom"]) {
      expect(SamplingPlanDataSchema.safeParse({ sizes: { M: { [key]: 1 } } }).success, key).toBe(false);
    }
    expect(SamplingPlanDataSchema.safeParse({ sizes: {}, totals: { cases: 50 } }).success).toBe(false);
  });

  it("keeps each size's keys as the data dictionary lists them, entered", () => {
    expect(Object.keys(emptySamplingSize()).sort()).toEqual([...dataKeys("sampling_plan", "entered")].sort());
  });

  it("rejects keys it does not have, the context's names and the reserved comment included", () => {
    expect(SamplingPlanDataSchema.safeParse({ sizes: { M: { watertightVisual: 500 } } }).success).toBe(false);
    expect(SamplingPlanDataSchema.safeParse({ sizes: { M: { case: 5 } } }).success).toBe(false);
    expect(SamplingPlanDataSchema.safeParse({ sizes: {}, comment: "x" }).success).toBe(false);
  });

  it("sets one count of one size and keeps every other size, one no longer ordered included (6.2 rule 4)", () => {
    const saved = withCount(emptySamplingPlan(), "XS", "cases", 5);
    const next = withCount(saved, "M", "glovesWatertightVisual", 500);
    expect(next.sizes).toEqual({
      XS: { ...emptySamplingSize(), cases: 5 },
      M: { ...emptySamplingSize(), glovesWatertightVisual: 500 },
    });
    expect(saved.sizes).toEqual({ XS: { ...emptySamplingSize(), cases: 5 } });
    expect(SamplingPlanDataSchema.parse(next)).toEqual(next);
    // Nothing to change: the same data, so the screen saves nothing.
    expect(withCount(next, "M", "glovesWatertightVisual", 500)).toBe(next);
    expect(withCount(next, "L", "cases", null)).toBe(next);
    expect(withCount(next, "XS", "cases", null).sizes.XS.cases).toBeNull();
  });
});

describe("sampling_plan Sampling Settings (Kenneth, 27 October 2026)", () => {
  it("reads data saved before the settings as the default level and no rounding", () => {
    const saved = SamplingPlanDataSchema.parse({ sizes: { M: FILLED_M }, rowsOff: ["glovesDimensions"] });
    expect(saved).not.toHaveProperty("inspectionLevel");
    expect(saved).not.toHaveProperty("roundCasesTo");
    expect(samplingSettings(saved)).toEqual({ inspectionLevel: null, roundCases: false });
    expect(emptySamplingPlan()).toEqual({ sizes: {} });
  });

  it("keeps an ISO 2859-1 level and the rounding, for the whole inspection, nothing else", () => {
    expect(SamplingPlanDataSchema.parse({ sizes: {}, inspectionLevel: "S-3", roundCasesTo: 5 })).toEqual({
      sizes: {},
      inspectionLevel: "S-3",
      roundCasesTo: 5,
    });
    for (const bad of ["IV", "ii", "", null, 2]) {
      expect(SamplingPlanDataSchema.safeParse({ sizes: {}, inspectionLevel: bad }).success, String(bad)).toBe(false);
    }
    for (const bad of [0, 1, 2, 20, "5", null]) {
      expect(SamplingPlanDataSchema.safeParse({ sizes: {}, roundCasesTo: bad }).success, String(bad)).toBe(false);
    }
    expect(SamplingPlanDataSchema.safeParse({ sizes: { M: { inspectionLevel: "II" } } }).success).toBe(false);
  });

  it("saves the settings beside the counts, the rounding switched on as 5, and takes them back out; the same data when nothing changes", () => {
    const data = withCount(emptySamplingPlan(), "M", "cases", 50);
    const set = withSamplingSettings(data, { inspectionLevel: "II", roundCases: true });
    expect(set).toEqual({ sizes: data.sizes, inspectionLevel: "II", roundCasesTo: 5 });
    expect(SamplingPlanDataSchema.parse(set)).toEqual(set);
    expect(withSamplingSettings(set, { inspectionLevel: "II", roundCases: true })).toBe(set);
    // Use Default, and the rounding switched off: back to the data without them.
    const cleared = withSamplingSettings(set, { inspectionLevel: null, roundCases: false });
    expect(cleared).toEqual(data);
    expect(cleared).not.toHaveProperty("inspectionLevel");
    expect(withSamplingSettings(set, { inspectionLevel: "S-1", roundCases: true })).toEqual({ ...set, inspectionLevel: "S-1" });
  });

  it("reads a rounding to 10 saved before the one switch (Kenneth, 27 October 2026: \"not either 5 or 10\") as switched on", () => {
    const saved = SamplingPlanDataSchema.parse({ sizes: {}, roundCasesTo: 10 });
    expect(saved.roundCasesTo).toBe(10);
    expect(samplingSettings(saved)).toEqual({ inspectionLevel: null, roundCases: true });
    // Left on, nothing changes; switched off, it goes; saved again on, it is 5.
    expect(withSamplingSettings(saved, { inspectionLevel: null, roundCases: true })).toBe(saved);
    expect(withSamplingSettings(saved, { inspectionLevel: null, roundCases: false })).toEqual({ sizes: {} });
    expect(withSamplingSettings(saved, { inspectionLevel: "II", roundCases: true })).toEqual({ sizes: {}, inspectionLevel: "II", roundCasesTo: 5 });
  });

  it("tells Steri-AI to take the level only from a document that states it, never to work it out, and never the rounding", () => {
    const schema = z.toJSONSchema(SamplingPlanDataSchema, { io: "input" }) as {
      properties: Record<string, { description?: string }>;
      required?: string[];
    };
    expect(schema.properties.inspectionLevel.description).toContain('"General Inspection Level II"');
    expect(schema.properties.inspectionLevel.description).toContain("never work it out from code letters");
    expect(schema.properties.roundCasesTo.description).toContain("Never set from a document");
    expect(schema.required ?? []).not.toContain("inspectionLevel");
  });

  it("takes a level a document states only where the inspection has none, as every reading fills (applyProposals)", () => {
    const included = new Set(["sampling_plan"]);
    const proposal = { sampling_plan: { inspectionLevel: "II" } };
    const empty: InspectionData = { modules: { sampling_plan: { sizes: {} } }, custom: {} };
    const filled = applyProposals(empty, proposal, MODULE_REGISTRY, included);
    expect(filled.filled).toBe(1);
    expect(filled.data.modules.sampling_plan).toEqual({ sizes: {}, inspectionLevel: "II" });
    const own: InspectionData = { modules: { sampling_plan: { sizes: {}, inspectionLevel: "S-4" } }, custom: {} };
    expect(applyProposals(own, proposal, MODULE_REGISTRY, included)).toMatchObject({ filled: 0, data: own });
  });
});

describe("sampling_plan inner boxes per case (Kenneth, 27 October 2026)", () => {
  it("reads data saved before the inner boxes per case as without them, the total kept as entered", () => {
    const saved = SamplingPlanDataSchema.parse({ sizes: { M: { cases: 16, innerUnits: 16, gloves: 315 } } });
    expect(saved.sizes.M).toMatchObject({ cases: 16, innerUnitsPerCase: null, innerUnits: 16, gloves: 315 });
  });

  it("takes a whole number of inner boxes per case from 1, never 0, text or a fraction", () => {
    for (const bad of [0, -1, 1.5, "2", Number.NaN]) {
      expect(SamplingPlanDataSchema.safeParse({ sizes: { M: { innerUnitsPerCase: bad } } }).success, String(bad)).toBe(false);
    }
    expect(SamplingPlanDataSchema.parse({ sizes: { M: { innerUnitsPerCase: 1 } } }).sizes.M.innerUnitsPerCase).toBe(1);
    expect(SamplingPlanDataSchema.parse({ sizes: { M: { innerUnitsPerCase: null } } }).sizes.M.innerUnitsPerCase).toBeNull();
  });

  it("writes # of Case × the inner boxes per case into the total, and again whenever the cases change", () => {
    const cases = withCount(emptySamplingPlan(), "S", "cases", 16);
    const perCase = withCount(cases, "S", "innerUnitsPerCase", 1);
    expect(perCase.sizes.S).toMatchObject({ cases: 16, innerUnitsPerCase: 1, innerUnits: 16 });
    // Typed again, or written by Auto Calculate Sampling through the same update.
    expect(withCount(perCase, "S", "cases", 25).sizes.S).toMatchObject({ cases: 25, innerUnits: 25 });
    expect(withCount(perCase, "S", "innerUnitsPerCase", 2).sizes.S).toMatchObject({ cases: 16, innerUnits: 32 });
    // No cases: no total to work out yet.
    expect(withCount(perCase, "S", "cases", null).sizes.S).toMatchObject({ cases: null, innerUnits: null });
    // Another count leaves the total as it is.
    expect(withCount(perCase, "S", "gloves", 315).sizes.S).toMatchObject({ innerUnits: 16, gloves: 315 });
  });

  it("keeps a total typed without the inner boxes per case, and keeps the worked total once they are emptied, to be typed again", () => {
    const typed = withCount(withCount(emptySamplingPlan(), "M", "cases", 50), "M", "innerUnits", 60);
    expect(withCount(typed, "M", "cases", 40).sizes.M).toMatchObject({ cases: 40, innerUnitsPerCase: null, innerUnits: 60 });
    const worked = withCount(typed, "M", "innerUnitsPerCase", 2);
    expect(worked.sizes.M.innerUnits).toBe(100);
    expect(withCount(worked, "M", "innerUnitsPerCase", null).sizes.M).toMatchObject({ innerUnitsPerCase: null, innerUnits: 100 });
  });

  it("works out an empty total from the cases and the inner boxes per case, as a reading fills them; an entered total stays", () => {
    const read = SamplingPlanDataSchema.parse({
      sizes: { S: { cases: 16, innerUnitsPerCase: 1 }, M: { cases: 35, innerUnitsPerCase: 2, innerUnits: 60 }, L: { cases: 17 } },
    });
    const worked = withWorkedInnerUnits(read);
    expect(worked.sizes.S.innerUnits).toBe(16);
    expect(worked.sizes.M.innerUnits).toBe(60);
    expect(worked.sizes.L.innerUnits).toBeNull();
    // Nothing to work out: the same data.
    expect(withWorkedInnerUnits(worked)).toBe(worked);
  });
});

/** Sizes S and M with a letter, gloves and inner boxes, as Auto Calculate Sampling leaves them; S's lot is code N. */
function lettered(rows: Record<string, Partial<SamplingSize>> = {}): SamplingPlanData {
  const base: Partial<SamplingSize> = { cases: 25, innerUnitsPerCase: 1, innerUnits: 25, gloves: 500, codeLetter: "N", glovesWatertightVisual: 500 };
  return {
    sizes: {
      S: { ...emptySamplingSize(), ...base, ...rows.S },
      M: { ...emptySamplingSize(), ...base, cases: 20, innerUnits: 20, ...rows.M },
    },
  };
}

/** Size S's lot: 5,800,000 gloves (STD_EG's 2,900 cases of 2,000), code N at level I. */
const LOT_N = { lot: 5_800_000, lotLetter: "N" as const };
const REASON = "Consistent high-quality factory";

describe("sampling_plan code letter (Kenneth, 27 October 2026)", () => {
  it("reads data saved before the code letter as without one, and without a reason", () => {
    const saved = SamplingPlanDataSchema.parse({ sizes: { M: { cases: 16, innerUnits: 16, gloves: 315 } } });
    expect(saved.sizes.M).toMatchObject({ gloves: 315, codeLetter: null, codeLetterReason: null });
  });

  it("keeps an ISO 2859-1 letter, A to R without I or O, and a reason of 1 to 500 characters, trimmed", () => {
    for (const letter of ["A", "H", "J", "N", "P", "R"]) {
      expect(SamplingPlanDataSchema.parse({ sizes: { M: { codeLetter: letter } } }).sizes.M.codeLetter).toBe(letter);
    }
    for (const bad of ["I", "O", "S", "n", "", 13]) {
      expect(SamplingPlanDataSchema.safeParse({ sizes: { M: { codeLetter: bad } } }).success, String(bad)).toBe(false);
    }
    expect(SamplingPlanDataSchema.parse({ sizes: { M: { codeLetterReason: `  ${REASON} ` } } }).sizes.M.codeLetterReason).toBe(REASON);
    for (const bad of ["", "   ", "x".repeat(CODE_LETTER_REASON_MAX + 1), 5]) {
      expect(SamplingPlanDataSchema.safeParse({ sizes: { M: { codeLetterReason: bad } } }).success, String(bad)).toBe(false);
    }
  });

  it("takes the reason Reduce waits for: trimmed, never blank, at most 500 characters", () => {
    expect(codeLetterReason(`  ${REASON}\n`)).toBe(REASON);
    expect(codeLetterReason("")).toBeNull();
    expect(codeLetterReason("  \n ")).toBeNull();
    expect(codeLetterReason("x".repeat(CODE_LETTER_REASON_MAX))).toHaveLength(CODE_LETTER_REASON_MAX);
    expect(codeLetterReason("x".repeat(CODE_LETTER_REASON_MAX + 1))).toBeNull();
  });

  it("Reduce: N to M with the reason, and that size's gloves become M's 315; its Watertight & Visual follows", () => {
    const next = withCodeLetterStep(lettered(), "S", { direction: "down", ...LOT_N, reason: `${REASON} ` }, SAMPLING_PLAN_DEFAULT_CONFIG);
    expect(next.sizes.S).toMatchObject({ codeLetter: "M", codeLetterReason: REASON, gloves: 315, glovesWatertightVisual: 315 });
    expect(SamplingPlanDataSchema.parse(next)).toEqual(next);
    // The inner boxes stay: the gloves per inner box and those put back follow in calc (13 a box, 10 back).
    expect(next.sizes.S).toMatchObject({ cases: 25, innerUnits: 25 });
  });

  it("changes only the size whose Reduce was pressed: each size has its own (Kenneth, 27 October 2026)", () => {
    const data = lettered();
    const next = withCodeLetterStep(data, "S", { direction: "down", ...LOT_N, reason: REASON }, SAMPLING_PLAN_DEFAULT_CONFIG);
    expect(next.sizes.M).toBe(data.sizes.M);
    expect(next.sizes.M).toMatchObject({ codeLetter: "N", gloves: 500, glovesWatertightVisual: 500, codeLetterReason: null });
    const raised = withCodeLetterStep(next, "S", { direction: "up", ...LOT_N }, SAMPLING_PLAN_DEFAULT_CONFIG);
    expect(raised.sizes.M).toBe(data.sizes.M);
  });

  it("takes no Reduce without a reason, at A, or with no letter yet", () => {
    const data = lettered();
    expect(withCodeLetterStep(data, "S", { direction: "down", ...LOT_N }, SAMPLING_PLAN_DEFAULT_CONFIG)).toBe(data);
    expect(withCodeLetterStep(data, "S", { direction: "down", ...LOT_N, reason: "   " })).toBe(data);
    const atA = lettered({ S: { codeLetter: "A", gloves: 2 } });
    expect(withCodeLetterStep(atA, "S", { direction: "down", lot: 2, lotLetter: "A", reason: REASON })).toBe(atA);
    const none = lettered({ S: { codeLetter: null } });
    expect(withCodeLetterStep(none, "S", { direction: "down", ...LOT_N, reason: REASON })).toBe(none);
  });

  it("steps in ISO 2859-1 order, past I and O: J down is H, P down is N", () => {
    const at = (letter: "J" | "P") => lettered({ S: { codeLetter: letter } });
    expect(withCodeLetterStep(at("J"), "S", { direction: "down", ...LOT_N, reason: REASON }).sizes.S).toMatchObject({ codeLetter: "H", gloves: 50 });
    expect(withCodeLetterStep(at("P"), "S", { direction: "down", lot: 5_800_000, lotLetter: "Q", reason: REASON }).sizes.S).toMatchObject({
      codeLetter: "N",
      gloves: 500,
    });
  });

  it("Raise: back to N, gloves 500 again, and the reason goes at the lot's letter; still below it, the reason stays", () => {
    const reduced = withCodeLetterStep(lettered(), "S", { direction: "down", ...LOT_N, reason: REASON }, SAMPLING_PLAN_DEFAULT_CONFIG);
    const back = withCodeLetterStep(reduced, "S", { direction: "up", ...LOT_N }, SAMPLING_PLAN_DEFAULT_CONFIG);
    expect(back.sizes.S).toMatchObject({ codeLetter: "N", codeLetterReason: null, gloves: 500, glovesWatertightVisual: 500 });
    const twice = withCodeLetterStep(reduced, "S", { direction: "down", ...LOT_N, reason: "Second audit this year" });
    expect(twice.sizes.S).toMatchObject({ codeLetter: "L", gloves: 200, codeLetterReason: "Second audit this year" });
    expect(withCodeLetterStep(twice, "S", { direction: "up", ...LOT_N }).sizes.S).toMatchObject({
      codeLetter: "M",
      gloves: 315,
      codeLetterReason: "Second audit this year",
    });
  });

  it("never raises above the lot's letter, nor while the lot is not known", () => {
    const atPlan = lettered();
    expect(withCodeLetterStep(atPlan, "S", { direction: "up", ...LOT_N })).toBe(atPlan);
    const reduced = lettered({ S: { codeLetter: "M", gloves: 315, codeLetterReason: REASON } });
    expect(withCodeLetterStep(reduced, "S", { direction: "up", lot: null, lotLetter: null })).toBe(reduced);
  });

  it("caps the gloves at the lot as Auto Calculate does, and takes the letter's sample size while the lot is not known", () => {
    // Level III: a lot of 6 is code B; from E (13), Reduce takes D's 8, of which the lot holds 6.
    const small = lettered({ S: { codeLetter: "E", gloves: 6 } });
    expect(withCodeLetterStep(small, "S", { direction: "down", lot: 6, lotLetter: "B", reason: REASON }).sizes.S).toMatchObject({
      codeLetter: "D",
      gloves: 6,
    });
    expect(withCodeLetterStep(lettered(), "S", { direction: "down", lot: null, lotLetter: null, reason: REASON }).sizes.S).toMatchObject({
      codeLetter: "M",
      gloves: 315,
    });
  });

  it("takes a code letter a document states only where the size has none, as every reading fills (applyProposals)", () => {
    const included = new Set(["sampling_plan"]);
    const proposal = { sampling_plan: { sizes: { M: { codeLetter: "M" } } } };
    const empty: InspectionData = { modules: { sampling_plan: { sizes: { M: { gloves: 315 } } } }, custom: {} };
    const filled = applyProposals(empty, proposal, MODULE_REGISTRY, included);
    expect(filled.filled).toBe(1);
    expect((filled.data.modules.sampling_plan as SamplingPlanData).sizes.M).toMatchObject({ gloves: 315, codeLetter: "M" });
    const own: InspectionData = { modules: { sampling_plan: { sizes: { M: { codeLetter: "N" } } } }, custom: {} };
    expect(applyProposals(own, proposal, MODULE_REGISTRY, included).filled).toBe(0);
  });
});

describe("sampling_plan Watertight & Visual follows # of Gloves Sample (Kenneth, 27 October 2026)", () => {
  it("writes # of Gloves Sample typed into Watertight & Visual in the same change, emptied too", () => {
    const typed = withCount(emptySamplingPlan(), "M", "gloves", 315, SAMPLING_PLAN_DEFAULT_CONFIG);
    expect(typed.sizes.M).toMatchObject({ gloves: 315, glovesWatertightVisual: 315 });
    expect(withCount(typed, "M", "gloves", null, SAMPLING_PLAN_DEFAULT_CONFIG).sizes.M).toMatchObject({ gloves: null, glovesWatertightVisual: null });
  });

  it("keeps a count typed into Watertight & Visual until # of Gloves Sample next changes", () => {
    const typed = withCount(withCount(emptySamplingPlan(), "M", "gloves", 315, SAMPLING_PLAN_DEFAULT_CONFIG), "M", "glovesWatertightVisual", 200, SAMPLING_PLAN_DEFAULT_CONFIG);
    expect(typed.sizes.M).toMatchObject({ gloves: 315, glovesWatertightVisual: 200 });
    // The same gloves typed again is no change, so it keeps the 200.
    expect(withCount(typed, "M", "gloves", 315, SAMPLING_PLAN_DEFAULT_CONFIG)).toBe(typed);
    expect(withCount(typed, "M", "gloves", 500, SAMPLING_PLAN_DEFAULT_CONFIG).sizes.M.glovesWatertightVisual).toBe(500);
  });

  it("follows only where the template shows both rows and Watertight & Visual is not switched off", () => {
    const config = SAMPLING_PLAN_DEFAULT_CONFIG;
    expect(watertightVisualFollows(emptySamplingPlan(), config)).toBe(true);
    const off = withRowOff(emptySamplingPlan(), "glovesWatertightVisual", true);
    expect(watertightVisualFollows(off, config)).toBe(false);
    expect(withCount(off, "M", "gloves", 315, config).sizes.M.glovesWatertightVisual).toBeNull();
    const noGloves = { ...config, columns: { ...config.columns, gloves: false } };
    expect(watertightVisualFollows(emptySamplingPlan(), noGloves)).toBe(false);
    // Without the template's config (a reading's fill, older callers), nothing follows.
    expect(withCount(emptySamplingPlan(), "M", "gloves", 315).sizes.M.glovesWatertightVisual).toBeNull();
  });
});

describe("autoSamplingReplaces: Auto Calculate Sampling asks before replacing what is entered", () => {
  const auto = (more: Partial<AutoSampling> = {}): AutoSampling => ({
    cases: { S: 25, M: 20 },
    gloves: { S: 500, M: 500 },
    letters: { S: "N", M: "N" },
    perCase: null,
    ...more,
  });

  it("asks for nothing it would leave as it is, or that is empty", () => {
    expect(autoSamplingReplaces(lettered(), ["S", "M"], auto(), SAMPLING_PLAN_DEFAULT_CONFIG)).toBe(false);
    expect(autoSamplingReplaces(emptySamplingPlan(), ["S", "M"], auto(), SAMPLING_PLAN_DEFAULT_CONFIG)).toBe(false);
  });

  it("counts a code letter it would change, a lowered one above all, as an entered value", () => {
    const lowered = lettered({ S: { codeLetter: "M", gloves: 500 } });
    expect(autoSamplingReplaces(lowered, ["S", "M"], auto(), SAMPLING_PLAN_DEFAULT_CONFIG)).toBe(true);
    // A size whose lot is not known keeps its letter: nothing to ask.
    expect(autoSamplingReplaces(lowered, ["S", "M"], auto({ letters: { M: "N" } }), SAMPLING_PLAN_DEFAULT_CONFIG)).toBe(false);
  });

  it("counts a Watertight & Visual typed otherwise where it follows the gloves, and not where it is switched off", () => {
    const typed = lettered({ S: { glovesWatertightVisual: 200 } });
    expect(autoSamplingReplaces(typed, ["S", "M"], auto(), SAMPLING_PLAN_DEFAULT_CONFIG)).toBe(true);
    expect(autoSamplingReplaces(withRowOff(typed, "glovesWatertightVisual", true), ["S", "M"], auto(), SAMPLING_PLAN_DEFAULT_CONFIG)).toBe(false);
  });

  it("still counts cases, gloves and a typed total of inner boxes it would replace", () => {
    expect(autoSamplingReplaces(lettered({ S: { cases: 30 } }), ["S", "M"], auto(), SAMPLING_PLAN_DEFAULT_CONFIG)).toBe(true);
    expect(autoSamplingReplaces(lettered({ S: { gloves: 300, glovesWatertightVisual: 500 } }), ["S", "M"], auto(), SAMPLING_PLAN_DEFAULT_CONFIG)).toBe(true);
    const typedTotal = lettered({ S: { innerUnitsPerCase: null, innerUnits: 30 } });
    expect(autoSamplingReplaces(typedTotal, ["S", "M"], auto({ perCase: 1 }), SAMPLING_PLAN_DEFAULT_CONFIG)).toBe(true);
    expect(autoSamplingReplaces(typedTotal, ["S", "M"], auto(), SAMPLING_PLAN_DEFAULT_CONFIG)).toBe(false);
  });
});

describe("sampling_plan config", () => {
  it("uses the dictionary's columns, defaults and wording (docs/DATA_DICTIONARY.md)", () => {
    expect(SAMPLING_COLUMNS).toEqual(DICTIONARY_COLUMNS);
    expect(SAMPLING_PLAN_DEFAULT_CONFIG).toEqual(defaultConfig("sampling_plan"));
    expect({ ...SAMPLING_PLAN_LABELS }).toEqual(defaultLabels("sampling_plan"));
  });

  it("shows the examination columns with no inspection level by default", () => {
    expect(SamplingPlanConfigSchema.parse(SAMPLING_PLAN_DEFAULT_CONFIG)).toEqual({
      columns: {
        cases: true,
        innerUnits: true,
        gloves: true,
        glovesWatertightVisual: true,
        glovesDimensions: true,
        glovesPhysical: true,
        glovesWeight: false,
        innerUnitsDispensing: true,
        pouches: false,
        pouchesDyeLeak: false,
      },
      inspectionLevel: null,
    });
  });

  it("accepts # Gloves for Weight as each template stores it (STD_EG on), and never shows it (Kenneth, 26 October 2026)", () => {
    expect(TEMPLATE_CODES.map((code) => [code, config(code).columns.glovesWeight])).toEqual([
      ["STD_EG", true],
      ["SAFEDON_EG", false],
      ["STD_SG", false],
    ]);
    for (const code of TEMPLATE_CODES) expect(shownColumns(config(code))).not.toContain("glovesWeight");
  });

  it("reads a template version saved before # Gloves for Weight existed as without the row, every other column kept", () => {
    const columns = Object.fromEntries(Object.entries(config("STD_EG").columns).filter(([column]) => column !== "glovesWeight"));
    const before = SamplingPlanConfigSchema.parse({ columns, inspectionLevel: "I" });
    expect(before.columns).toEqual({ ...columns, glovesWeight: false });
    expect(columnGroups(before).tests).not.toContain("glovesWeight");
  });

  it.each(TEMPLATE_CODES)("accepts %s's config, as written and merged down its extends chain", (code) => {
    const own = moduleConfig(code, "sampling_plan");
    expect(SamplingPlanConfigSchema.parse(own)).toEqual(own);
    expect(SamplingPlanConfigSchema.parse(resolvedConfig(code))).toEqual(own);
  });

  it("takes every label a seed template overrides", () => {
    for (const code of TEMPLATE_CODES) {
      for (const key of Object.keys(labelOverrides(code, "sampling_plan"))) {
        expect(Object.keys(SAMPLING_PLAN_LABELS), `${code} ${key}`).toContain(key);
      }
    }
    expect(labelOverrides("SAFEDON_EG", "sampling_plan")).toMatchObject({ glovesPhysical: "# Gloves for Tensile" });
  });

  it.each(TEMPLATE_CODES)("lets %s resolve against the app's modules", (code) => {
    const resolved = resolveSeed(code);
    const entry = resolved.modules.find((found) => found.key === "sampling_plan");
    expect(entry?.config).toEqual(moduleConfig(code, "sampling_plan"));
    expect(entry?.labels).toMatchObject(labelOverrides(code, "sampling_plan"));
  });

  it("rejects a mistyped or missing column and a level ISO 2859-1 does not have", () => {
    const columns = SAMPLING_PLAN_DEFAULT_CONFIG.columns;
    expect(SamplingPlanConfigSchema.safeParse({ ...SAMPLING_PLAN_DEFAULT_CONFIG, columns: { ...columns, glove: true } }).success).toBe(
      false,
    );
    const withoutPouches = Object.fromEntries(Object.entries(columns).filter(([column]) => column !== "pouches"));
    expect(SamplingPlanConfigSchema.safeParse({ ...SAMPLING_PLAN_DEFAULT_CONFIG, columns: withoutPouches }).success).toBe(false);
    for (const level of ["IV", "i", "S-5", ""]) {
      expect(SamplingPlanConfigSchema.safeParse({ ...SAMPLING_PLAN_DEFAULT_CONFIG, inspectionLevel: level }).success, level).toBe(
        false,
      );
    }
    for (const level of ["S-1", "S-4", "I", "II", "III", null]) {
      expect(SamplingPlanConfigSchema.safeParse({ ...SAMPLING_PLAN_DEFAULT_CONFIG, inspectionLevel: level }).success).toBe(true);
    }
  });

  it("becomes JSON Schema with descriptions, for the template editor's form", () => {
    const schema = z.toJSONSchema(SamplingPlanConfigSchema) as { properties: Record<string, { description?: string }> };
    expect(schema.properties.columns.description).toContain("Columns shown");
    expect(schema.properties.inspectionLevel.description).toContain("ISO 2859-1 inspection level");
  });

  it("groups the columns as the forms print them: EG's Sampling Quantity, SG's with the watertight and visual gloves", () => {
    expect(columnGroups(config("STD_EG"))).toEqual({
      quantity: ["cases", "innerUnits", "gloves"],
      tests: ["glovesWatertightVisual", "glovesDimensions", "glovesPhysical", "innerUnitsDispensing"],
    });
    expect(columnGroups(config("SAFEDON_EG")).tests).toEqual([
      "glovesWatertightVisual",
      "glovesDimensions",
      "glovesPhysical",
      "innerUnitsDispensing",
    ]);
    expect(columnGroups(config("STD_SG"))).toEqual({
      quantity: ["cases", "innerUnits", "pouches", "glovesWatertightVisual"],
      tests: ["glovesDimensions", "glovesPhysical", "pouchesDyeLeak"],
    });
  });
});

function config(code: TemplateCode): SamplingPlanConfig {
  return SamplingPlanConfigSchema.parse(moduleConfig(code, "sampling_plan"));
}

/** The module's defaults, then each seed from the root of the chain down, as lib/templates merges them. */
function resolvedConfig(code: TemplateCode): ConfigObject {
  const chain: TemplateCode[] = [];
  for (let at: TemplateCode | null = code; at !== null; at = TEMPLATES[at].extends) chain.unshift(at);
  return chain.reduce(
    (merged, at) => mergeConfig(merged, seedConfig(at, "sampling_plan") ?? {}),
    SAMPLING_PLAN_DEFAULT_CONFIG as ConfigObject,
  );
}
