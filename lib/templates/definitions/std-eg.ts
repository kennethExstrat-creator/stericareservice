// STD_EG: standard examination gloves to EN 455 (BUILD_SPEC 11). Built from
// reports/STD_EG.md, then onsite/EG.md. Root template, no client or
// manufacturer: the standard template for examination gloves (BUILD_SPEC 4.4).
//
// Modules on, in order: header (with client and factory glove code),
// glove_info, order_lots, packing_config (inner box), sampling_plan,
// carton_sampling, dimensions (median of 13: length, width, finger, palm,
// cuff), force_at_break (median of 13, at least 6 N), weight (13 gloves),
// watertight (AQL 1.5), visual (critical 0, major 2.5, minor 4.0),
// dispensing_packing (70% layering, 80% dispensing), labeling (dispenser box:
// lot, mfg, artwork; carton: also carton no.), conclusion. Sizes XS to XL in
// pieces. The onsite forms' Glove Type is the custom module glove_type.
// Values still to confirm with Kenneth: lib/coverage/templates.ts `toConfirm`.
import { definitionFromCoverage } from "./from-coverage";
import type { SeedTemplate } from "./types";

export const STD_EG_SEED: SeedTemplate = {
  code: "STD_EG",
  client: null,
  definition: () => definitionFromCoverage("STD_EG"),
};
