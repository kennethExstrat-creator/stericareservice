import { describe, expect, it } from "vitest";
import { MODULE_REGISTRY } from "@/modules/registry";
import { buildInspectionContext, evaluateInspection, type CalcInput, type InspectionContext } from "@/modules/_framework";
import { checkModuleContract, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import {
  REPORT_SIZES,
  SAFEDON_EG_EXAMPLE,
  SAFEDON_EG_EXPECTED,
  STD_EG_EXAMPLE,
  STD_EG_EXPECTED,
  type OrderSection,
} from "@/tests/fixtures/examples";
import { calcLoading, cartonsOrdered } from "./calc";
import { LOADING_DEFAULT_CONFIG, LOADING_LABELS, type LoadingConfig } from "./config";
import { definition } from "./index";
import { emptyLoading, type LoadingData } from "./schema";

/** The context order_lots gives for an example report's order table. */
function orderContext(order: OrderSection): InspectionContext {
  const sizes = REPORT_SIZES.filter((size) => order.lines[size] !== undefined);
  return makeTestContext({
    sizes,
    order: Object.fromEntries(
      sizes.map((size) => [size, { qtyCases: order.lines[size]?.qtyCases ?? null, lotNumbers: order.lines[size]?.lots ?? [] }]),
    ),
  });
}

const STD_EG_ORDER = orderContext(STD_EG_EXAMPLE.order);
const SAFEDON_EG_ORDER = orderContext(SAFEDON_EG_EXAMPLE.order);

const FILLED: LoadingData = {
  containerNo: "CSQU 305438 3",
  sealNo: "SL-0001",
  cartonsLoaded: STD_EG_EXPECTED.totals.cartons,
  cartonCondition: "Dry and clean, no crushed cartons.",
};

function input(
  data: Partial<LoadingData>,
  {
    config = LOADING_DEFAULT_CONFIG,
    context = STD_EG_ORDER,
    labels = LOADING_LABELS,
  }: { config?: LoadingConfig; context?: InspectionContext; labels?: Record<string, string> } = {},
): CalcInput<LoadingData, LoadingConfig> {
  return { data: { ...emptyLoading(), ...data }, config, title: "Loading", labels, context, results: {}, hasData: true };
}

function withFields(fields: Partial<LoadingConfig["fields"]>): LoadingConfig {
  return { fields: { ...LOADING_DEFAULT_CONFIG.fields, ...fields } };
}

describe("loading", () => {
  it("satisfies the module contract", () => {
    expect(checkModuleContract(definition)).toEqual([]);
    expect(definition.perSize).toBe(false);
  });

  it("takes the cartons ordered from the order, as both example reports total them", () => {
    expect(cartonsOrdered(STD_EG_ORDER)).toBe(STD_EG_EXPECTED.totals.cartons);
    expect(cartonsOrdered(SAFEDON_EG_ORDER)).toBe(SAFEDON_EG_EXPECTED.totals.cartons);
    expect(SAFEDON_EG_EXPECTED.totals.cartons).toBe(1530);
    expect(cartonsOrdered(makeTestContext())).toBeNull();
    // A size without a quantity leaves the total unknown rather than short.
    expect(cartonsOrdered({ ...STD_EG_ORDER, order: { M: { qtyCases: null, lotNumbers: [] } } })).toBeNull();
  });

  it("is a record once every field is filled in and the cartons match the order", () => {
    expect(calcLoading(input(FILLED))).toEqual({
      result: { status: "info", summary: "Container no. CSQU 305438 3; Seal no. SL-0001; Cartons loaded 2,900 of 2,900." },
      computed: { cartonsOrdered: 2900, cartonsDifference: 0 },
      issues: [],
    });
  });

  it("warns when fewer cartons were loaded than ordered, with a link to the count", () => {
    const output = calcLoading(input({ ...FILLED, cartonsLoaded: 1500 }, { context: SAFEDON_EG_ORDER }));
    expect(output.result).toEqual({
      status: "warn",
      summary: "Container no. CSQU 305438 3; Seal no. SL-0001; Cartons loaded 1,500 of 1,530 (30 short).",
    });
    expect(output.computed).toEqual({ cartonsOrdered: 1530, cartonsDifference: -30 });
    expect(output.issues).toEqual([
      {
        level: "warning",
        code: "loading_quantity_mismatch",
        message: "Cartons loaded (1,500) does not match Cartons ordered (1,530): 30 short.",
        path: ["cartonsLoaded"],
      },
    ]);
  });

  it("warns when more cartons were loaded than ordered", () => {
    const output = calcLoading(input({ ...FILLED, cartonsLoaded: 2950 }));
    expect(output.result.status).toBe("warn");
    expect(output.issues[0]?.message).toBe("Cartons loaded (2,950) does not match Cartons ordered (2,900): 50 over.");
    expect(output.computed.cartonsDifference).toBe(50);
  });

  it("is not done while a field the template shows is empty (6.2 rule 5)", () => {
    expect(calcLoading(input({ ...FILLED, sealNo: " ", cartonCondition: null })).result).toEqual({
      status: "not_done",
      summary: "Missing: Seal no., Carton condition.",
    });
    expect(calcLoading(input({})).result.status).toBe("not_done");
  });

  it("raises the mismatch while other fields are still missing", () => {
    const output = calcLoading(input({ cartonsLoaded: 2000 }));
    expect(output.result.status).toBe("not_done");
    expect(output.issues.map((issue) => issue.code)).toEqual(["loading_quantity_mismatch"]);
  });

  it("is not done while the order total is unknown, since there is nothing to compare with", () => {
    const output = calcLoading(input(FILLED, { context: makeTestContext() }));
    expect(output.result).toEqual({
      status: "not_done",
      summary: "Cartons ordered: not known until the order quantities are entered.",
    });
    expect(output.computed).toEqual({ cartonsOrdered: null, cartonsDifference: null });
    expect(output.issues).toEqual([]);
  });

  it("asks only for the fields the template switches on", () => {
    const noCount = withFields({ cartonsLoaded: false });
    const output = calcLoading(input({ ...FILLED, cartonsLoaded: 12 }, { config: noCount, context: makeTestContext() }));
    expect(output).toEqual({
      result: { status: "info", summary: "Container no. CSQU 305438 3; Seal no. SL-0001." },
      computed: { cartonsOrdered: null, cartonsDifference: null },
      issues: [],
    });
    const conditionOnly = withFields({ containerNo: false, sealNo: false, cartonsLoaded: false });
    expect(calcLoading(input({ cartonCondition: "Dry." }, { config: conditionOnly })).result).toEqual({
      status: "info",
      summary: "Carton condition recorded.",
    });
    const none = withFields({ containerNo: false, sealNo: false, cartonsLoaded: false, cartonCondition: false });
    expect(calcLoading(input({}, { config: none })).result).toEqual({ status: "info", summary: "No fields are switched on." });
  });

  it("warns on a container number whose ISO 6346 check digit does not match", () => {
    const output = calcLoading(input({ ...FILLED, containerNo: "CSQU 305438 4" }));
    expect(output.result).toEqual({
      status: "warn",
      summary: "Container no. CSQU 305438 4 (check the number); Seal no. SL-0001; Cartons loaded 2,900 of 2,900.",
    });
    expect(output.issues).toEqual([
      {
        level: "warning",
        code: "container_no_check_digit",
        message: "Container no. CSQU 305438 4: the ISO 6346 check digit should be 3. Check the number on the container.",
        path: ["containerNo"],
      },
    ]);
  });

  it("warns on a container number that is not ISO 6346 at all", () => {
    const output = calcLoading(input({ ...FILLED, containerNo: "CSQU 30543" }));
    expect(output.result.status).toBe("warn");
    expect(output.issues).toEqual([
      expect.objectContaining({ code: "container_no_format", path: ["containerNo"] }),
    ]);
    const off = calcLoading(input({ ...FILLED, containerNo: "CSQU 30543" }, { config: withFields({ containerNo: false }) }));
    expect(off.issues).toEqual([]);
  });

  it("speaks the template's wording", () => {
    const labels = { ...LOADING_LABELS, cartonsLoaded: "Cartons stuffed", cartonsOrdered: "PO cartons", sealNo: "Bolt seal" };
    const output = calcLoading(input({ ...FILLED, sealNo: null, cartonsLoaded: 2899 }, { labels }));
    expect(output.result.summary).toBe("Missing: Bolt seal.");
    expect(output.issues[0]?.message).toBe("Cartons stuffed (2,899) does not match PO cartons (2,900): 1 short.");
  });

  it("works through the engine, with the order total from the context", () => {
    const template = makeTestTemplate(MODULE_REGISTRY, ["order_lots", "loading"]);
    const data = {
      modules: { loading: { ...FILLED, cartonsLoaded: 1529, comment: "One carton held back, crushed." } },
      custom: {},
    };
    // order_lots may still be a stub: give the context the SAFEDON_EG order.
    const context: InspectionContext = {
      ...buildInspectionContext({ template, data }, MODULE_REGISTRY),
      sizes: SAFEDON_EG_ORDER.sizes,
      order: SAFEDON_EG_ORDER.order,
    };
    const evaluation = evaluateInspection({ template, data, context }, MODULE_REGISTRY);
    const found = evaluation.modules.find((entry) => entry.key === "loading");
    expect(found).toMatchObject({
      result: { status: "warn" },
      computed: { cartonsOrdered: 1530, cartonsDifference: -1 },
      comment: "One carton held back, crushed.",
      issues: [expect.objectContaining({ moduleKey: "loading", code: "loading_quantity_mismatch", path: ["cartonsLoaded"] })],
    });
  });
});
