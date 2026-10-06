// Packing configuration: what a case holds, for the order totals and the lot sizes.
import { defineModule } from "@/modules/_framework";
import { calcPackingConfig, contributePackingConfig, type PackingConfigComputed } from "./calc";
import {
  PACKING_CONFIG_DEFAULT_CONFIG,
  PACKING_CONFIG_LABELS,
  PACKING_CONFIG_TITLE,
  PackingConfigConfigSchema,
  type PackingConfigConfig,
} from "./config";
import { emptyPackingConfig, PackingConfigDataSchema, type PackingConfigData } from "./schema";

export const definition = defineModule<PackingConfigData, PackingConfigConfig, PackingConfigComputed>({
  key: "packing_config",
  title: PACKING_CONFIG_TITLE,
  labels: PACKING_CONFIG_LABELS,
  dataSchema: PackingConfigDataSchema,
  emptyData: emptyPackingConfig,
  configSchema: PackingConfigConfigSchema,
  defaultConfig: PACKING_CONFIG_DEFAULT_CONFIG,
  canonicalPaths: [
    { path: "glovesPerInner", label: PACKING_CONFIG_LABELS.glovesPerInner, type: "counter", unit: "pcs" },
    { path: "innersPerCase", label: PACKING_CONFIG_LABELS.innersPerCase, type: "counter" },
    { path: "glovesPerCase", label: PACKING_CONFIG_LABELS.glovesPerCase, type: "counter", unit: "pcs" },
    { path: "packingMode", label: PACKING_CONFIG_LABELS.packingMode, type: "text" },
  ],
  calc: calcPackingConfig,
  contribute: contributePackingConfig,
});

export type { PackingConfigData } from "./schema";
export type { PackingConfigConfig } from "./config";
export type { PackingConfigComputed } from "./calc";
