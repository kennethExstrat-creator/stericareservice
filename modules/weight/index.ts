// Weight (BUILD_SPEC 6.1): per ordered size, the gloves weighed (the
// sampling plan's gloves for dimension, else the template's n) and their
// average, judged against an optional spec and compared with the indicative
// weight from glove_info (6.2 rule 9). Its title names the gloves weighed.
import { defineModule } from "@/modules/_framework";
import { calcWeight, type WeightComputed } from "./calc";
import { WEIGHT_DEFAULT_CONFIG, WEIGHT_LABELS, WEIGHT_TITLE, WeightConfigSchema, type WeightConfig } from "./config";
import { emptyWeight, WeightDataSchema, type WeightData } from "./schema";
import { weightTitle } from "./title";

export const definition = defineModule<WeightData, WeightConfig, WeightComputed>({
  key: "weight",
  title: WEIGHT_TITLE,
  labels: WEIGHT_LABELS,
  dataSchema: WeightDataSchema,
  emptyData: emptyWeight,
  configSchema: WeightConfigSchema,
  defaultConfig: WEIGHT_DEFAULT_CONFIG,
  perSize: true,
  calc: calcWeight,
  shownTitle: weightTitle,
  loadCapture: () => import("./Capture"),
});

export type { WeightData } from "./schema";
export type { WeightConfig } from "./config";
export type { WeightComputed } from "./calc";
