import { describe, expect, it } from "vitest";
import { decide, labelingPlan } from "./decision";
import {
  planFromLotSize,
  planFromSampleSize,
  planMatchesLot,
  planMatchesSample,
  sampleSizeFromLotSize,
  type AqlResult,
} from "./plan";
import {
  LotSampleSchema,
  LotSizePlanSchema,
  SampleSizePlanSchema,
  type Aql,
  type LotSizePlan,
  type SampleSizePlan,
} from "./schema";
import type { InspectionLevel } from "./tables";

/** The plan of a result that must succeed; the error fails the test otherwise. */
function planOf<T>(result: AqlResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.plan;
}

const fromSample = (sampleSize: number, aql: Aql) => planOf(planFromSampleSize({ sampleSize, aql }));
const fromLot = (lotSize: number, level: InspectionLevel, aql: Aql, sampleSize?: number) =>
  planOf(planFromLotSize({ lotSize, level, aql, sampleSize }));
const lotSample = (lotSize: number, level: InspectionLevel, sampleSize?: number) =>
  planOf(sampleSizeFromLotSize({ lotSize, level, sampleSize }));
const limits = ({ ac, re }: { ac: number; re: number }) => `${ac} / ${re}`;
const codes = (plan: { warnings: { code: string }[] }) => plan.warnings.map((warning) => warning.code);

