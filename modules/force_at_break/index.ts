// Force At Break in Newton (BUILD_SPEC 6.1, STD_EG): readings per glove,
// their median against the minimum, and the lab report.
import { defineModule } from "@/modules/_framework";
import { calcForceAtBreak, type ForceAtBreakComputed } from "./calc";
import {
  FORCE_AT_BREAK_DEFAULT_CONFIG,
  FORCE_AT_BREAK_LABELS,
  FORCE_AT_BREAK_TITLE,
  ForceAtBreakConfigSchema,
  type ForceAtBreakConfig,
} from "./config";
import { emptyForceAtBreak, ForceAtBreakDataSchema, type ForceAtBreakData } from "./schema";

export const definition = defineModule<ForceAtBreakData, ForceAtBreakConfig, ForceAtBreakComputed>({
  key: "force_at_break",
  title: FORCE_AT_BREAK_TITLE,
  labels: FORCE_AT_BREAK_LABELS,
  dataSchema: ForceAtBreakDataSchema,
  emptyData: emptyForceAtBreak,
  configSchema: ForceAtBreakConfigSchema,
  defaultConfig: FORCE_AT_BREAK_DEFAULT_CONFIG,
  perSize: true,
  calc: calcForceAtBreak,
  loadCapture: () => import("./Capture"),
});

export type { ForceAtBreakData } from "./schema";
export type { ForceAtBreakConfig } from "./config";
export type { ForceAtBreakComputed } from "./calc";
