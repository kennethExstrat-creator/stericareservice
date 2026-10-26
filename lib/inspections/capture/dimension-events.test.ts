import { describe, expect, it } from "vitest";
import type { InspectionData } from "@/modules/_framework";
import { DIMENSIONS_DEFAULT_CONFIG } from "@/modules/dimensions/config";
import { dimensionEvents, PASS_FAIL_CHANGED, passFailEvents, SPEC_CHANGED, specEvents } from "./dimension-events";

type SizeEntry = { manualResults?: Record<string, { result: "pass" | "fail"; comment: string }>; specOverrides?: Record<string, unknown> };

const dataWith = (entry: SizeEntry = {}): InspectionData => ({
  modules: { dimensions: { sizes: { M: { gloves: [], ...entry } } } },
  custom: {},
});
const withManual = (manualResults?: SizeEntry["manualResults"]) => dataWith(manualResults ? { manualResults } : {});
const withSpecs = (specOverrides?: SizeEntry["specOverrides"]) => dataWith(specOverrides ? { specOverrides } : {});

const THICKNESS = { kind: "tolerance", nominal: 0.18, tolerance: 0.04 } as const;
const DIMENSIONS = {
  title: "Dimension",
  labels: { width: "Width", palmThickness: "Palm Thickness", fingerThickness: "Finger Thickness" },
  config: {
    ...DIMENSIONS_DEFAULT_CONFIG,
    specs: [{ size: "M", specs: { fingerThickness: THICKNESS, length: { kind: "min", min: 240 } } }],
  },
  computed: { calculated: { M: { width: "pass", palmThickness: "pass" } } },
};

describe("passFailEvents: the audit rows a save writes for a P/F set by hand (Kenneth, 26 October 2026)", () => {
  it("records a P/F set, with the template's words, the readings' verdict and the comment", () => {
    const events = passFailEvents(withManual(), withManual({ width: { result: "fail", comment: "Torn cuffs." } }), DIMENSIONS);
    expect(events).toEqual([
      {
        action: PASS_FAIL_CHANGED,
        changes: {
          module: "dimensions",
          moduleTitle: "Dimension",
          size: "M",
          column: "width",
          columnLabel: "Width",
          from: null,
          to: "fail",
          calculated: "pass",
          comment: "Torn cuffs.",
          previousComment: null,
        },
      },
    ]);
  });

  it("records a change of result or comment, and a P/F given back to the readings", () => {
    const set = withManual({ width: { result: "fail", comment: "Torn cuffs." } });
    const changed = withManual({ width: { result: "pass", comment: "Measured again." } });
    expect(passFailEvents(set, changed, DIMENSIONS)[0].changes).toMatchObject({ from: "fail", to: "pass", comment: "Measured again." });
    const back = passFailEvents(changed, withManual(), DIMENSIONS);
    expect(back[0].changes).toMatchObject({ from: "pass", to: null, comment: null, previousComment: "Measured again." });
  });

  it("records nothing when no P/F set by hand changed, nor for data with no dimension", () => {
    const set = withManual({ width: { result: "fail", comment: "Torn cuffs." } });
    expect(passFailEvents(set, set, DIMENSIONS)).toEqual([]);
    const none: InspectionData = { modules: {}, custom: {} };
    expect(passFailEvents(none, none, undefined)).toEqual([]);
  });
});

describe("specEvents: the audit rows a save writes for a spec set for the inspection (Kenneth, 26 October 2026)", () => {
  it("records a spec set over the template's, with the specs judged by before and after", () => {
    expect(specEvents(withSpecs(), withSpecs({ fingerThickness: { kind: "na" } }), DIMENSIONS)).toEqual([
      {
        action: SPEC_CHANGED,
        changes: {
          module: "dimensions",
          moduleTitle: "Dimension",
          size: "M",
          column: "fingerThickness",
          columnLabel: "Finger Thickness",
          from: THICKNESS,
          to: { kind: "na" },
          fromText: "0.18 ± 0.04",
          toText: "NA",
          template: THICKNESS,
          change: "set",
        },
      },
    ]);
  });

  it("records one spec changed for another, and a spec given back to the template's", () => {
    const na = withSpecs({ fingerThickness: { kind: "na" } });
    const wider = withSpecs({ fingerThickness: { kind: "tolerance", nominal: 0.14, tolerance: 0.04 } });
    expect(specEvents(na, wider, DIMENSIONS)[0].changes).toMatchObject({ fromText: "NA", toText: "0.14 ± 0.04", change: "changed" });
    expect(specEvents(wider, withSpecs(), DIMENSIONS)[0].changes).toMatchObject({
      fromText: "0.14 ± 0.04",
      toText: "0.18 ± 0.04",
      to: THICKNESS,
      change: "cleared",
    });
  });

  it("says no spec where the template has none, and records nothing when no spec changed", () => {
    const events = specEvents(withSpecs(), withSpecs({ width: { kind: "max", max: 80 } }), DIMENSIONS);
    expect(events[0].changes).toMatchObject({ column: "width", from: null, fromText: "no spec", toText: "≤ 80", template: null });
    const set = withSpecs({ width: { kind: "max", max: 80 } });
    expect(specEvents(set, set, DIMENSIONS)).toEqual([]);
  });

  it("writes the specs before the P/F when a save changes both", () => {
    const before = dataWith();
    const after = dataWith({
      specOverrides: { fingerThickness: { kind: "na" } },
      manualResults: { width: { result: "fail", comment: "Torn cuffs." } },
    });
    expect(dimensionEvents(before, after, DIMENSIONS).map((event) => event.action)).toEqual([SPEC_CHANGED, PASS_FAIL_CHANGED]);
  });
});