describe("BUILD_SPEC 7: tests that must pass", () => {
  it("lot 5,000, level I: J, n 80; AQL 1.5: 3 / 4; AQL 2.5: 5 / 6", () => {
    expect(lotSample(5_000, "I")).toMatchObject({ codeLetter: "J", n: 80 });
    expect(fromLot(5_000, "I", 1.5)).toMatchObject({ codeLetter: "J", usedLetter: "J", n: 80, ac: 3, re: 4 });
    expect(fromLot(5_000, "I", 2.5)).toMatchObject({ codeLetter: "J", usedLetter: "J", n: 80, ac: 5, re: 6 });
  });

  it("lot 20,000, level I: K, n 125; AQL 1.5: 5 / 6; AQL 2.5: 7 / 8", () => {
    expect(lotSample(20_000, "I")).toMatchObject({ codeLetter: "K", n: 125 });
    expect(fromLot(20_000, "I", 1.5)).toMatchObject({ codeLetter: "K", n: 125, ac: 5, re: 6 });
    expect(fromLot(20_000, "I", 2.5)).toMatchObject({ codeLetter: "K", n: 125, ac: 7, re: 8 });
  });

  it("lot 50,000, level I: L, n 200; AQL 1.5: 7 / 8; AQL 2.5: 10 / 11", () => {
    expect(lotSample(50_000, "I")).toMatchObject({ codeLetter: "L", n: 200 });
    expect(fromLot(50_000, "I", 1.5)).toMatchObject({ codeLetter: "L", n: 200, ac: 7, re: 8 });
    expect(fromLot(50_000, "I", 2.5)).toMatchObject({ codeLetter: "L", n: 200, ac: 10, re: 11 });
  });

  it("lot 120,000, level I: L, n 200", () => {
    expect(lotSample(120_000, "I")).toMatchObject({ codeLetter: "L", n: 200 });
  });

  it("lot 1,700,000 or 5,800,000, level I: N, n 500", () => {
    expect(lotSample(1_700_000, "I")).toMatchObject({ codeLetter: "N", n: 500 });
    expect(lotSample(5_800_000, "I")).toMatchObject({ codeLetter: "N", n: 500 });
  });

  it("lot 20,000, level II: M, n 315; AQL 1.5: 10 / 11; AQL 2.5: 14 / 15", () => {
    expect(lotSample(20_000, "II")).toMatchObject({ codeLetter: "M", n: 315 });
    expect(fromLot(20_000, "II", 1.5)).toMatchObject({ codeLetter: "M", n: 315, ac: 10, re: 11 });
    expect(fromLot(20_000, "II", 2.5)).toMatchObject({ codeLetter: "M", n: 315, ac: 14, re: 15 });
  });

  it("n 80: AQL 4.0: 7 / 8", () => {
    expect(fromSample(80, 4.0)).toMatchObject({ codeLetter: "J", usedLetter: "J", ac: 7, re: 8, arrow: null });
  });

  it("n 200: AQL 4.0: 14 / 15", () => {
    expect(fromSample(200, 4.0)).toMatchObject({ codeLetter: "L", usedLetter: "L", ac: 14, re: 15, arrow: null });
  });

  it("n 500: AQL 1.5: 14 / 15; AQL 2.5: 21 / 22; AQL 4.0: arrow up to M, 21 / 22", () => {
    expect(fromSample(500, 1.5)).toMatchObject({ codeLetter: "N", usedLetter: "N", ac: 14, re: 15, arrow: null });
    expect(fromSample(500, 2.5)).toMatchObject({ codeLetter: "N", usedLetter: "N", ac: 21, re: 22, arrow: null });
    expect(fromSample(500, 4.0)).toMatchObject({
      codeLetter: "N",
      usedLetter: "M",
      n: 315,
      ac: 21,
      re: 22,
      arrow: "up",
      warnings: [],
    });
  });

  it("lot 100, level I (D): AQL 1.5: n 8, 0 / 1; AQL 2.5: arrow up, n 5, 0 / 1; AQL 4.0: arrow down, n 13, 1 / 2", () => {
    expect(lotSample(100, "I")).toMatchObject({ codeLetter: "D", n: 8 });
    expect(fromLot(100, "I", 1.5)).toMatchObject({ codeLetter: "D", usedLetter: "D", n: 8, ac: 0, re: 1, arrow: null });
    expect(fromLot(100, "I", 2.5)).toMatchObject({ codeLetter: "D", usedLetter: "C", n: 5, ac: 0, re: 1, arrow: "up" });
    expect(fromLot(100, "I", 4.0)).toMatchObject({
      codeLetter: "D",
      usedLetter: "E",
      n: 13,
      ac: 1,
      re: 2,
      arrow: "down",
    });
  });

  it("any n, AQL 0: 0 / 1", () => {
    for (const sampleSize of [2, 3, 7, 13, 80, 100, 125, 200, 315, 500, 1_250, 1_999, 2_000, 5_000]) {
      const plan = fromSample(sampleSize, 0);
      expect(limits(plan), `n ${sampleSize}`).toBe("0 / 1");
      expect(plan.arrow).toBeNull();
      expect(plan.usedLetter).toBe(plan.codeLetter);
    }
    for (const lotSize of [2, 100, 5_000, 5_800_000]) {
      expect(limits(fromLot(lotSize, "I", 0)), `lot ${lotSize}`).toBe("0 / 1");
    }
  });
});

