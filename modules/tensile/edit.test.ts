import { describe, expect, it } from "vitest";
import { withAverage, withLabReport } from "./edit";
import { emptyTensile, TensileDataSchema, type TensileData } from "./schema";

const LAB_REPORT_ID = "00000000-0000-4000-8000-000000000402";

const SAVED: TensileData = {
  sizes: { XS: { tensileStrength: 34.18, elongationAtBreak: 536 }, XL: { tensileStrength: 31.5, elongationAtBreak: null } },
  labReport: null,
};

describe("tensile edits", () => {
  it("sets one average of one size, keeping the other average and every other size", () => {
    expect(withAverage(SAVED, "XS", "elongationAtBreak", 540)).toEqual({
      sizes: { XS: { tensileStrength: 34.18, elongationAtBreak: 540 }, XL: { tensileStrength: 31.5, elongationAtBreak: null } },
      labReport: null,
    });
    expect(withAverage(SAVED, "XS", "tensileStrength", null).sizes.XS).toEqual({ tensileStrength: null, elongationAtBreak: 536 });
    expect(SAVED.sizes.XS.elongationAtBreak).toBe(536);
  });

  it("starts a size that has nothing saved yet", () => {
    expect(withAverage(emptyTensile(), "M", "tensileStrength", 34.03).sizes).toEqual({
      M: { tensileStrength: 34.03, elongationAtBreak: null },
    });
  });

  it("attaches and detaches the lab report by its file id", () => {
    const attached = withLabReport(SAVED, LAB_REPORT_ID);
    expect(attached.labReport).toBe(LAB_REPORT_ID);
    expect(attached.sizes).toBe(SAVED.sizes);
    expect(withLabReport(attached, null).labReport).toBeNull();
  });

  it("always gives data the schema accepts", () => {
    for (const next of [withAverage(SAVED, "S", "tensileStrength", 32.99), withLabReport(SAVED, LAB_REPORT_ID)]) {
      expect(TensileDataSchema.parse(next)).toEqual(next);
    }
  });
});
