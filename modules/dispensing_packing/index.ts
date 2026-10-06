// Glove Packing Check (BUILD_SPEC 6.1 dispensing_packing): layering %,
// dispensing % and stickiness code per dispenser box, per ordered size.
import { defineModule } from "@/modules/_framework";
import { calcDispensingPacking, type DispensingPackingComputed } from "./calc";
import {
  DISPENSING_PACKING_DEFAULT_CONFIG,
  DISPENSING_PACKING_LABELS,
  DISPENSING_PACKING_TITLE,
  DispensingPackingConfigSchema,
  type DispensingPackingConfig,
} from "./config";
import { DispensingPackingDataSchema, emptyDispensingPacking, type DispensingPackingData } from "./schema";

export const definition = defineModule<DispensingPackingData, DispensingPackingConfig, DispensingPackingComputed>({
  key: "dispensing_packing",
  title: DISPENSING_PACKING_TITLE,
  labels: DISPENSING_PACKING_LABELS,
  dataSchema: DispensingPackingDataSchema,
  emptyData: emptyDispensingPacking,
  configSchema: DispensingPackingConfigSchema,
  defaultConfig: DISPENSING_PACKING_DEFAULT_CONFIG,
  perSize: true,
  calc: calcDispensingPacking,
  loadCapture: () => import("./Capture"),
});

export type { DispensingPackingData } from "./schema";
export type { DispensingPackingConfig } from "./config";
export type { DispensingPackingComputed } from "./calc";