describe("example reports (docs/examples/expected-results.md)", () => {
  // Sizes XS, S, M and L: 60, 850, 560 and 60 cases of 2,000 gloves; 80, 200, 200 and 80 sampled.
  describe("SAFEDON_EG", () => {
    it("watertight at AQL 1.5: n 80 has limit 3 / 4, n 200 has 7 / 8", () => {
      expect(fromSample(80, 1.5)).toMatchObject({ codeLetter: "J", ac: 3, re: 4, warnings: [] });
      expect(fromSample(200, 1.5)).toMatchObject({ codeLetter: "L", ac: 7, re: 8, warnings: [] });
    });

    it("passes watertight XS (1 / 80), S and M (0 / 200) and L (1 / 80, glove burst)", () => {
      expect(decide(1, fromSample(80, 1.5))).toBe("accept");
      expect(decide(0, fromSample(200, 1.5))).toBe("accept");
    });

    it("visual: critical 0 / 1; major n 80 5 / 6, n 200 10 / 11; minor n 80 7 / 8, n 200 14 / 15", () => {
      expect(limits(fromSample(80, 0))).toBe("0 / 1");
      expect(limits(fromSample(200, 0))).toBe("0 / 1");
      expect(limits(fromSample(80, 2.5))).toBe("5 / 6");
      expect(limits(fromSample(200, 2.5))).toBe("10 / 11");
      expect(limits(fromSample(80, 4.0))).toBe("7 / 8");
      expect(limits(fromSample(200, 4.0))).toBe("14 / 15");
      for (const plan of [fromSample(80, 0), fromSample(200, 2.5), fromSample(80, 4.0)]) {
        expect(decide(0, plan)).toBe("accept");
      }
    });

    it("labelling: 3 inner packs and 1 carton per size at Accept 0 / Reject 1, no defects, pass", () => {
      expect(limits(labelingPlan())).toBe("0 / 1");
      expect(decide(0, labelingPlan())).toBe("accept");
    });

    it("flags 80 and 200 as below the level I plan: 120,000 gloves need 200, over 500,000 need 500", () => {
      const sizes = [
        { size: "XS", cases: 60, sampled: 80, codeLetter: "L", n: 200 },
        { size: "S", cases: 850, sampled: 200, codeLetter: "N", n: 500 },
        { size: "M", cases: 560, sampled: 200, codeLetter: "N", n: 500 },
        { size: "L", cases: 60, sampled: 80, codeLetter: "L", n: 200 },
      ];
      for (const { size, cases, sampled, codeLetter, n } of sizes) {
        const plan = lotSample(cases * 2_000, "I", sampled);
        expect(plan, size).toMatchObject({ codeLetter, n, sampleSize: sampled });
        expect(codes(plan), size).toEqual(["sample_below_plan"]);
      }
      expect(lotSample(120_000, "I", 80).warnings[0].message).toBe(
        "Inspection level I needs a sample of 200 (code letter L) for a lot of 120,000, but the sample is 80.",
      );
    });
  });

  // Size M only: 2,900 cases of 2,000 gloves; 500 gloves for watertight and visual.
  describe("STD_EG", () => {
    it("watertight: n 500 is code N, limit 14 / 15 (the report printed K, L & M and 10 / 11); 1 hole passes", () => {
      const plan = fromSample(500, 1.5);
      expect(plan).toMatchObject({ codeLetter: "N", usedLetter: "N", ac: 14, re: 15 });
      expect(decide(1, plan)).toBe("accept");
    });

    it("major at AQL 2.5: limit 21 / 22 (the report printed 14 / 15); 8 defects pass", () => {
      const plan = fromSample(500, 2.5);
      expect(limits(plan)).toBe("21 / 22");
      expect(decide(8, plan)).toBe("accept");
    });

    it("minor at AQL 4.0: code N follows the arrow to code M, limit 21 / 22; none found passes", () => {
      const plan = fromSample(500, 4.0);
      expect(plan).toMatchObject({ codeLetter: "N", usedLetter: "M", arrow: "up", ac: 21, re: 22 });
      expect(decide(0, plan)).toBe("accept");
    });

    it("critical: limit 0 / 1, none found passes", () => {
      const plan = fromSample(500, 0);
      expect(limits(plan)).toBe("0 / 1");
      expect(decide(0, plan)).toBe("accept");
    });

    it("labelling: 3 dispenser boxes and 1 carton, no defects, pass", () => {
      expect(decide(0, labelingPlan())).toBe("accept");
    });

    it("samples exactly what level I asks for 5,800,000 gloves: no warning", () => {
      expect(lotSample(2_900 * 2_000, "I", 500)).toMatchObject({ codeLetter: "N", n: 500, warnings: [] });
    });
  });
});

