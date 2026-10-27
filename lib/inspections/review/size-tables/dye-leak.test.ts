import { describe, expect, it } from "vitest";
import { buildInspectionContext, evaluateInspection, type InspectionData } from "@/modules/_framework";
import { makeTestTemplate } from "@/modules/_framework/testing";
import { MODULE_REGISTRY } from "@/modules/registry";
import { dyeLeakTable } from "./dye-leak";

// No example report has a dye leak table (the SG onsite form only plans it):
// three surgical sizes through the engine, as the review evaluates them.
const SIZES = ["6.5", "7.0", "7.5"];

function review(dyeLeak: unknown, config: { n: number | null } = { n: 13 }) {
  const template = makeTestTemplate(MODULE_REGISTRY, ["order_lots", { key: "dye_leak", config }], {
    sizes: SIZES.map((value) => ({ value, label: value })),
  });
  const order = Object.fromEntries(
    SIZES.map((size) => [size, { qtyCases: 40, lotNumbers: [`LOT-${size}-0001`], packingSite: null }]),
  );
  const data: InspectionData = { modules: { order_lots: { sizes: order }, dye_leak: dyeLeak }, custom: {} };
  const context = buildInspectionContext({ template, data }, MODULE_REGISTRY);
  const entry = evaluateInspection({ template, data, context }, MODULE_REGISTRY).modules.find((module) => module.key === "dye_leak");
  if (!entry) throw new Error("The template does not include dye_leak.");
  return { entry, context };
}

describe("dyeLeakTable", () => {
  it("lists the pouches planned, tested and failed per size: fewer tested than planned amber, a leak red", () => {
    const { entry, context } = review({
      sizes: {
        "6.5": { pouchesTested: 13, pouchesFailed: 0 },
        "7.0": { pouchesTested: 10, pouchesFailed: 0 },
        "7.5": { pouchesTested: 13, pouchesFailed: 2, notes: "Dye through the thumb of one pair." },
      },
    });
    expect(context.sizes).toEqual(SIZES);
    expect(dyeLeakTable(entry, context)).toEqual({
      rows: [
        { key: "pouchesPlanned", label: "Pouches Planned", cells: [{ text: "13" }, { text: "13" }, { text: "13" }] },
        { key: "pouchesTested", label: "Pouches Tested", cells: [{ text: "13" }, { text: "10", tone: "warn" }, { text: "13" }] },
        { key: "pouchesFailed", label: "Pouches Failed", cells: [{ text: "0" }, { text: "0" }, { text: "2", tone: "fail" }] },
      ],
    });
  });

  it("marks more pouches failed than tested red, and has no plan row without a plan", () => {
    const { entry, context } = review(
      { sizes: { "6.5": { pouchesTested: 5, pouchesFailed: 6 }, "7.0": { pouchesTested: 13 } } },
      { n: null },
    );
    expect(dyeLeakTable(entry, context)?.rows).toEqual([
      { key: "pouchesTested", label: "Pouches Tested", cells: [{ text: "5" }, { text: "13" }, { text: null }] },
      { key: "pouchesFailed", label: "Pouches Failed", cells: [{ text: "6", tone: "fail" }, { text: null }, { text: null }] },
    ]);
  });

  it("has no table while no pouch is counted: the plan alone is no result", () => {
    const { entry, context } = review({ sizes: {} });
    expect(dyeLeakTable(entry, context)).toBeNull();
  });
});
