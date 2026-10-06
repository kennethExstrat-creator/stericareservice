import { describe, expect, it } from "vitest";
import { ExportIssueSchema } from "@/lib/schemas";
import { decide } from "./decision";
import { planFromSampleSize, type AqlResult } from "./plan";
import {
  AcceptanceLimitsSchema,
  AqlSchema,
  CodeLetterSchema,
  DecisionSchema,
  InspectionLevelSchema,
  StandardSampleSizeSchema,
} from "./schema";
import { TABLE_2A_AQLS } from "./tables";

function planOf<T>(result: AqlResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.plan;
}

const accepts = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe("AqlSchema", () => {
  it("accepts 0 and every Table 2-A AQL", () => {
    for (const aql of [0, ...TABLE_2A_AQLS]) expect(accepts(AqlSchema, aql), `AQL ${aql}`).toBe(true);
  });

  it("rejects any other value", () => {
    for (const value of [3, 0.5, 0.0101, -1, Number.NaN, "1.5", null]) {
      expect(accepts(AqlSchema, value), `${String(value)}`).toBe(false);
    }
  });
});

describe("InspectionLevelSchema", () => {
  it("accepts the seven levels of Table 1 only", () => {
    for (const level of ["S-1", "S-2", "S-3", "S-4", "I", "II", "III"]) expect(accepts(InspectionLevelSchema, level)).toBe(true);
    for (const level of ["IV", "i", "S1", "S-5", ""]) expect(accepts(InspectionLevelSchema, level)).toBe(false);
  });
});

describe("CodeLetterSchema", () => {
  it("leaves out I, O and S", () => {
    expect(accepts(CodeLetterSchema, "J")).toBe(true);
    for (const letter of ["I", "O", "S", "a"]) expect(accepts(CodeLetterSchema, letter)).toBe(false);
  });
});

describe("StandardSampleSizeSchema", () => {
  it("accepts Table 2-A sample sizes only", () => {
    expect(accepts(StandardSampleSizeSchema, 80)).toBe(true);
    expect(accepts(StandardSampleSizeSchema, 100)).toBe(false);
  });
});

describe("AcceptanceLimitsSchema", () => {
  it("holds a single sampling plan: whole numbers with Re = Ac + 1", () => {
    expect(accepts(AcceptanceLimitsSchema, { ac: 0, re: 1 })).toBe(true);
    expect(accepts(AcceptanceLimitsSchema, { ac: 21, re: 22 })).toBe(true);
    for (const limits of [{ ac: 3, re: 5 }, { ac: -1, re: 0 }, { ac: 1.5, re: 2.5 }, { ac: 1 }]) {
      expect(accepts(AcceptanceLimitsSchema, limits), JSON.stringify(limits)).toBe(false);
    }
  });
});

describe("DecisionSchema", () => {
  it("holds what decide returns", () => {
    expect(DecisionSchema.options).toEqual(["accept", "reject", "incomplete"]);
    const short = planOf(planFromSampleSize({ sampleSize: 8, aql: 4.0 }));
    for (const defects of [0, 2]) expect(DecisionSchema.parse(decide(defects, short))).toBe(decide(defects, short));
  });
});

describe("warnings", () => {
  it("pass as export issues", () => {
    const result = planFromSampleSize({ sampleSize: 10, aql: 4.0 });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.plan.warnings).toHaveLength(2);
    for (const warning of result.plan.warnings) expect(ExportIssueSchema.parse(warning)).toEqual(warning);
  });
});