describe("planFromSampleSize", () => {
  it("reads a non-standard sample as the largest standard size below it, with a warning", () => {
    const plan = fromSample(100, 2.5);
    expect(plan).toMatchObject({ codeLetter: "J", usedLetter: "J", n: 80, ac: 5, re: 6, sampleSize: 100 });
    expect(plan.warnings).toEqual([
      {
        code: "nonstandard_sample",
        message:
          "100 is not a standard sample size, so it is read as code letter J (n 80), the largest standard sample size below it.",
      },
    ]);
    expect(fromSample(60, 1.5)).toMatchObject({ codeLetter: "H", n: 50, ac: 2, re: 3 });
    expect(fromSample(2_500, 1.5)).toMatchObject({ codeLetter: "R", usedLetter: "P", ac: 21, re: 22, arrow: "up" });
    expect(codes(fromSample(2_500, 1.5))).toEqual(["nonstandard_sample"]);
  });

  it("does not warn on a standard sample size", () => {
    for (const sampleSize of [2, 3, 5, 8, 13, 20, 32, 50, 80, 125, 200, 315, 500, 800, 1_250, 2_000]) {
      expect(codes(fromSample(sampleSize, 0)), `n ${sampleSize}`).toEqual([]);
    }
  });

  it("flags an arrow down as a sample too small for the AQL, with the plan it needs", () => {
    const plan = fromSample(8, 4.0);
    expect(plan).toMatchObject({ codeLetter: "D", usedLetter: "E", n: 13, ac: 1, re: 2, arrow: "down" });
    expect(plan.warnings).toEqual([
      {
        code: "sample_too_small",
        message:
          "A sample of 8 is too small for AQL 4.0: the arrow at code letter D points down to code letter E, which needs 13 (Accept 1, Reject 2).",
      },
    ]);
    expect(codes(fromSample(10, 4.0))).toEqual(["nonstandard_sample", "sample_too_small"]);
    expect(fromSample(2, 0.01)).toMatchObject({ usedLetter: "Q", n: 1_250, ac: 0, re: 1, arrow: "down" });
    expect(fromSample(2, 0.01).warnings[0].message).toContain("which needs 1,250");
  });

  it("follows an arrow up without a warning", () => {
    expect(fromSample(3, 6.5)).toMatchObject({ codeLetter: "B", usedLetter: "A", n: 2, ac: 0, re: 1, warnings: [] });
  });

  it("rejects a sample below 2 or not a whole number", () => {
    for (const sampleSize of [1, 0, -3, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(planFromSampleSize({ sampleSize, aql: 1.5 }), `n ${sampleSize}`).toEqual({
        ok: false,
        error: { code: "invalid_sample_size", message: "Sample size must be a whole number of at least 2." },
      });
    }
  });

  it("rejects an AQL that is not in Table 2-A", () => {
    for (const aql of [3, 0.5, -1, Number.NaN, "1.5"]) {
      const result = planFromSampleSize({ sampleSize: 80, aql: aql as Aql });
      expect(result.ok ? null : result.error.code, `AQL ${aql}`).toBe("invalid_aql");
    }
    const result = planFromSampleSize({ sampleSize: 80, aql: 3 as Aql });
    expect(result.ok ? null : result.error.message).toBe(
      "AQL 3 is not in ISO 2859-1 Table 2-A. Use 0 for critical defects or a Table 2-A AQL from 0.010 to 1000.",
    );
  });

  it("returns JSON-safe plans that SampleSizePlanSchema accepts", () => {
    for (const plan of [fromSample(80, 1.5), fromSample(500, 4.0), fromSample(10, 4.0), fromSample(100, 0)]) {
      const copy = JSON.parse(JSON.stringify(plan));
      expect(copy).toEqual(plan);
      expect(SampleSizePlanSchema.parse(copy)).toEqual(plan);
    }
  });
});

describe("planFromLotSize and sampleSizeFromLotSize", () => {
  it("do not warn when the sample is at or above the plan", () => {
    expect(lotSample(120_000, "I", 200).warnings).toEqual([]);
    expect(lotSample(120_000, "I", 315).warnings).toEqual([]);
    expect(lotSample(120_000, "I").warnings).toEqual([]);
    expect(fromLot(120_000, "I", 1.5, 200).warnings).toEqual([]);
  });

  it("compare the sample with the plan after following arrows", () => {
    // Lot 100 at level I is code D (n 8): AQL 2.5 points up to C (n 5), AQL 4.0 down to E (n 13).
    expect(fromLot(100, "I", 2.5, 5).warnings).toEqual([]);
    expect(fromLot(100, "I", 4.0)).toMatchObject({ sampleSize: null, warnings: [] });
    expect(fromLot(100, "I", 4.0, 8).warnings).toEqual([
      {
        code: "sample_below_plan",
        message: "Inspection level I at AQL 4.0 needs a sample of 13 (code letter E) for a lot of 100, but the sample is 8.",
      },
    ]);
  });

  it("ask for every item when the plan's sample is not smaller than the lot", () => {
    // Lot 8 at level III is code B; AQL 0.65 points down to F, n 20.
    const plan = fromLot(8, "III", 0.65);
    expect(plan).toMatchObject({ codeLetter: "B", usedLetter: "F", n: 20, ac: 0, re: 1 });
    expect(plan.warnings).toEqual([
      {
        code: "sample_exceeds_lot",
        message: "The plan's sample of 20 (code letter F) is not smaller than the lot of 8: inspect every item.",
      },
    ]);
    expect(codes(fromLot(8, "III", 0.65, 8))).toEqual(["sample_exceeds_lot"]);
    expect(fromLot(8, "III", 0.65, 5).warnings[0]).toEqual({
      code: "sample_below_plan",
      message: "Inspection level III at AQL 0.65 needs every item for a lot of 8, but the sample is 5.",
    });
    expect(codes(lotSample(2, "III"))).toEqual(["sample_exceeds_lot"]);
  });

  it("accept a sample of 0 or 1 to compare with the plan", () => {
    expect(codes(lotSample(5_000, "I", 0))).toEqual(["sample_below_plan"]);
    expect(codes(lotSample(5_000, "I", 1))).toEqual(["sample_below_plan"]);
  });

  it("reject a lot below 2, an unknown level, an AQL not in Table 2-A or a bad sample", () => {
    const errorCode = (result: AqlResult<unknown>) => (result.ok ? null : result.error.code);
    for (const lotSize of [1, 0, 2.5, Number.NaN]) {
      expect(errorCode(sampleSizeFromLotSize({ lotSize, level: "I" }))).toBe("invalid_lot_size");
      expect(errorCode(planFromLotSize({ lotSize, level: "I", aql: 1.5 }))).toBe("invalid_lot_size");
    }
    const level = "IV" as InspectionLevel;
    expect(sampleSizeFromLotSize({ lotSize: 5_000, level })).toEqual({
      ok: false,
      error: { code: "invalid_level", message: "Inspection level must be S-1, S-2, S-3, S-4, I, II or III." },
    });
    expect(errorCode(planFromLotSize({ lotSize: 5_000, level: "I", aql: 3 as Aql }))).toBe("invalid_aql");
    for (const sampleSize of [-1, 2.5, Number.NaN]) {
      expect(errorCode(sampleSizeFromLotSize({ lotSize: 5_000, level: "I", sampleSize }))).toBe("invalid_sample_size");
    }
  });

  it("return JSON-safe plans that LotSizePlanSchema and LotSampleSchema accept", () => {
    for (const plan of [fromLot(100, "I", 4.0, 8), fromLot(5_800_000, "I", 0), fromLot(8, "III", 0.65)]) {
      const copy = JSON.parse(JSON.stringify(plan));
      expect(copy).toEqual(plan);
      expect(LotSizePlanSchema.parse(copy)).toEqual(plan);
    }
    for (const plan of [lotSample(120_000, "I", 80), lotSample(5_000, "S-3")]) {
      const copy = JSON.parse(JSON.stringify(plan));
      expect(copy).toEqual(plan);
      expect(LotSampleSchema.parse(copy)).toEqual(plan);
    }
  });
});

describe("planMatchesSample and planMatchesLot (BUILD_SPEC 6.2 rule 8)", () => {
  it("match the engine's plans, also after a JSON round trip", () => {
    for (const plan of [fromSample(80, 1.5), fromSample(500, 4.0), fromSample(10, 4.0), fromSample(100, 0)]) {
      expect(planMatchesSample(SampleSizePlanSchema.parse(JSON.parse(JSON.stringify(plan))))).toBe(true);
    }
    for (const plan of [fromLot(100, "I", 4.0, 8), fromLot(5_800_000, "I", 0), fromLot(8, "III", 0.65)]) {
      expect(planMatchesLot(LotSizePlanSchema.parse(JSON.parse(JSON.stringify(plan))))).toBe(true);
    }
  });

  it("refuse a plan the schema accepts but the tables do not give", () => {
    const tampered = { codeLetter: "J", usedLetter: "R", n: 80, aql: 1.5, ac: 44, re: 45, arrow: null, sampleSize: 500, warnings: [] };
    expect(planMatchesSample(SampleSizePlanSchema.parse(tampered))).toBe(false);

    const plan = fromSample(500, 4.0);
    const edits: Partial<SampleSizePlan>[] = [
      { codeLetter: "M" },
      { usedLetter: "N" },
      { n: 500 },
      { ac: 14, re: 15 },
      { arrow: null },
      { aql: 2.5 },
      { sampleSize: 315 },
    ];
    for (const edit of edits) expect(planMatchesSample({ ...plan, ...edit }), JSON.stringify(edit)).toBe(false);
    // Warnings are messages, recomputed with the plan.
    expect(planMatchesSample({ ...plan, warnings: [] })).toBe(true);
  });

  it("refuse a plan left over after the sample size or AQL was edited", () => {
    const plan = fromSample(80, 1.5);
    expect(planMatchesSample(plan, { sampleSize: 80, aql: 1.5 })).toBe(true);
    expect(planMatchesSample(plan, { sampleSize: 200, aql: 1.5 })).toBe(false);
    expect(planMatchesSample(plan, { sampleSize: 80, aql: 2.5 })).toBe(false);
    expect(planMatchesSample(plan, { sampleSize: 1, aql: 1.5 })).toBe(false);
  });

  it("refuse a lot plan the tables do not give for its own lot, level and AQL", () => {
    const plan = fromLot(100, "I", 4.0, 8);
    const edits: Partial<LotSizePlan>[] = [{ lotSize: 5_000 }, { level: "II" }, { aql: 2.5 }, { usedLetter: "D", n: 8, ac: 0, re: 1 }];
    for (const edit of edits) expect(planMatchesLot({ ...plan, ...edit }), JSON.stringify(edit)).toBe(false);
  });

  it("refuse a lot plan made for another lot, level or sample than the module's", () => {
    const plan = fromLot(100, "I", 4.0, 8);
    const lot = { lotSize: 100, level: "I", aql: 4.0, sampleSize: 8 } as const;
    expect(planMatchesLot(plan, lot)).toBe(true);
    // A plan whose sample was changed to 13 is what the tables give for 13, but not for the 8 entered.
    expect(planMatchesLot({ ...plan, sampleSize: 13 })).toBe(true);
    expect(planMatchesLot({ ...plan, sampleSize: 13 }, lot)).toBe(false);
    expect(planMatchesLot(plan, { ...lot, sampleSize: null })).toBe(false);
    expect(planMatchesLot(plan, { ...lot, level: "S-1" })).toBe(false);
    expect(planMatchesLot(plan, { ...lot, lotSize: 1 })).toBe(false);
  });
});
