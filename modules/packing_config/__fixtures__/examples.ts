// The example reports' packing configuration (tests/fixtures/examples) as
// packing_config data, with the config each template sets for it.
import type { PackingSection } from "@/tests/fixtures/examples";
import { PACKING_CONFIG_DEFAULT_CONFIG, type PackingConfigConfig } from "../config";
import type { PackingConfigData } from "../schema";

export function packingData(packing: PackingSection): PackingConfigData {
  return {
    glovesPerInner: packing.glovesPerInner,
    innersPerCase: packing.innersPerCase,
    glovesPerCase: packing.printedGlovesPerCase,
    packingMode: null,
  };
}

export function packingConfig(packing: PackingSection): PackingConfigConfig {
  return {
    ...PACKING_CONFIG_DEFAULT_CONFIG,
    innerUnit: packing.innerUnit === "plastic pack" ? "plastic_pack" : "inner_box",
  };
}
