import { describe, expect, it } from "vitest";
import { batchDataChanges, createDataUpdater } from "@/components/qc/data-updater";
import { TENSILE_MEASURES } from "./config";
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

  it("lands a pasted block of averages whole, in one change, through the kit's updater (docs/CAPTURE_KIT.md)", () => {
    const changes: TensileData[] = [];
    const updater = createDataUpdater(emptyTensile(), (next) => changes.push(next));
    // The SAFEDON_EG example's averages, pasted into XS's first field: each field
    // stores its own value in reading order (XS tensile, XS elongation, S tensile, ...).
    const block = { XS: [34.18, 536], S: [32.99, 547], M: [34.03, 555], L: [33.17, 543] };
    batchDataChanges(() => {
      for (const [size, averages] of Object.entries(block)) {
        TENSILE_MEASURES.forEach((measure, index) =>
          updater.update((current) => withAverage(current, size, measure, averages[index])),
        );
      }
    });
    expect(changes).toHaveLength(1);
    expect(changes[0].sizes).toEqual({
      XS: { tensileStrength: 34.18, elongationAtBreak: 536 },
      S: { tensileStrength: 32.99, elongationAtBreak: 547 },
      M: { tensileStrength: 34.03, elongationAtBreak: 555 },
      L: { tensileStrength: 33.17, elongationAtBreak: 543 },
    });
  });

  it("keeps two changes made before the screen renders again", () => {
    const changes: TensileData[] = [];
    const updater = createDataUpdater(SAVED, (next) => changes.push(next));
    // Two fields of different sizes committed in one event (a blur as the size turns): neither is lost.
    updater.update((current) => withAverage(current, "XL", "elongationAtBreak", 552));
    updater.update((current) => withAverage(current, "XS", "tensileStrength", 34.2));
    expect(changes.at(-1)?.sizes).toEqual({
      XS: { tensileStrength: 34.2, elongationAtBreak: 536 },
      XL: { tensileStrength: 31.5, elongationAtBreak: 552 },
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
