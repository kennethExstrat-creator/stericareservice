// Both example reports through header, order_lots and packing_config, with
// the seed templates resolved as a seed saves them (lib/coverage): the rows
// of docs/examples/expected-results.md these modules give, and none of the
// errors or warnings, which all belong to other modules.
import { describe, expect, it } from "vitest";
import type { TemplateCode } from "@/lib/coverage";
import { buildInspectionContext, evaluateInspection, inspectionRowValues, type ModuleEvaluation } from "@/modules/_framework";
import { headerData, headerMeta } from "@/modules/header/__fixtures__/examples";
import { resolveSeedTemplate } from "@/modules/header/__fixtures__/templates";
import { packingData } from "@/modules/packing_config/__fixtures__/examples";
import { MODULE_REGISTRY } from "@/modules/registry";
import {
  SAFEDON_EG_EXAMPLE,
  SAFEDON_EG_EXPECTED,
  STD_EG_EXAMPLE,
  STD_EG_EXPECTED,
  type ExampleReport,
} from "@/tests/fixtures/examples";
import { orderData } from "./__fixtures__/examples";

const MINE = ["header", "order_lots", "packing_config"] as const;

function enter(example: ExampleReport) {
  const template = resolveSeedTemplate(example.template as TemplateCode, MINE);
  const data = {
    modules: {
      header: headerData(example.header),
      order_lots: orderData(example.order),
      packing_config: packingData(example.packing),
    },
    custom: {},
  };
  const context = buildInspectionContext({ template, data, meta: headerMeta(example.header) }, MODULE_REGISTRY);
  const evaluation = evaluateInspection({ template, data, context }, MODULE_REGISTRY);
  const evaluated = (key: (typeof MINE)[number]): ModuleEvaluation => {
    const found = evaluation.modules.find((entry) => entry.key === key);
    if (!found) throw new Error(`${key} is not in ${template.code}`);
    return found;
  };
  const ownIssues = evaluation.issues.filter((issue) => (MINE as readonly string[]).includes(issue.moduleKey));
  return { template, context, evaluated, ownIssues };
}

describe.each([
  { example: STD_EG_EXAMPLE, expected: STD_EG_EXPECTED },
  { example: SAFEDON_EG_EXAMPLE, expected: SAFEDON_EG_EXPECTED },
])("the $example.template example", ({ example, expected }) => {
  const { context, evaluated, ownIssues } = enter(example);

  it("totals the order as expected", () => {
    expect(evaluated("order_lots").computed).toMatchObject({
      totalCartons: expected.totals.cartons,
      totalGloves: expected.totals.gloves,
    });
  });

  it("orders exactly the sizes the report filled in", () => {
    expect(context.sizes).toEqual(example.sizesOrdered);
  });

  it("is info in all three modules, with no error or warning of their own", () => {
    for (const key of MINE) expect(evaluated(key).result.status).toBe("info");
    expect(ownIssues).toEqual([]);
    const theirs = [...expected.errors, ...expected.warnings].map((issue) => issue.module);
    expect(theirs.filter((key) => (MINE as readonly string[]).includes(key))).toEqual([]);
  });

  it("records the inspector and passes PO and lots to the inspection row", () => {
    expect(evaluated("header").computed).toMatchObject({ inspector: "Inspector A" });
    const row = inspectionRowValues(context);
    expect(row.po_no).toBe(example.header.po.printed);
    expect(row.lot_numbers).toEqual(Object.values(example.order.lines).flatMap((line) => line?.lots ?? []));
  });
});

describe("the template's own wording and settings", () => {
  it("prints SAFEDON_EG's dates as month and year and names its plastic packs", () => {
    const { evaluated } = enter(SAFEDON_EG_EXAMPLE);
    expect(evaluated("header").labels).toMatchObject({ poNo: "PO Number" });
    expect(evaluated("header").computed).toMatchObject({ mfgDate: "2025-02", expiryDate: "2030-01", client: "Client A" });
    expect(evaluated("packing_config").computed).toEqual({ glovesPerCaseCheck: 2000, innerUnit: "plastic pack" });
    expect(evaluated("order_lots").result.perSize?.XS?.summary).toBe(
      "Qty (cases) 60; Lot Number LOT-B01; Packing Site Packer C.",
    );
  });

  it("keeps STD_EG's full dates, inner boxes and one product code (expected results B)", () => {
    const { evaluated, context } = enter(STD_EG_EXAMPLE);
    expect(evaluated("header").computed).toMatchObject({ mfgDate: "2025-04-01", expiryDate: "2030-03-01" });
    expect(evaluated("packing_config").computed).toEqual({ glovesPerCaseCheck: 2000, innerUnit: "inner box" });
    expect(context.header.productCode).toBe(STD_EG_EXPECTED.productCode.code);
  });
});
