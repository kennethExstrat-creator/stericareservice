import { describe, expect, it } from "vitest";
import type { CustomModule } from "@/lib/schemas/template";
import { emptyCustomValues, evaluateCustomValues, type CustomEvaluationInput } from "./custom";

const humidity: CustomModule = {
  key: "warehouse",
  title: "Warehouse",
  after: "packing_config",
  layout: "fields",
  fields: [
    { key: "rh", label: "Relative humidity", type: "number", unit: "%", min: 0, max: 100, required: true },
    { key: "seal", label: "Seal", type: "select", options: ["Intact", "Broken"] },
    { key: "checked", label: "Checked", type: "yes_no" },
    { key: "po", label: "PO", type: "text", mapsTo: "modules.header.poNo", required: true },
  ],
};

const perSizeTable: CustomModule = {
  key: "dispensing_spec",
  title: "Specification / Requirement",
  after: "dispensing_safedon",
  layout: "table",
  fields: [
    { key: "requirement", label: "Specification / Requirement", type: "text", required: true },
    { key: "conclusion", label: "Conclusion", type: "select", options: ["Passed", "Failed"] },
  ],
};

const boxGrid: CustomModule = {
  key: "box_check",
  title: "Box check",
  after: "labeling",
  layout: "grid",
  fields: [{ key: "sealed", label: "Sealed", type: "yes_no", required: true }],
  grid: { repeatPer: "size", columns: { label: "Box #", default: 3, addable: false } },
};

function evaluate(input: Partial<CustomEvaluationInput> & Pick<CustomEvaluationInput, "custom">) {
  return evaluateCustomValues({ value: undefined, sizes: ["M"], readMapped: () => undefined, ...input });
}

describe("custom module values: fields layout", () => {
  it("starts empty", () => {
    expect(emptyCustomValues(humidity)).toEqual({ rh: null, seal: null, checked: null });
  });

  it("requires required fields and checks limits and options", () => {
    const { issues } = evaluate({ custom: humidity, value: { rh: 120, seal: "Torn" } });
    expect(issues.map((issue) => [issue.code, issue.path, issue.message])).toEqual([
      ["out_of_range", ["rh"], "Relative humidity: Must be 100 or less."],
      ["invalid_option", ["seal"], 'Seal: "Torn" is not one of Intact, Broken.'],
      ["required", ["po"], "PO is required."],
    ]);
    expect(evaluate({ custom: humidity }).issues.map((issue) => issue.code)).toEqual(["required", "required"]);
  });

  it("shows a mapped field's module value and keeps no copy (6.2 rule 10)", () => {
    const { values, issues } = evaluate({
      custom: humidity,
      value: { rh: 55, po: "typed again" },
      readMapped: (path) => (path === "modules.header.poNo" ? "PO-0001" : undefined),
    });
    expect(values).toEqual({ rh: 55, seal: null, checked: null, po: "PO-0001" });
    expect(issues).toEqual([
      expect.objectContaining({ level: "warning", code: "mapped_value_ignored", path: ["po"] }),
    ]);
  });

  it("rejects text where a number belongs (6.2 rule 1)", () => {
    const { values, issues } = evaluate({ custom: humidity, value: { rh: "2 42" } });
    expect(values).toEqual({});
    expect(issues).toEqual([expect.objectContaining({ level: "error", code: "invalid_data", path: ["rh"] })]);
  });
});

describe("custom module values: a table with a row per ordered size", () => {
  it("checks every ordered size and ignores the rest", () => {
    const { values, issues } = evaluate({
      custom: perSizeTable,
      sizes: ["S", "M"],
      value: { sizes: { m: { requirement: "≤ 5%", conclusion: "Passed" }, XL: { requirement: "≤ 5%" } } },
    });
    expect(values).toEqual({
      sizes: {
        S: { requirement: null, conclusion: null },
        M: { requirement: "≤ 5%", conclusion: "Passed" },
      },
    });
    expect(issues.map((issue) => [issue.level, issue.code, issue.size, issue.path])).toEqual([
      ["warning", "size_not_ordered", "XL", ["sizes", "XL"]],
      ["error", "required", "S", ["sizes", "S", "requirement"]],
    ]);
  });

  it("warns about a row saved under a second spelling of its size", () => {
    const { values, issues } = evaluate({
      custom: perSizeTable,
      value: { sizes: { M: { requirement: "≤ 5%" }, m: { requirement: "≤ 6%" } } },
    });
    expect(values).toEqual({ sizes: { M: { requirement: "≤ 5%", conclusion: null } } });
    expect(issues.map((issue) => [issue.code, issue.size, issue.path])).toEqual([["size_duplicate", "M", ["sizes", "m"]]]);
  });
});

describe("custom module values: a grid of boxes per size", () => {
  it("checks each column and the column limit", () => {
    const { values, issues } = evaluate({
      custom: boxGrid,
      value: { sizes: { M: { sealed: [true, null, false, true] } } },
    });
    expect(values).toEqual({ sizes: { M: { sealed: [true, null, false, true] } } });
    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ["too_many_columns", ["sizes", "M", "sealed"]],
      ["required", ["sizes", "M", "sealed", 1]],
    ]);
  });

  it("starts each size's grid empty", () => {
    expect(emptyCustomValues(boxGrid)).toEqual({ sizes: {} });
    const flat: CustomModule = { ...boxGrid, grid: { columns: { label: "Box #", default: 2, addable: true } } };
    expect(emptyCustomValues(flat)).toEqual({ sealed: [] });
    expect(evaluate({ custom: flat, value: { sealed: [true] } }).issues.map((issue) => issue.path)).toEqual([["sealed", 1]]);
  });
});
