// Dye leak test (BUILD_SPEC 6.1, optional): per size, pouches tested and failed.
import { defineModule } from "@/modules/_framework";
import { calcDyeLeak, type DyeLeakComputed } from "./calc";
import {
  DYE_LEAK_DEFAULT_CONFIG,
  DYE_LEAK_LABELS,
  DYE_LEAK_TITLE,
  DyeLeakConfigSchema,
  type DyeLeakConfig,
} from "./config";
import { DyeLeakDataSchema, emptyDyeLeak, type DyeLeakData } from "./schema";

export const definition = defineModule<DyeLeakData, DyeLeakConfig, DyeLeakComputed>({
  key: "dye_leak",
  title: DYE_LEAK_TITLE,
  labels: DYE_LEAK_LABELS,
  dataSchema: DyeLeakDataSchema,
  emptyData: emptyDyeLeak,
  configSchema: DyeLeakConfigSchema,
  defaultConfig: DYE_LEAK_DEFAULT_CONFIG,
  perSize: true,
  calc: calcDyeLeak,
});

export type { DyeLeakData, DyeLeakSize } from "./schema";
export type { DyeLeakConfig } from "./config";
export type { DyeLeakComputed, DyeLeakVerdict } from "./calc";
