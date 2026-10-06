// Physical Properties (BUILD_SPEC 6.1, SAFEDON_EG): the lab report's tensile
// strength and elongation averages per size against their minimums, and the
// lab report, which is required.
import { defineModule } from "@/modules/_framework";
import { calcTensile, type TensileComputed } from "./calc";
import { TENSILE_DEFAULT_CONFIG, TENSILE_LABELS, TENSILE_TITLE, TensileConfigSchema, type TensileConfig } from "./config";
import { emptyTensile, TensileDataSchema, type TensileData } from "./schema";

export const definition = defineModule<TensileData, TensileConfig, TensileComputed>({
  key: "tensile",
  title: TENSILE_TITLE,
  labels: TENSILE_LABELS,
  dataSchema: TensileDataSchema,
  emptyData: emptyTensile,
  configSchema: TensileConfigSchema,
  defaultConfig: TENSILE_DEFAULT_CONFIG,
  perSize: true,
  calc: calcTensile,
});

export type { TensileData } from "./schema";
export type { TensileConfig } from "./config";
export type { TensileComputed } from "./calc";
