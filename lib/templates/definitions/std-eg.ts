// STD_EG: the standard template for examination gloves, for every client
// (BUILD_SPEC 4.4 and 11).
//
// It runs the STD_EG report's own flow (EN 455: force at break, the glove
// packing check, dimensions as the median of 13 with cuff thickness, weight
// as the average of 13 gloves), the flow INS-2026-2435 uses and Kenneth has
// tweaked all along (Kenneth, 26 October 2026: "I SAID STANDARDIZED!!!!! USE
// THAT OF 2435"). Version 5 had briefly run SAFEDON_EG's flow; the
// inspections made on it keep it.
import { definitionFromCoverage } from "./from-coverage";
import type { SeedTemplate } from "./types";

export const STD_EG_SEED: SeedTemplate = {
  code: "STD_EG",
  client: null,
  flow: "STD_EG",
  definition: () => definitionFromCoverage("STD_EG"),
};

/**
 * STD_EG as versions 1 to 4 have it: the STD_EG report's flow (EN 455), kept
 * by the inspections made on them. The STD_EG example report was made on it,
 * so its fixtures and acceptance tests (tests/fixtures/examples) are built on
 * it. Not seeded.
 */
export const STD_EG_REPORT_SEED: SeedTemplate = {
  code: "STD_EG",
  client: null,
  flow: "STD_EG",
  definition: () => definitionFromCoverage("STD_EG"),
};
