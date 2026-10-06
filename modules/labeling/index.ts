// Packaging Labeling Inspection (BUILD_SPEC 6.1 labeling): per size, per
// level, Accept 0 / Reject 1.
import { defineModule } from "@/modules/_framework";
import { calcLabeling, type LabelingComputed } from "./calc";
import {
  LABELING_DEFAULT_CONFIG,
  LABELING_LABELS,
  LABELING_TITLE,
  LabelingConfigSchema,
  type LabelingConfig,
} from "./config";
import { emptyLabeling, LabelingDataSchema, type LabelingData } from "./schema";

export const definition = defineModule<LabelingData, LabelingConfig, LabelingComputed>({
  key: "labeling",
  title: LABELING_TITLE,
  labels: LABELING_LABELS,
  dataSchema: LabelingDataSchema,
  emptyData: emptyLabeling,
  configSchema: LabelingConfigSchema,
  defaultConfig: LABELING_DEFAULT_CONFIG,
  perSize: true,
  calc: calcLabeling,
  loadCapture: () => import("./Capture"),
});

export type { LabelingData } from "./schema";
export type { LabelingConfig } from "./config";
export type { LabelingComputed } from "./calc";
