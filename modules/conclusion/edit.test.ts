import { describe, expect, it } from "vitest";
import { isoDateOf, withDate, withFinalResult, withRemark, withSignature } from "./edit";
import { ConclusionDataSchema, emptyConclusion } from "./schema";
import { addStroke } from "./signature";

const SIGNATURE = addStroke(null, [10, 150, 60, 60]);

describe("conclusion edits", () => {
  it("date the conclusion today when the final result is chosen, and keep a date already set", () => {
    const chosen = withFinalResult(emptyConclusion(), "pass", "2025-04-12");
    expect(chosen).toEqual({ ...emptyConclusion(), finalResult: "pass", date: "2025-04-12" });
    expect(withFinalResult(chosen, "hold", "2025-04-13")).toEqual({ ...chosen, finalResult: "hold" });
    expect(ConclusionDataSchema.parse(chosen)).toEqual(chosen);
  });

  it("date it when signed too, and keep the date when the signature is cleared", () => {
    const signed = withSignature(emptyConclusion(), SIGNATURE, "2025-02-19");
    expect(signed).toEqual({ ...emptyConclusion(), signature: SIGNATURE, date: "2025-02-19" });
    expect(withSignature(signed, null, "2025-02-20")).toEqual({ ...signed, signature: null });
    expect(withSignature(emptyConclusion(), null, "2025-02-20").date).toBeNull();
  });

  it("take the remark as typed, blank as none", () => {
    expect(withRemark(emptyConclusion(), "Released.\nCartons resealed.").remark).toBe("Released.\nCartons resealed.");
    expect(withRemark(withRemark(emptyConclusion(), "x"), "  ").remark).toBeNull();
  });

  it("take dates from the picker only", () => {
    const dated = withDate(emptyConclusion(), "2025-04-12");
    expect(dated.date).toBe("2025-04-12");
    expect(withDate(dated, "").date).toBeNull();
    expect(withDate(dated, "12/04/2025")).toBe(dated);
    expect(withDate(dated, "2025-02-30")).toBe(dated);
  });

  it("read today in the device's calendar, not UTC", () => {
    expect(isoDateOf(new Date(2025, 3, 12, 23, 59))).toBe("2025-04-12");
    expect(isoDateOf(new Date(2025, 0, 1, 0, 1))).toBe("2025-01-01");
  });
});
