import { describe, expect, it } from "vitest";
import type { InspectionData } from "@/modules/_framework";
import { CODE_LETTER_CHANGED, samplingEvents } from "./sampling-events";

type Size = Record<string, unknown>;

const dataWith = (sizes: unknown): InspectionData => ({ modules: { sampling_plan: { sizes } }, custom: {} });

/** A size as Auto Calculate leaves it, with the counts the sampling plan keeps beside the letter. */
const size = (codeLetter: string | null, gloves: number | null, codeLetterReason?: string): Size => ({
  cases: 13,
  innerUnitsPerCase: 1,
  innerUnits: 13,
  gloves,
  glovesWatertightVisual: gloves,
  codeLetter,
  ...(codeLetterReason === undefined ? {} : { codeLetterReason }),
});

/** A size saved before the Code Letter row: no letter at all. */
const unlettered = (gloves: number | null): Size => {
  const entry = size(null, gloves);
  delete entry.codeLetter;
  return entry;
};

const REASON = "Consistent high-quality factory.";
const NOTHING: InspectionData = { modules: {}, custom: {} };

/** calc's computed values for the saved data: the lot's letter of each ordered size. */
const lotLetters = (letters: Record<string, string>) => ({
  computed: {
    inspectionLevel: "II",
    sizes: Object.fromEntries(Object.entries(letters).map(([key, codeLetter]) => [key, { lotSizeGloves: 35_000, codeLetter }])),
    totals: {},
  },
});

