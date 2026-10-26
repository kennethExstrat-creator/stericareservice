// Values saved for a size the order does not list (Kenneth, 27 October 2026:
// "why is the carton number not being auto filled?"): the sizes a step names,
// how its notice words them, where Open Order lands, and what a reading's
// message says. The notice's markup is in capture-parts.test.tsx.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { issuePathKey } from "@/components/qc/issue-path";
import { applyProposals, filledMessage } from "@/lib/inspections/source-documents";
import type { ResolvedModule } from "@/lib/schemas/template";
import { MODULE_REGISTRY } from "@/modules";
import { buildInspectionContext, evaluateInspection, evaluationOf, type InspectionData } from "@/modules/_framework";
import { makeTestTemplate } from "@/modules/_framework/testing";
import { definition as orderLots } from "@/modules/order_lots";
import OrderCapture from "@/modules/order_lots/Capture";
import { filledData, SIZE_TABLE, TEST_META, TEST_REGISTRY, testTemplate } from "./__fixtures__/capture";
import { evaluateCapture } from "./evaluate";
import {
  filledNotOrdered,
  notOrderedMessage,
  notOrderedNote,
  ORDER_KEY,
  orderSizePath,
  sizesNotOrdered,
} from "./not-ordered";

/** Placeholders (docs/FIXTURES.md): size L's 50 sampled box/carton numbers, as a spreadsheet lists them. */
const CARTONS = Array.from({ length: 50 }, (_, index) => 1001 + index * 7);
/** One glove's dimensions in mm; the spreadsheet gives 13. */
const GLOVE = { length: 240, width: 95, fingerThickness: 0.1, palmThickness: 0.08, cuffThickness: 0.06 };

const template = makeTestTemplate(MODULE_REGISTRY, ["order_lots", "carton_sampling", "dimensions"]);
const included = new Set(["order_lots", "carton_sampling", "dimensions"]);

/** What Steri-AI read from the spreadsheet: size L's box/carton numbers and 13 gloves' dimensions, no quantities. */
const SHEET = {
  carton_sampling: { sizes: { L: { cartonNumbers: CARTONS } } },
  dimensions: { sizes: { L: { gloves: Array.from({ length: 13 }, () => GLOVE) } } },
};

/** The sheet's values filled in, with the order as given. */
function filled(order: Record<string, unknown> = { sizes: {} }): InspectionData {
  return { modules: { order_lots: order, ...SHEET }, custom: {} };
}

const issuesOf = (data: InspectionData) =>
  evaluateCapture({ template, overrides: {}, data, meta: TEST_META }, MODULE_REGISTRY).report.issues;

describe("sizesNotOrdered (the sizes a step's notice names)", () => {
  it("names the size a step holds values for while the order does not list it, in each step", () => {
    const data = filled();
    const issues = issuesOf(data);
    expect(sizesNotOrdered(issues, "carton_sampling", data.modules.carton_sampling)).toEqual(["L"]);
    expect(sizesNotOrdered(issues, "dimensions", data.modules.dimensions)).toEqual(["L"]);
    // The order itself shows every size the template offers.
    expect(sizesNotOrdered(issues, ORDER_KEY, data.modules.order_lots)).toEqual([]);
  });

  it("names none once the size is ordered", () => {
    const data = filled({ sizes: { L: { qtyCases: 120, lotNumbers: ["LOT-L-0001"] } } });
    const issues = issuesOf(data);
    expect(sizesNotOrdered(issues, "carton_sampling", data.modules.carton_sampling)).toEqual([]);
    expect(sizesNotOrdered(issues, "dimensions", data.modules.dimensions)).toEqual([]);
  });

  it("names a size switched off on the order too: it is not ordered, whatever its line holds", () => {
    const data = filled({ sizes: { L: { qtyCases: 120, lotNumbers: [] } }, sizesOff: ["L"] });
    expect(sizesNotOrdered(issuesOf(data), "carton_sampling", data.modules.carton_sampling)).toEqual(["L"]);
  });

  it("names them for a custom module's table as for a module", () => {
    // filledData orders M and L.
    const data = { ...filledData(), custom: { [SIZE_TABLE.key]: { sizes: { M: { requirement: "Met" }, XL: { requirement: "Met" } } } } };
    const { report } = evaluateCapture({ template: testTemplate(), overrides: {}, data, meta: TEST_META }, TEST_REGISTRY);
    expect(sizesNotOrdered(report.issues, SIZE_TABLE.key, data.custom[SIZE_TABLE.key])).toEqual(["XL"]);
  });

  it("names each size once, canonical and in the checks' order, and none whose saved entry holds nothing", () => {
    const issue = (moduleKey: string, code: string, size: string, saved = size) => ({ moduleKey, code, size, path: ["sizes", saved] });
    const issues = [
      issue("weight", "size_not_ordered", "S"),
      issue("weight", "size_not_ordered", "L", "l"),
      issue("weight", "size_not_ordered", "XL"),
      issue("weight", "size_not_ordered", "XL"),
      issue("weight", "size_duplicate", "M", "m"),
      issue("dimensions", "size_not_ordered", "XS"),
    ];
    const stored = { sizes: { S: { values: [null] }, l: { values: [3.1] }, XL: { values: [2.9] }, m: { values: [3] } }, comment: "Weighed twice." };
    expect(sizesNotOrdered(issues, "weight", stored)).toEqual(["L", "XL"]);
    expect(sizesNotOrdered(issues, "dimensions", { sizes: {} })).toEqual([]);
  });
});

