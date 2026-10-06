// STD_SG: standard sterile surgical gloves (BUILD_SPEC 11). Built from
// onsite/SG.md only: there is no filled SG report yet, so the standard is
// "custom" and the report title, specs, defect lists and several defaults are
// provisional (lib/coverage/templates.ts `toConfirm`, BUILD_SPEC 13). Root
// template: the standard template for surgical gloves (BUILD_SPEC 4.4).
//
// Modules on, in order: header (no factory address, client or factory glove
// code), order_lots, packing_config (pouch), sampling_plan (with the pouch
// columns), watertight and visual (right and left hand apart), dimensions
// (no specs yet, so nothing is judged), dye_leak, conclusion. Sizes 5.5 to
// 9.0 in pairs. No report title until a filled SG report exists: the AI
// report falls back to the template's name.
import { definitionFromCoverage } from "./from-coverage";
import type { SeedTemplate } from "./types";

export const STD_SG_SEED: SeedTemplate = {
  code: "STD_SG",
  client: null,
  definition: () => definitionFromCoverage("STD_SG"),
};
