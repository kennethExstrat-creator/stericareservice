// Dimension (BUILD_SPEC 6.1): per ordered size, a reading per glove for each
// measure on, the median or average against the size's spec.
import { defineModule } from "@/modules/_framework";
import { calcDimensions, type DimensionsComputed } from "./calc";
import {
  DIMENSIONS_DEFAULT_CONFIG,
  DIMENSIONS_LABELS,
  DIMENSIONS_TITLE,
  DimensionsConfigSchema,
  type DimensionsConfig,
} from "./config";
import { DimensionsDataSchema, emptyDimensions, type DimensionsData } from "./schema";

export const definition = defineModule<DimensionsData, DimensionsConfig, DimensionsComputed>({
  key: "dimensions",
  title: DIMENSIONS_TITLE,
  labels: DIMENSIONS_LABELS,
  dataSchema: DimensionsDataSchema,
  emptyData: emptyDimensions,
  configSchema: DimensionsConfigSchema,
  defaultConfig: DIMENSIONS_DEFAULT_CONFIG,
  perSize: true,
  calc: calcDimensions,
});

export type { DimensionsData } from "./schema";
export type { DimensionsConfig } from "./config";
export type { DimensionsComputed } from "./calc";
