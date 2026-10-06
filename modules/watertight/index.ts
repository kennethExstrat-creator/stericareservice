// Freedom from Holes by watertight test (BUILD_SPEC 6.1): holes by location
// per ordered size, accepted or rejected per size by the AQL engine.
import { defineModule } from "@/modules/_framework";
import { calcWatertight, type WatertightComputed } from "./calc";
import {
  WATERTIGHT_DEFAULT_CONFIG,
  WATERTIGHT_LABELS,
  WATERTIGHT_TITLE,
  WatertightConfigSchema,
  type WatertightConfig,
} from "./config";
import { emptyWatertight, WatertightDataSchema, type WatertightData } from "./schema";

export const definition = defineModule<WatertightData, WatertightConfig, WatertightComputed>({
  key: "watertight",
  title: WATERTIGHT_TITLE,
  labels: WATERTIGHT_LABELS,
  dataSchema: WatertightDataSchema,
  emptyData: emptyWatertight,
  configSchema: WatertightConfigSchema,
  defaultConfig: WATERTIGHT_DEFAULT_CONFIG,
  perSize: true,
  handSplit: true,
  calc: calcWatertight,
});

export type { WatertightData } from "./schema";
export type { WatertightConfig } from "./config";
export type { WatertightComputed } from "./calc";
