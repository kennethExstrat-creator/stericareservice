import { describe, expect, it } from "vitest";
import { createDataUpdater } from "@/components/qc/data-updater";
import { richTextExample } from "@/lib/rich-text/__fixtures__/example";
import { isoDateOf, withDate, withFinalResult, withInspectionSummary, withRemark, withSignature } from "./edit";
import { ConclusionDataSchema, emptyConclusion, type ConclusionData } from "./schema";
import { addStroke, MAX_STROKES, type Signature, type SignatureChange } from "./signature";

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

  it("leave the data as it is when the signature does not change, as when the pad has no room left", () => {
    const signed = withSignature(emptyConclusion(), SIGNATURE, "2025-02-19");
    expect(withSignature(signed, signed.signature, "2025-02-20")).toBe(signed);
    let full: Signature | null = null;
    for (let index = 0; index < MAX_STROKES; index += 1) full = addStroke(full, [index, index]);
    const withFull = { ...emptyConclusion(), signature: full, date: "2025-02-19" };
    expect(withSignature(withFull, addStroke(full, [5, 5]), "2025-02-20")).toBe(withFull);
  });

  it("build on each other through the kit's updater, so edits in one event all survive", () => {
    // As Capture wires them (docs/CAPTURE_KIT.md): update((current) => ...), and the pad's
    // changes applied to the latest signature. Two strokes and a result chosen before the
    // screen renders again all land.
    const changes: ConclusionData[] = [];
    const updater = createDataUpdater(emptyConclusion(), (next) => changes.push(next));
    const fromPad = (change: SignatureChange) =>
      updater.update((current) => withSignature(current, change(current.signature), "2025-04-12"));
    fromPad((signature) => addStroke(signature, [10, 150, 60, 60]));
    updater.update((current) => withFinalResult(current, "pass", "2025-04-13"));
    fromPad((signature) => addStroke(signature, [80, 120, 140, 100]));
    updater.update((current) => withRemark(current, "Released."));
    updater.update((current) => withInspectionSummary(current, richTextExample()));
    expect(changes.at(-1)).toEqual({
      finalResult: "pass",
      remark: "Released.",
      inspectionSummary: richTextExample(),
      date: "2025-04-12",
      signature: { width: 600, height: 200, strokes: [[10, 150, 60, 60], [80, 120, 140, 100]] },
    });
  });

  it("take the remark as typed, blank as none", () => {
    expect(withRemark(emptyConclusion(), "Released.\nCartons resealed.").remark).toBe("Released.\nCartons resealed.");
    expect(withRemark(withRemark(emptyConclusion(), "x"), "  ").remark).toBeNull();
  });

  it("take the summary as the editor hands it over, and clear it with null", () => {
    const written = withInspectionSummary(emptyConclusion(), richTextExample());
    expect(written).toEqual({ ...emptyConclusion(), inspectionSummary: richTextExample() });
    expect(ConclusionDataSchema.parse(written)).toEqual(written);
    expect(withInspectionSummary(written, null)).toEqual(emptyConclusion());
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
