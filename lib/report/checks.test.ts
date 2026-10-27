// Results by Check and the conclusion's verdict (the design's page 1): a row per
// check the inspection judged, its criterion from the module's config, its
// result from the computed values, its status the module's own; the verdict
// worked out from them.
import { describe, expect, it } from "vitest";
import { checkRows, checksVerdict, type CheckRow } from "./checks";
import { makeSafedonExport, makeStdEgExport } from "./__fixtures__/exports";

const row = (check: string, status: CheckRow["status"]): CheckRow => ({
  key: check,
  moduleKey: "dimensions",
  check,
  criterion: null,
  result: null,
  status,
  failedSizes: [],
  sizesNote: null,
});

describe("checksVerdict", () => {
  it("says every check passed, for the sizes on the order", () => {
    const passed = ["Dimension", "Force at Break", "Watertight Test"].map((name) => row(name, "pass"));
    expect(checksVerdict(passed, ["S", "M", "L", "XL"])).toBe("All 3 checks passed for every size on the order: S, M, L and XL.");
    expect(checksVerdict(passed, ["M"])).toBe("All 3 checks passed for size M.");
    expect(checksVerdict(passed, [])).toBe("All 3 checks passed.");
    expect(checksVerdict([row("Dimension", "pass")], ["M"])).toBe("The check passed for size M.");
  });

  it("names the checks that failed, then those not done, then those with a warning", () => {
    const rows = [row("Dimension", "fail"), row("Force at Break", "not_done"), row("Weight", "warn"), row("Labeling", "fail"), row("Visual", "pass")];
    expect(checksVerdict(rows, ["M"])).toBe("2 of 5 checks failed: Dimension and Labeling. 1 is not done: Force at Break. Weight has a warning.");
    expect(checksVerdict([row("Physical Properties", "not_done"), row("Visual", "pass")], ["S", "M"])).toBe(
      "1 of 2 checks is not done: Physical Properties.",
    );
    expect(checksVerdict([row("Weight", "warn"), row("Visual", "pass"), row("Labeling", "warn")], ["M"])).toBe(
      "1 of 3 checks passed for size M; Weight and Labeling have warnings.",
    );
  });

  it("says so while nothing is judged", () => {
    expect(checksVerdict([], ["M"])).toBe("No checks are recorded yet.");
  });
});

describe("checkRows", () => {
  it("names physical properties, Safedon dispensing and both labelling levels in the template's words", () => {
    const rows = checkRows(makeSafedonExport());
    expect(rows.map((entry) => entry.key)).toEqual([
      "dimensions",
      "tensile",
      "watertight",
      "visual:critical",
      "visual:major",
      "visual:minor",
      "dispensing_safedon",
      "labeling",
    ]);
    expect(rows.find((entry) => entry.key === "tensile")).toMatchObject({
      check: "Physical Properties",
      criterion: "Tensile strength ≥ 14.00 MPa, elongation ≥ 500%; ASTM D6319",
      result: "Tensile strength 32.99–34.18 MPa, elongation 536–555%",
      // The lab report is not attached: not done, as the module says.
      status: "not_done",
    });
    expect(rows.find((entry) => entry.key === "dispensing_safedon")).toMatchObject({
      check: "Dispensing",
      criterion: "Defect rate ≤ 5%",
      result: "14 in 3,250 gloves (0.43%)",
      status: "pass",
    });
    expect(rows.find((entry) => entry.key === "labeling")?.criterion).toBe("Inner Boxes/Packs and Carton Boxes");
    // Four measures with limits: past two, the thicknesses are named together.
    expect(rows.find((entry) => entry.key === "dimensions")).toMatchObject({
      criterion: "Length ≥ 230 mm; Width to spec; Thickness to spec",
      result: "Average Length 241 to 243 mm",
    });
  });

  it("notes the sizes a check failed in, when it passed in the others", () => {
    const doc = makeSafedonExport();
    const dimensions = doc.modules.find((module) => module.key === "dimensions");
    if (!dimensions?.result.perSize) throw new Error("SAFEDON_EG's dimensions have no per-size results.");
    dimensions.result = { ...dimensions.result, status: "fail", perSize: { ...dimensions.result.perSize, S: { status: "fail" } } };
    expect(checkRows(doc).find((entry) => entry.key === "dimensions")).toMatchObject({ status: "fail", failedSizes: ["S"], sizesNote: "Failed for size S" });
    // Failed in every size on the order: no note, the status says it.
    for (const size of Object.keys(dimensions.result.perSize ?? {})) dimensions.result.perSize![size] = { status: "fail" };
    expect(checkRows(doc).find((entry) => entry.key === "dimensions")?.sizesNote).toBeNull();
  });

  it("lists a record only when it holds a problem, and a module that only records, never", () => {
    const doc = makeStdEgExport();
    expect(checkRows(doc).some((entry) => entry.moduleKey === "carton_sampling")).toBe(false);
    const cartons = doc.modules.find((module) => module.key === "carton_sampling");
    if (cartons) cartons.result = { ...cartons.result, status: "fail", summary: "Size M: box/carton number 686 is entered twice." };
    expect(checkRows(doc).find((entry) => entry.moduleKey === "carton_sampling")).toMatchObject({
      check: "Box/Carton Numbers",
      criterion: null,
      result: "Size M: box/carton number 686 is entered twice.",
      status: "fail",
    });
    const weight = doc.modules.find((module) => module.key === "weight");
    if (weight) weight.result = { ...weight.result, status: "info" };
    expect(checkRows(doc).some((entry) => entry.moduleKey === "weight")).toBe(false);
  });

  it("gives the packing check's aged sample a row of its own, judged on its own", () => {
    const doc = makeStdEgExport();
    const packing = doc.modules.find((module) => module.key === "dispensing_packing");
    if (!packing) throw new Error("STD_EG has no packing check.");
    const sizes = packing.computed.sizes as Record<string, Record<string, unknown>>;
    sizes.M = { ...sizes.M, agedSample: { layeringResult: "pass", dispensingResult: "fail", stickinessResult: "pass", result: "fail" } };
    const data = packing.data.sizes as Record<string, Record<string, unknown>>;
    data.M = { ...data.M, agedSample: { layeringPct: 89, dispensingPct: 75, stickiness: "B", note: null } };
    const aged = checkRows(doc).find((entry) => entry.key === "dispensing_packing:aged");
    expect(aged).toMatchObject({
      check: "Packing Check: Aged Sample",
      criterion: "Layering ≥ 70%, dispensing ≥ 80%",
      result: "Layering 89%, dispensing 75%",
      status: "fail",
    });
    // The boxes' own row stays as the boxes are.
    expect(checkRows(doc).find((entry) => entry.key === "dispensing_packing")?.status).toBe("pass");
  });

  it("reads an inspection with nothing ordered or entered without failing", () => {
    const doc = makeStdEgExport();
    for (const entry of doc.modules) {
      entry.data = {};
      entry.computed = {};
      entry.result = { status: entry.result.status === "info" ? "info" : "not_done", summary: "" };
    }
    const rows = checkRows(doc);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((entry) => entry.status === "not_done" && entry.result === null)).toBe(true);
  });
});
