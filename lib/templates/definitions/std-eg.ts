// STD_EG: the standard template for examination gloves, for every client
// (BUILD_SPEC 4.4 and 11).
//
// Since 26 October 2026 it runs SAFEDON_EG's flow. Kenneth: "all the
// inspection flow will be standardized", with "the flow that I have asked u
// to tweak as the standard form", the one INS-2026-2210 uses. So it has
// SAFEDON_EG's modules in their order, with their titles, wording, config,
// specs (ASTM D6319), defect lists, AQLs and sizes. That includes the Safedon
// dispensing check with its box table, tensile instead of force at break, one
// weight value per size, glove burst in the watertight test, the expiry date
// in labelling, and the onsite dispensing notes. It keeps a standard
// template's identity: its own code and no client, the STD_EG report's title
// (which names no client), no client logo, and the header's client row, since
// no logo names the client. Like SAFEDON_EG, it has no factory glove code.
//
// Versions 1 to 4 ran the STD_EG report's flow (EN 455: force at break,
// the packing check, the median of 13 with cuff thickness). The data
// dictionary keeps that flow as TEMPLATES.STD_EG, and the inspections made
// on those versions keep it.
import { definitionFromCoverage, definitionWithFlow, type FlowIdentity } from "./from-coverage";
import type { SeedTemplate } from "./types";

/** What STD_EG keeps of its own over SAFEDON_EG's flow. */
export const STD_EG_IDENTITY: FlowIdentity = {
  code: "STD_EG",
  name: "Standard examination gloves (ASTM D6319)",
  standard: "ASTM_D6319",
  report: { titleLines: ["Preshipment Inspection", "Nitrile Disposable Examination Gloves"], showClientLogo: false },
  headerFields: { client: true },
};

export const STD_EG_SEED: SeedTemplate = {
  code: "STD_EG",
  client: null,
  flow: "SAFEDON_EG",
  definition: () => definitionWithFlow("SAFEDON_EG", STD_EG_IDENTITY),
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
