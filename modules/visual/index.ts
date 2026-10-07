// Visual Inspection (BUILD_SPEC 6.1): defects per class (critical, major,
// minor) per ordered size, accepted or rejected per class and size by the
// AQL engine; any critical defect fails. The classes' AQLs from the template
// go into the context for the sampling plan's lot check.
import { defineModule } from "@/modules/_framework";
import { calcVisual, contributeVisual, type VisualComputed } from "./calc";
import { VISUAL_DEFAULT_CONFIG, VISUAL_LABELS, VISUAL_TITLE, VisualConfigSchema, type VisualConfig } from "./config";
import { emptyVisual, VisualDataSchema, type VisualData } from "./schema";

export const definition = defineModule<VisualData, VisualConfig, VisualComputed>({
  key: "visual",
  title: VISUAL_TITLE,
  labels: VISUAL_LABELS,
  dataSchema: VisualDataSchema,
  emptyData: emptyVisual,
  configSchema: VisualConfigSchema,
  defaultConfig: VISUAL_DEFAULT_CONFIG,
  perSize: true,
  handSplit: true,
  calc: calcVisual,
  contribute: contributeVisual,
  loadCapture: () => import("./Capture"),
});

export type { VisualData } from "./schema";
export type { VisualConfig } from "./config";
export type { VisualComputed } from "./calc";
