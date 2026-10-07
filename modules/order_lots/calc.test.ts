import { describe, expect, it } from "vitest";
import {
  buildInspectionContext,
  evaluateInspection,
  inspectionRowValues,
  lotSizeGloves,
  type CalcInput,
  type InspectionContext,
} from "@/modules/_framework";
import { checkModuleContract, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { packingConfig, packingData } from "@/modules/packing_config/__fixtures__/examples";
import { MODULE_REGISTRY } from "@/modules/registry";
import {
  REPORT_SIZES,
  SAFEDON_EG_EXAMPLE,
  SAFEDON_EG_EXPECTED,
  STD_EG_EXAMPLE,
  STD_EG_EXPECTED,
  type ReportSize,
} from "@/tests/fixtures/examples";
import { orderData } from "./__fixtures__/examples";
import { calcOrderLots, contributeOrderLots, readOrder } from "./calc";
import { ORDER_LOTS_DEFAULT_CONFIG, ORDER_LOTS_LABELS, type OrderLotsConfig } from "./config";
import { definition } from "./index";
import { emptyOrderLine, type OrderLine, type OrderLotsData } from "./schema";

const WITH_SITE: OrderLotsConfig = { fields: { packingSite: true } };
const PACKED = { innerUnit: "inner box", glovesPerInner: 200, innersPerCase: 10, glovesPerCase: 2000 };

function lines(entries: Record<string, Partial<OrderLine>>): OrderLotsData {
  return { sizes: Object.fromEntries(Object.entries(entries).map(([size, line]) => [size, { ...emptyOrderLine(), ...line }])) };
}

function input(
  data: OrderLotsData,
  {
    config = ORDER_LOTS_DEFAULT_CONFIG,
    labels = ORDER_LOTS_LABELS,
    context = {},
  }: { config?: OrderLotsConfig; labels?: Record<string, string>; context?: Partial<InspectionContext> } = {},
): CalcInput<OrderLotsData, OrderLotsConfig> {
  return {
    data,
    config,
    title: "Order",
    labels,
    context: makeTestContext({ packing: PACKED, ...context }),
    results: {},
    hasData: true,
  };
}

describe("order_lots", () => {
  it("satisfies the module contract", () => {
    expect(checkModuleContract(definition)).toEqual([]);
  });

  it("totals the SAFEDON_EG example: 1,530 cartons and 3,060,000 gloves (expected results A)", () => {
    const output = calcOrderLots(input(orderData(SAFEDON_EG_EXAMPLE.order), { config: WITH_SITE }));
    expect(output.computed).toEqual({
      lotSizeGloves: { XS: 120_000, S: 1_700_000, M: 1_120_000, L: 120_000 },
      totalCartons: SAFEDON_EG_EXPECTED.totals.cartons,
      totalGloves: SAFEDON_EG_EXPECTED.totals.gloves,
    });
    for (const size of ["XS", "S", "M", "L"] as const) {
      expect(output.computed.lotSizeGloves[size]).toBe(SAFEDON_EG_EXPECTED.sampling[size]?.lotGloves);
    }
    expect(output.result).toEqual({
      status: "info",
      summary: "Sizes XS, S, M, L. Total # Carton 1,530; Total # Gloves 3,060,000.",
      perSize: {
        XS: { status: "info", summary: "Qty (Cases) 60; Lot Number LOT-B01; Packing Site Packer C." },
        S: { status: "info", summary: "Qty (Cases) 850; Lot Number LOT-B02; Packing Site Manufacturer B." },
        M: { status: "info", summary: "Qty (Cases) 560; Lot Number LOT-B03; Packing Site Manufacturer B." },
        L: { status: "info", summary: "Qty (Cases) 60; Lot Number LOT-B04; Packing Site Packer C." },
      },
    });
    expect(output.issues).toEqual([]);
  });

  it("totals the STD_EG example: 2,900 cartons and 5,800,000 gloves, size M only (expected results B)", () => {
    const output = calcOrderLots(input(orderData(STD_EG_EXAMPLE.order)));
    expect(output.computed).toEqual({
      lotSizeGloves: { M: STD_EG_EXPECTED.sampling.M?.lotGloves },
      totalCartons: STD_EG_EXPECTED.totals.cartons,
      totalGloves: STD_EG_EXPECTED.totals.gloves,
    });
    expect(output.result).toMatchObject({
      status: "info",
      summary: "Size M. Total # Carton 2,900; Total # Gloves 5,800,000.",
    });
    expect(Object.keys(output.result.perSize ?? {})).toEqual(["M"]);
  });

  it("computes the totals instead of taking the printed ones (6.2 rule 2)", () => {
    const order = { ...SAFEDON_EG_EXAMPLE.order, printedTotalCartons: 1, printedTotalGloves: 2 };
    expect(calcOrderLots(input(orderData(order))).computed.totalCartons).toBe(1530);
  });

  it("counts the gloves only once the packing configuration gives the gloves per case", () => {
    const output = calcOrderLots(
      input(orderData(STD_EG_EXAMPLE.order), {
        context: { packing: { innerUnit: null, glovesPerInner: null, innersPerCase: null, glovesPerCase: null } },
      }),
    );
    expect(output.computed).toEqual({ lotSizeGloves: { M: null }, totalCartons: 2900, totalGloves: null });
    expect(output.result).toMatchObject({
      status: "info",
      summary: "Size M. Total # Carton 2,900; Total # Gloves: waiting for the gloves per case.",
    });
  });

  it("is not done until a size is ordered (6.2 rule 5)", () => {
    for (const data of [lines({}), lines({ M: { qtyCases: 0 } }), lines({ M: {} })]) {
      expect(calcOrderLots(input(data))).toEqual({
        result: { status: "not_done", summary: "No size ordered yet: enter the Qty (Cases) of each size in the order." },
        computed: { lotSizeGloves: {}, totalCartons: null, totalGloves: null },
        issues: [],
      });
    }
  });

  it("is not done while an ordered size has no lot number, naming it in the template's wording", () => {
    const labels = { ...ORDER_LOTS_LABELS, lotNumbers: "Lot No." };
    const output = calcOrderLots(input(lines({ S: { qtyCases: 850 }, M: { qtyCases: 560, lotNumbers: [" "] } }), { labels }));
    expect(output.result).toEqual({
      status: "not_done",
      summary: "Missing: Lot No. for sizes S, M.",
      perSize: {
        S: { status: "not_done", summary: "Missing: Lot No." },
        M: { status: "not_done", summary: "Missing: Lot No." },
      },
    });
    const site = calcOrderLots(
      input(lines({ M: { qtyCases: 560, lotNumbers: ["LOT-B03"], packingSite: "Packer C Sdn. Bhd." } }), { config: WITH_SITE }),
    );
    expect(site.result.perSize?.M?.summary).toBe("Qty (Cases) 560; Lot Number LOT-B03; Packing Site Packer C Sdn. Bhd.");
  });

  it("asks for the packing site only where the template shows it (SAFEDON_EG)", () => {
    const data = lines({
      XS: { qtyCases: 60, lotNumbers: ["LOT-B01"] },
      M: { qtyCases: 560, lotNumbers: ["LOT-B03"], packingSite: "Manufacturer B" },
      L: { qtyCases: 60, lotNumbers: ["LOT-B04"], packingSite: "" },
    });
    expect(calcOrderLots(input(data, { config: WITH_SITE })).result).toMatchObject({
      status: "not_done",
      summary: "Missing: Packing Site for sizes XS, L.",
    });
    expect(calcOrderLots(input(data)).result.status).toBe("info");
  });

  it("is not done for a line with lot numbers but no quantity: a size meant to be ordered", () => {
    const labels = { ...ORDER_LOTS_LABELS, qtyCases: "Qty (Case)" };
    const data = lines({ S: { qtyCases: 0, lotNumbers: ["LOT-B02"] }, M: { qtyCases: 2900, lotNumbers: ["LOT-A01"] } });
    const output = calcOrderLots(input(data, { labels }));
    expect(output.result).toMatchObject({ status: "not_done", summary: "Missing: Qty (Case) for size S." });
    expect(output.computed.totalCartons).toBe(2900);
    expect(calcOrderLots(input(lines({ S: { lotNumbers: ["LOT-B02"] } }))).result.summary).toBe(
      "Missing: Qty (Cases) for size S.",
    );
  });

  it("names sizes as the template labels them", () => {
    const context = { templateSizes: [{ value: "M", label: "Medium" }] };
    const output = calcOrderLots(input(orderData(STD_EG_EXAMPLE.order), { context }));
    expect(output.result.summary).toBe("Size Medium. Total # Carton 2,900; Total # Gloves 5,800,000.");
  });

  it("orders only the sizes with a quantity, for every other module (6.2 rule 4)", () => {
    expect(contributeOrderLots({ data: orderData(SAFEDON_EG_EXAMPLE.order), config: WITH_SITE })).toEqual({
      sizes: ["XS", "S", "M", "L"],
      order: {
        XS: { qtyCases: 60, lotNumbers: ["LOT-B01"] },
        S: { qtyCases: 850, lotNumbers: ["LOT-B02"] },
        M: { qtyCases: 560, lotNumbers: ["LOT-B03"] },
        L: { qtyCases: 60, lotNumbers: ["LOT-B04"] },
      },
    });
    const data = lines({
      XS: { qtyCases: 0, lotNumbers: ["LOT-0"] },
      S: { lotNumbers: ["LOT-1"] },
      M: { qtyCases: 2900, lotNumbers: [" LOT-A01 ", "", "LOT-A01", "LOT-A02"] },
    });
    expect(contributeOrderLots({ data, config: ORDER_LOTS_DEFAULT_CONFIG })).toEqual({
      sizes: ["M"],
      order: { M: { qtyCases: 2900, lotNumbers: ["LOT-A01", "LOT-A02"] } },
    });
    expect(contributeOrderLots({ data: lines({}), config: ORDER_LOTS_DEFAULT_CONFIG })).toEqual({ sizes: [], order: {} });
  });

  it("reads another spelling of a size as that size, the canonical key winning", () => {
    const variant = lines({ "7": { qtyCases: 100, lotNumbers: ["LOT-7"] }, m: { qtyCases: 5, lotNumbers: ["LOT-m"] } });
    expect(contributeOrderLots({ data: variant, config: ORDER_LOTS_DEFAULT_CONFIG }).sizes).toEqual(["M", "7.0"]);
    const both = lines({ m: { qtyCases: 5, lotNumbers: ["LOT-m"] }, M: { qtyCases: 2900, lotNumbers: ["LOT-A01"] } });
    expect(readOrder(both).rows).toEqual([
      { size: "M", key: "M", qtyCases: 2900, lotNumbers: ["LOT-A01"], packingSite: null },
    ]);
    expect(contributeOrderLots({ data: both, config: ORDER_LOTS_DEFAULT_CONFIG }).order).toEqual({
      M: { qtyCases: 2900, lotNumbers: ["LOT-A01"] },
    });
  });

  it("rejects a size entered twice, a key that is not a size and a size the template does not offer", () => {
    const data = lines({
      M: { qtyCases: 2900, lotNumbers: ["LOT-A01"] },
      m: { qtyCases: 5 },
      Q: { qtyCases: 1 },
      XXL: { qtyCases: 10, lotNumbers: ["LOT-X"] },
      "9.0": {},
    });
    const output = calcOrderLots(input(data));
    expect(output.issues).toEqual([
      {
        level: "error",
        code: "order_size_invalid",
        message: '"Q" is not a size. Use XS, S, M, L, XL, XXL, or 5.5 to 9.0 in half sizes.',
        path: ["sizes", "Q"],
      },
      {
        level: "error",
        code: "order_size_duplicate",
        message: 'Size M is entered twice, also as "m". The line under "m" is ignored.',
        size: "M",
        path: ["sizes", "m"],
      },
      {
        level: "error",
        code: "order_size_not_in_template",
        message: "Size XXL is not one of this template's sizes (XS, S, M, L, XL).",
        size: "XXL",
        path: ["sizes", "XXL"],
      },
    ]);
    expect(output.computed.totalCartons).toBe(2910);
  });

  it("warns about a lot number entered twice for one size, with a link to the second", () => {
    const output = calcOrderLots(input(lines({ M: { qtyCases: 2900, lotNumbers: ["LOT-A01", "LOT-A02", " LOT-A01"] } })));
    expect(output.issues).toEqual([
      {
        level: "warning",
        code: "lot_number_duplicate",
        message: "Lot Number LOT-A01 is entered twice for size M.",
        size: "M",
        path: ["sizes", "M", "lotNumbers", 2],
      },
    ]);
    expect(output.result.status).toBe("info");
  });
});

describe("order_lots through the engine", () => {
  function run(example: typeof STD_EG_EXAMPLE | typeof SAFEDON_EG_EXAMPLE, extra: readonly ("weight" | "visual")[] = []) {
    const template = makeTestTemplate(MODULE_REGISTRY, [
      { key: "order_lots", config: { fields: { packingSite: example === SAFEDON_EG_EXAMPLE } } },
      { key: "packing_config", config: packingConfig(example.packing) },
      ...extra,
    ]);
    const data = {
      modules: { order_lots: orderData(example.order), packing_config: packingData(example.packing) },
      custom: {},
    };
    const context = buildInspectionContext({ template, data }, MODULE_REGISTRY);
    const evaluation = evaluateInspection({ template, data, context }, MODULE_REGISTRY);
    const orderLots = evaluation.modules.find((entry) => entry.key === "order_lots");
    return { context, evaluation, orderLots };
  }

  it("totals each example with the gloves per case from packing_config (expected results A and B)", () => {
    const safedon = run(SAFEDON_EG_EXAMPLE);
    expect(safedon.orderLots).toMatchObject({
      result: { status: "info" },
      computed: { totalCartons: 1530, totalGloves: 3_060_000 },
      issues: [],
    });
    const stdEg = run(STD_EG_EXAMPLE);
    expect(stdEg.orderLots).toMatchObject({
      result: { status: "info" },
      computed: { totalCartons: 2900, totalGloves: 5_800_000 },
      issues: [],
    });
  });

  it("gives the context the ordered sizes, their lots and the lot sizes the AQL plan starts from", () => {
    const { context } = run(SAFEDON_EG_EXAMPLE);
    expect(context.sizes).toEqual(SAFEDON_EG_EXAMPLE.sizesOrdered);
    for (const size of context.sizes as ReportSize[]) {
      expect(lotSizeGloves(context, size)).toBe(SAFEDON_EG_EXPECTED.sampling[size]?.lotGloves);
    }
    expect(inspectionRowValues(run(STD_EG_EXAMPLE).context).lot_numbers).toEqual(["LOT-A01"]);
  });

  it("shows the sizes not ordered nowhere: no tables, no results (STD_EG: XS, S, L, XL)", () => {
    const { context, evaluation } = run(STD_EG_EXAMPLE, ["weight", "visual"]);
    expect(context.sizes).toEqual(["M"]);
    expect(Object.keys(context.order)).toEqual(["M"]);
    const unordered = REPORT_SIZES.filter((size) => !context.sizes.includes(size));
    expect(unordered).toEqual(STD_EG_EXPECTED.unorderedSizes.sizes);
    for (const key of ["weight", "visual"]) {
      const perSize = evaluation.modules.find((entry) => entry.key === key)?.result.perSize ?? {};
      expect(Object.keys(perSize)).toEqual(["M"]);
    }
  });
});