describe("notOrderedMessage (the step's notice)", () => {
  it("names the size and says to add it on the order's page", () => {
    expect(notOrderedMessage(["L"], "Order")).toBe("Saved for size L, which is not on the order: add L on the Order page to see it.");
  });

  it("names several sizes in one sentence, the order's page by its short name", () => {
    expect(notOrderedMessage(["L", "XL"], "Order")).toBe(
      "Saved for sizes L and XL, which are not on the order: add L and XL on the Order page to see them.",
    );
    expect(notOrderedMessage(["S", "L", "XL"], "PO Info")).toBe(
      "Saved for sizes S, L and XL, which are not on the order: add S, L and XL on the PO Info page to see them.",
    );
  });

  it("read-only, or with no order page, says where the values are and no more", () => {
    expect(notOrderedMessage(["L"], null)).toBe("Saved for size L, which is not on the order.");
    expect(notOrderedMessage(["L", "XL"], null)).toBe("Saved for sizes L and XL, which are not on the order.");
  });
});

describe("Open Order's target", () => {
  it("is the order's page, at the size's quantity, which the order's table marks for the focus", () => {
    expect(ORDER_KEY).toBe("order_lots");
    expect(orderSizePath("L")).toEqual(["sizes", "L", "qtyCases"]);

    // The order with nothing in it yet, as on the inspection Kenneth asked about.
    const order = { modules: { order_lots: orderLots.emptyData() }, custom: {} };
    const tableTemplate = makeTestTemplate(MODULE_REGISTRY, [{ key: "order_lots", config: orderLots.defaultConfig as ResolvedModule["config"] }]);
    const context = buildInspectionContext({ template: tableTemplate, data: order }, MODULE_REGISTRY);
    const evaluation = evaluationOf(evaluateInspection({ template: tableTemplate, data: order, context }, MODULE_REGISTRY), orderLots);
    const html = renderToStaticMarkup(
      <OrderCapture
        data={orderLots.emptyData()}
        config={orderLots.defaultConfig}
        title={orderLots.title}
        labels={orderLots.labels}
        context={context}
        evaluation={evaluation}
        focusPath={null}
        readOnly={false}
        onChange={() => {}}
      />,
    );
    expect(html).toContain(`data-issue-path="${issuePathKey(orderSizePath("L")).replaceAll('"', "&quot;")}"`);
  });
});

describe("a reading's message on Source Documents", () => {
  it("says which sizes it filled that the order does not list, and how to see them", () => {
    const fill = applyProposals({ modules: {}, custom: {} }, SHEET, MODULE_REGISTRY, included);
    expect(fill.modules).toEqual(["carton_sampling", "dimensions"]);
    expect(fill.sizes).toEqual(["L"]);
    const notOrdered = filledNotOrdered(fill, template, MODULE_REGISTRY);
    expect(notOrdered).toEqual(["L"]);
    // 50 box/carton numbers, and 5 readings for each of the 13 gloves.
    expect(filledMessage(fill.filled, "PO-0001 RAW DATA.xls", notOrderedNote(notOrdered, "Order"))).toBe(
      "Steri-AI filled 115 fields from PO-0001 RAW DATA.xls. Size L is not on the order yet: add it on the Order page to see its values.",
    );
  });

  it("says no more when the reading orders the size itself, or the order lists it already", () => {
    const withOrder = { ...SHEET, order_lots: { sizes: { L: { qtyCases: 120, lotNumbers: ["LOT-L-0001"] } } } };
    const fill = applyProposals({ modules: {}, custom: {} }, withOrder, MODULE_REGISTRY, included);
    expect(fill.sizes).toEqual(["L"]);
    expect(filledNotOrdered(fill, template, MODULE_REGISTRY)).toEqual([]);

    const ordered = { modules: { order_lots: { sizes: { L: { qtyCases: 120, lotNumbers: [] } } } }, custom: {} };
    expect(filledNotOrdered(applyProposals(ordered, SHEET, MODULE_REGISTRY, included), template, MODULE_REGISTRY)).toEqual([]);
  });

  it("words several sizes in one sentence, and none for none", () => {
    expect(notOrderedNote(["L", "XL"], "PO Info")).toBe(
      "Sizes L and XL are not on the order yet: add them on the PO Info page to see their values.",
    );
    expect(notOrderedNote([], "Order")).toBeNull();
    expect(filledMessage(1, "PO-0001.pdf")).toBe("Steri-AI filled 1 field from PO-0001.pdf.");
    expect(filledNotOrdered({ data: { modules: {}, custom: {} }, sizes: [] }, template, MODULE_REGISTRY)).toEqual([]);
  });
});
