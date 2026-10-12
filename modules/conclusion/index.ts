// Conclusion (BUILD_SPEC 6.1 conclusion). Reads every other module's result
// for the suggested result, so it runs last; holds the final result, so
// submit waits for it.
import { defineModule } from "@/modules/_framework";
import { calcConclusion, type ConclusionComputed } from "./calc";
import {
  CONCLUSION_DEFAULT_CONFIG,
  CONCLUSION_LABELS,
  CONCLUSION_TITLE,
  ConclusionConfigSchema,
  type ConclusionConfig,
} from "./config";
import { ConclusionDataSchema, emptyConclusion, type ConclusionData } from "./schema";

export const definition = defineModule<ConclusionData, ConclusionConfig, ConclusionComputed>({
  key: "conclusion",
  title: CONCLUSION_TITLE,
  labels: CONCLUSION_LABELS,
  dataSchema: ConclusionDataSchema,
  emptyData: emptyConclusion,
  configSchema: ConclusionConfigSchema,
  defaultConfig: CONCLUSION_DEFAULT_CONFIG,
  dependsOn: "all",
  requiredForSubmit: true,
  // No canonical path for inspectionSummary: canonical paths treat text and
  // textarea as one, so a plain-text custom field mapped there would write a
  // raw string into the formatted document.
  canonicalPaths: [
    { path: "remark", label: CONCLUSION_LABELS.remark, type: "textarea" },
    { path: "date", label: CONCLUSION_LABELS.date, type: "date" },
  ],
  calc: calcConclusion,
  loadCapture: () => import("./Capture"),
});

export type { ConclusionData } from "./schema";
export type { ConclusionConfig } from "./config";
export type { ConclusionComputed } from "./calc";
