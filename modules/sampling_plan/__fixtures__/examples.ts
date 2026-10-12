// The example reports (tests/fixtures/examples) in the data shapes of
// sampling_plan and carton_sampling, and a registry for engine tests: the
// real modules, with the framework's test doubles for order_lots and
// packing_config, so these tests read the order and the packing whatever
// shape those modules' own data takes.
import { TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import type { InspectionData, ModuleRegistry } from "@/modules/_framework";
import { MODULE_REGISTRY } from "@/modules/registry";
import { cartonList, REPORT_SIZES, type ExampleReport } from "@/tests/fixtures/examples";
import type { SamplingPlanData } from "../schema";

export const ENGINE_REGISTRY: ModuleRegistry = {
  ...MODULE_REGISTRY,
  order_lots: TEST_REGISTRY.order_lots,
  packing_config: TEST_REGISTRY.packing_config,
};

/** Sizes the example filled in a section, in print order. */
function filled<T>(perSize: Readonly<Partial<Record<(typeof REPORT_SIZES)[number], T>>>) {
  return REPORT_SIZES.flatMap((size) => {
    const entry = perSize[size];
    return entry === undefined ? [] : [[size, entry] as const];
  });
}

/**
 * The gloves weighed one by one, which the report names in its weight
 * heading, not in its Sampling Plan (STD_EG: "average of 13 gloves per
 * size"); null where it weighs one value per size (SAFEDON_EG has no row).
 */
export function glovesWeighed(example: ExampleReport, size: string): number | null {
  const gloves = example.weight[size as (typeof REPORT_SIZES)[number]]?.gloves ?? null;
  return gloves !== null && gloves > 1 ? gloves : null;
}

/** The Sampling Plan table, column by column, with the gloves weighed (glovesWeighed). */
export function samplingPlanData(example: ExampleReport): SamplingPlanData {
  return {
    sizes: Object.fromEntries(
      filled(example.sampling).map(([size, row]) => [
        size,
        {
          cases: row.cases,
          innerUnits: row.inners,
          gloves: row.gloves,
          glovesWatertightVisual: row.watertightVisualGloves,
          glovesDimensions: row.dimensionGloves,
          glovesPhysical: row.physicalTestGloves,
          glovesWeight: glovesWeighed(example, size),
          innerUnitsDispensing: row.dispensingInners,
          pouches: null,
          pouchesDyeLeak: null,
        },
      ]),
    ),
  };
}

/** The carton grids, read row by row as printed (duplicates kept). */
export function cartonSamplingData(example: ExampleReport) {
  return {
    sizes: Object.fromEntries(
      filled(example.cartons).map(([size, grid]) => [size, { cartonNumbers: cartonList(grid) }]),
    ),
  };
}

/** The order table in the shape of the framework's order_lots test double. */
export function orderLotsData(example: ExampleReport) {
  return {
    lots: filled(example.order.lines).map(([size, line]) => ({ size, qtyCases: line.qtyCases, lotNumbers: [...line.lots] })),
  };
}

/** The packing configuration in the shape of the framework's packing_config test double. */
export function packingData(example: ExampleReport) {
  const { glovesPerInner, innersPerCase, printedGlovesPerCase } = example.packing;
  return { glovesPerInner, innersPerCase, glovesPerCase: printedGlovesPerCase };
}

/** Order, packing, sampling plan and cartons of an example, as saved inspection data. */
export function exampleData(example: ExampleReport, modules: Record<string, unknown> = {}): InspectionData {
  return {
    modules: {
      order_lots: orderLotsData(example),
      packing_config: packingData(example),
      sampling_plan: samplingPlanData(example),
      carton_sampling: cartonSamplingData(example),
      ...modules,
    },
    custom: {},
  };
}
