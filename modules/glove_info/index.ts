// The reference module: docs/MODULES.md walks through it file by file.
import { defineModule } from "@/modules/_framework";
import { calcGloveInfo, contributeGloveInfo, type GloveInfoComputed } from "./calc";
import {
  GLOVE_INFO_DEFAULT_CONFIG,
  GLOVE_INFO_LABELS,
  GLOVE_INFO_TITLE,
  GloveInfoConfigSchema,
  type GloveInfoConfig,
} from "./config";
import { emptyGloveInfo, GloveInfoDataSchema, type GloveInfoData } from "./schema";

export const definition = defineModule<GloveInfoData, GloveInfoConfig, GloveInfoComputed>({
  key: "glove_info",
  title: GLOVE_INFO_TITLE,
  labels: GLOVE_INFO_LABELS,
  dataSchema: GloveInfoDataSchema,
  emptyData: emptyGloveInfo,
  configSchema: GloveInfoConfigSchema,
  defaultConfig: GLOVE_INFO_DEFAULT_CONFIG,
  canonicalPaths: [
    { path: "surfaceTexture", label: GLOVE_INFO_LABELS.surfaceTexture, type: "text" },
    { path: "indicativeWeight", label: GLOVE_INFO_LABELS.indicativeWeight, type: "number", unit: "g" },
    { path: "colour", label: GLOVE_INFO_LABELS.colour, type: "text" },
    { path: "length", label: GLOVE_INFO_LABELS.length, type: "text" },
  ],
  calc: calcGloveInfo,
  contribute: contributeGloveInfo,
  loadCapture: () => import("./Capture"),
});

export type { GloveInfoData } from "./schema";
export type { GloveInfoConfig } from "./config";
export type { GloveInfoComputed } from "./calc";
