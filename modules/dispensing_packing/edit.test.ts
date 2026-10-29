import { describe, expect, it } from "vitest";
import {
  agedSampleAnswerOf,
  agedSampleOf,
  boxesOf,
  rowsShown,
  setAgedSampleAnswer,
  updateAgedSample,
  updatePackingBox,
  withoutTrailingBlanks,
} from "./edit";
import { DispensingPackingDataSchema, emptyAgedSample, emptyPackingBox, type DispensingPackingData } from "./schema";

const A = { ...emptyPackingBox(), boxNo: 13, layeringPct: 90, dispensingPct: 92, stickiness: "A" };

describe("dispensing_packing editing", () => {
  it("shows the planned rows, more when more are saved or asked for, at most the cap", () => {
    expect(rowsShown(13, 0)).toBe(13);
    expect(rowsShown(13, 15)).toBe(15);
    expect(rowsShown(5, 3, 7)).toBe(7);
    expect(rowsShown(5, 7, 6)).toBe(7);
    expect(rowsShown(0, 0)).toBe(0);
    expect(rowsShown(2000, 0)).toBe(500);
  });

  it("changes one row and creates the rows before it blank", () => {
    const data: DispensingPackingData = { sizes: {} };
    const next = updatePackingBox(data, "M", 2, { layeringPct: 88 });
    expect(boxesOf(next, "M")).toEqual([emptyPackingBox(), emptyPackingBox(), { ...emptyPackingBox(), layeringPct: 88 }]);
    expect(data).toEqual({ sizes: {} });
    expect(DispensingPackingDataSchema.parse(next)).toEqual(next);
  });

  it("keeps the other rows and sizes, a size no longer ordered included", () => {
    const data: DispensingPackingData = { sizes: { M: { boxes: [A, A] }, XL: { boxes: [A] } } };
    const next = updatePackingBox(data, "M", 1, { stickiness: "D" });
    expect(next.sizes.M.boxes).toEqual([A, { ...A, stickiness: "D" }]);
    expect(next.sizes.XL).toBe(data.sizes.XL);
  });

  it("drops blank rows at the end, so an emptied row is not saved", () => {
    const data: DispensingPackingData = { sizes: { M: { boxes: [A, { ...emptyPackingBox(), note: "torn" }] } } };
    expect(updatePackingBox(data, "M", 1, { note: null }).sizes.M.boxes).toEqual([A]);
    expect(updatePackingBox(data, "M", 0, { boxNo: null, layeringPct: null, dispensingPct: null, stickiness: null }).sizes.M.boxes)
      .toEqual([emptyPackingBox(), { ...emptyPackingBox(), note: "torn" }]);
    expect(withoutTrailingBlanks([emptyPackingBox(), A, emptyPackingBox()])).toEqual([emptyPackingBox(), A]);
    expect(updatePackingBox({ sizes: {} }, "S", 4, {})).toEqual({ sizes: { S: { boxes: [] } } });
  });

  it("keeps a size's aged sample when a box row changes", () => {
    const aged = { ...emptyAgedSample(), layeringPct: 88 };
    const data: DispensingPackingData = { sizes: { M: { boxes: [A], agedSample: aged } } };
    expect(updatePackingBox(data, "M", 1, { layeringPct: 90 }).sizes.M).toEqual({ boxes: [A, { ...emptyPackingBox(), layeringPct: 90 }], agedSample: aged });
  });
});

describe("dispensing_packing aged sample editing (Kenneth, 26 October 2026)", () => {
  it("changes the size's aged sample, never a box, creating the size when it has none yet", () => {
    const next = updateAgedSample({ sizes: {} }, "S", { layeringPct: 88 });
    // The first value answers "Aged Sample?" Yes (Kenneth, 30 October 2026).
    expect(next).toEqual({ hasAgedSample: "yes", sizes: { S: { boxes: [], agedSample: { ...emptyAgedSample(), layeringPct: 88 } } } });
    expect(DispensingPackingDataSchema.parse(next)).toEqual(next);
    expect(agedSampleOf(next, "S")).toEqual({ ...emptyAgedSample(), layeringPct: 88 });
    expect(agedSampleOf(next, "M")).toEqual(emptyAgedSample());
  });

  it("keeps the size's boxes and the other sizes, and adds to what the aged sample holds", () => {
    const data: DispensingPackingData = {
      sizes: { M: { boxes: [A], agedSample: { ...emptyAgedSample(), layeringPct: 88 } }, XL: { boxes: [A] } },
    };
    const next = updateAgedSample(data, "M", { stickiness: "B" });
    expect(next.sizes.M).toEqual({ boxes: [A], agedSample: { ...emptyAgedSample(), layeringPct: 88, stickiness: "B" } });
    expect(next.sizes.M.boxes).toBe(data.sizes.M.boxes);
    expect(next.sizes.XL).toBe(data.sizes.XL);
  });

  it("saves no aged sample once nothing is left in it", () => {
    const data: DispensingPackingData = { sizes: { M: { boxes: [A], agedSample: { ...emptyAgedSample(), note: "Aged sample" } } } };
    expect(updateAgedSample(data, "M", { note: null })).toEqual({ sizes: { M: { boxes: [A] } } });
    expect(updateAgedSample({ sizes: {} }, "S", { note: " " })).toEqual({ sizes: { S: { boxes: [] } } });
  });
});

describe('dispensing_packing "Aged Sample?" (Kenneth, 30 October 2026)', () => {
  const aged = { ...emptyAgedSample(), layeringPct: 88 };

  it("answers it for the whole step, every size's aged sample kept as saved, and clears it with null", () => {
    const data: DispensingPackingData = { sizes: { M: { boxes: [A], agedSample: aged }, XL: { boxes: [A] } } };
    expect(agedSampleAnswerOf(data)).toBeNull();
    const no = setAgedSampleAnswer(data, "no");
    expect(no).toEqual({ hasAgedSample: "no", sizes: data.sizes });
    expect(no.sizes).toBe(data.sizes);
    expect(agedSampleAnswerOf(no)).toBe("no");
    expect(DispensingPackingDataSchema.parse(no)).toEqual(no);
    expect(setAgedSampleAnswer(no, "yes")).toEqual({ hasAgedSample: "yes", sizes: data.sizes });
    // Unanswered again: no answer saved, as before the question.
    expect(setAgedSampleAnswer(no, null)).toEqual(data);
    expect(agedSampleAnswerOf({ hasAgedSample: null, sizes: {} })).toBeNull();
  });

  it("is answered Yes by a value entered while unanswered, never over an answer, and never by an empty one", () => {
    expect(updateAgedSample({ sizes: {} }, "M", { stickiness: "B" }).hasAgedSample).toBe("yes");
    expect(updateAgedSample({ hasAgedSample: null, sizes: {} }, "M", { note: "Aged sample" }).hasAgedSample).toBe("yes");
    expect(updateAgedSample({ hasAgedSample: "no", sizes: {} }, "M", { layeringPct: 88 }).hasAgedSample).toBe("no");
    expect(updateAgedSample({ sizes: {} }, "M", { note: " " })).toEqual({ sizes: { M: { boxes: [] } } });
    // Emptied, the answer stays: the step has one.
    const data: DispensingPackingData = { hasAgedSample: "yes", sizes: { M: { boxes: [], agedSample: aged } } };
    expect(updateAgedSample(data, "M", { layeringPct: null })).toEqual({ hasAgedSample: "yes", sizes: { M: { boxes: [] } } });
  });
});