describe("samplingEvents: the audit rows a save writes for a size's code letter (Kenneth, 27 October 2026)", () => {
  it("records a letter reduced, with the reason and the # of Gloves Sample before and after", () => {
    expect(samplingEvents(dataWith({ S: size("N", 500) }), dataWith({ S: size("M", 315, REASON) }), undefined)).toEqual([
      {
        action: CODE_LETTER_CHANGED,
        changes: {
          module: "sampling_plan",
          size: "S",
          from: "N",
          to: "M",
          direction: "reduced",
          reason: REASON,
          glovesFrom: 500,
          glovesTo: 315,
        },
      },
    ]);
  });

  it("records a letter raised with no reason, also one still below the lot's that keeps its reason", () => {
    const back = samplingEvents(dataWith({ S: size("M", 315, REASON) }), dataWith({ S: size("N", 500) }), undefined);
    expect(back.map((event) => event.changes)).toEqual([
      { module: "sampling_plan", size: "S", from: "M", to: "N", direction: "raised", reason: null, glovesFrom: 315, glovesTo: 500 },
    ]);
    const partway = samplingEvents(dataWith({ S: size("L", 200, REASON) }), dataWith({ S: size("M", 315, REASON) }), undefined);
    expect(partway[0].changes).toMatchObject({ from: "L", to: "M", direction: "raised", reason: null });
  });

  it("reads the letters in ISO 2859-1's order, which skips I and O", () => {
    const up = samplingEvents(dataWith({ S: size("H", 50) }), dataWith({ S: size("J", 80) }), undefined);
    expect(up[0].changes).toMatchObject({ from: "H", to: "J", direction: "raised" });
    const down = samplingEvents(dataWith({ S: size("P", 800) }), dataWith({ S: size("N", 500, REASON) }), undefined);
    expect(down[0].changes).toMatchObject({ from: "P", to: "N", direction: "reduced", reason: REASON });
  });

  it("records nothing for the first fill: the calculation, not an inspector's decision", () => {
    const after = dataWith({ S: size("N", 500) });
    expect(samplingEvents(NOTHING, after, undefined)).toEqual([]);
    expect(samplingEvents(dataWith({}), after, undefined)).toEqual([]);
    expect(samplingEvents(dataWith({ S: size(null, null) }), after, undefined)).toEqual([]);
    expect(samplingEvents(dataWith({ S: unlettered(null) }), after, undefined)).toEqual([]);
  });

  it("records a letter filled and reduced in one save (offline meanwhile) as reduced from the lot's letter", () => {
    const after = dataWith({ S: size("M", 315, REASON) });
    expect(samplingEvents(NOTHING, after, lotLetters({ S: "N" }))[0].changes).toEqual({
      module: "sampling_plan",
      size: "S",
      from: "N",
      to: "M",
      direction: "reduced",
      reason: REASON,
      glovesFrom: null,
      glovesTo: 315,
    });
    // The lot's letter is not known, or is not above the one saved: reduced from a letter the server cannot tell.
    expect(samplingEvents(NOTHING, after, undefined)[0].changes).toMatchObject({ from: null, to: "M", direction: "reduced" });
    expect(samplingEvents(NOTHING, after, lotLetters({ S: "M" }))[0].changes).toMatchObject({ from: null });
    expect(samplingEvents(NOTHING, after, { computed: { sizes: "unreadable" } })[0].changes).toMatchObject({ from: null });
  });

  it("records nothing while the letter stays, whatever else in the size changed", () => {
    const reduced = dataWith({ S: size("M", 315, REASON) });
    expect(samplingEvents(reduced, reduced, undefined)).toEqual([]);
    const retyped = dataWith({ S: { ...size("M", 320, "Audited factory, three clean lots."), cases: 20 } });
    expect(samplingEvents(reduced, retyped, undefined)).toEqual([]);
  });

  it("records a letter cleared, with `to` null", () => {
    const stored = dataWith({ S: size("N", 500) });
    const cleared = { module: "sampling_plan", size: "S", from: "N", to: null, direction: null, reason: null, glovesFrom: 500 };
    expect(samplingEvents(stored, dataWith({ S: size(null, null) }), undefined)[0].changes).toEqual({ ...cleared, glovesTo: null });
    expect(samplingEvents(stored, dataWith({ S: unlettered(500) }), undefined)[0].changes).toEqual({ ...cleared, glovesTo: 500 });
  });

  it("skips what it cannot read and never throws: the module's schema may not know the letter yet", () => {
    const stored = dataWith({ S: size("N", 500) });
    for (const after of [
      { modules: { sampling_plan: "not a sampling plan" }, custom: {} },
      { modules: { sampling_plan: { sizes: ["N"] } }, custom: {} },
      dataWith({ S: 7 }),
      dataWith({ S: null }),
      dataWith({ S: size("I", 500) }),
      dataWith({ S: { ...size("M", 315), codeLetter: 13 } }),
    ] as InspectionData[]) {
      expect(() => samplingEvents(stored, after, undefined)).not.toThrow();
      expect(samplingEvents(stored, after, undefined)).toEqual([]);
      expect(samplingEvents(after, stored, undefined)).toEqual([]);
    }
    // A reason or a count that cannot be read is none: the letter's change is still recorded.
    const odd = dataWith({ S: { ...size("M", 315), gloves: "315", codeLetterReason: "x".repeat(501) } });
    expect(samplingEvents(stored, odd, undefined)[0].changes).toMatchObject({ to: "M", reason: null, glovesTo: null });
    const blank = dataWith({ S: size("M", 315, "   ") });
    expect(samplingEvents(stored, blank, undefined)[0].changes).toMatchObject({ reason: null });
  });

  it("records each size that changed, in size order, and leaves a size that cannot be read out", () => {
    const before = dataWith({ XL: size("N", 500), S: size("N", 500), M: size("M", 315, REASON), L: size("N", 500), XS: size("K", 125) });
    const after = dataWith({ XL: size(null, null), S: size("M", 315, REASON), M: size("N", 500), L: size("N", 500), XS: "unreadable" });
    expect(samplingEvents(before, after, undefined).map(({ changes }) => [changes.size, changes.direction, changes.to])).toEqual([
      ["M", "raised", "N"],
      ["S", "reduced", "M"],
      ["XL", null, null],
    ]);
  });
});
