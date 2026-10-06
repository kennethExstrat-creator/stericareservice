import { describe, expect, it } from "vitest";
import { filledData, TEST_ADMIN_ID, TEST_META, TEST_REGISTRY, testTemplate } from "./__fixtures__/capture";
import { evaluateCapture, type CaptureMeta } from "./evaluate";
import { finalResultOf, mirroredColumns, remarksOf } from "./mirror";

function columnsFor(data = filledData(), meta: CaptureMeta = TEST_META) {
  return mirroredColumns(evaluateCapture({ template: testTemplate(), overrides: {}, data, meta }, TEST_REGISTRY));
}

describe("mirroredColumns", () => {
  it("copies the PO, the product and every ordered size's lots from the data", () => {
    expect(columnsFor()).toMatchObject({
      po_no: "PO-0001",
      product_name: "Nitrile gloves",
      lot_numbers: ["LOT-M-0001", "LOT-M-0002", "LOT-L-0001"],
    });
  });

  it("clears the PO and product when the header is blank, and has no lots before the order", () => {
    expect(columnsFor({ modules: {}, custom: {} })).toMatchObject({ po_no: null, product_name: null, lot_numbers: [] });
  });

  it("keeps the row's inspection date when the header has none, and never empties it", () => {
    expect(columnsFor().inspection_date).toBe("2026-10-06");
    expect(columnsFor(filledData(), { ...TEST_META, inspectionDate: null })).not.toHaveProperty("inspection_date");
  });

  it("writes the suggested result over the included modules", () => {
    // Packing and weight are not done: hold.
    expect(columnsFor().suggested_result).toBe("hold");
  });

  it("follows switched-off modules in the suggestion", () => {
    const data = filledData();
    const evaluation = evaluateCapture(
      {
        template: testTemplate(),
        overrides: {
          packing_config: { reason: "n/a", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" },
          weight: { reason: "n/a", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" },
        },
        data,
        meta: TEST_META,
      },
      TEST_REGISTRY,
    );
    // Only info modules are left: no module gave a verdict, still on hold, but not for packing or weight.
    expect(evaluation.report.suggested.notDone).not.toContain("packing_config");
    expect(mirroredColumns(evaluation).suggested_result).toBe("hold");
  });

  it("takes the final result from the conclusion: pass, fail, and hold from warn", () => {
    const withFinal = (finalResult: string | null) => {
      const data = filledData();
      return { ...data, modules: { ...data.modules, conclusion: { finalResult, remark: null } } };
    };
    expect(columnsFor(withFinal(null)).result).toBeNull();
    expect(columnsFor(withFinal("pass")).result).toBe("pass");
    expect(columnsFor(withFinal("fail")).result).toBe("fail");
    expect(columnsFor(withFinal("hold")).result).toBe("hold");
  });

  it("copies the conclusion's remark into remarks, trimmed, blank as empty", () => {
    const withRemark = (remark: string | null) => {
      const data = filledData();
      return { ...data, modules: { ...data.modules, conclusion: { finalResult: "pass", remark } } };
    };
    expect(columnsFor(withRemark("  Released after the recount. ")).remarks).toBe("Released after the recount.");
    expect(columnsFor(withRemark("   ")).remarks).toBeNull();
    expect(columnsFor(withRemark(null)).remarks).toBeNull();
    expect(columnsFor().remarks).toBeNull();
  });
});

describe("remarksOf", () => {
  it("has no remark while the conclusion holds none or is not there", () => {
    expect(remarksOf({ modules: [] })).toBeNull();
  });
});

describe("finalResultOf", () => {
  it("has no final result while the conclusion is a placeholder", () => {
    expect(
      finalResultOf({
        modules: [
          {
            key: "conclusion",
            title: "Conclusion",
            labels: {},
            config: {},
            data: null,
            hasData: true,
            comment: null,
            computed: {},
            result: { status: "pass", summary: "" },
            issues: [],
            stub: true,
          },
        ],
      }),
    ).toBeNull();
  });
});
