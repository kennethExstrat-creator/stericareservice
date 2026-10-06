// Glove Dispensing Inspection (BUILD_SPEC 6.1 dispensing_safedon): the six
// Safedon dispensing defects counted per box, the defect rate per ordered size.
import { defineModule } from "@/modules/_framework";
import { calcDispensingSafedon, type DispensingSafedonComputed } from "./calc";
import {
  DISPENSING_SAFEDON_DEFAULT_CONFIG,
  DISPENSING_SAFEDON_LABELS,
  DISPENSING_SAFEDON_TITLE,
  DispensingSafedonConfigSchema,
  type DispensingSafedonConfig,
} from "./config";
import { DispensingSafedonDataSchema, emptyDispensingSafedon, type DispensingSafedonData } from "./schema";

export const definition = defineModule<DispensingSafedonData, DispensingSafedonConfig, DispensingSafedonComputed>({
  key: "dispensing_safedon",
  title: DISPENSING_SAFEDON_TITLE,
  labels: DISPENSING_SAFEDON_LABELS,
  dataSchema: DispensingSafedonDataSchema,
  emptyData: emptyDispensingSafedon,
  configSchema: DispensingSafedonConfigSchema,
  defaultConfig: DISPENSING_SAFEDON_DEFAULT_CONFIG,
  perSize: true,
  calc: calcDispensingSafedon,
});

export type { DispensingSafedonData } from "./schema";
export type { DispensingSafedonConfig } from "./config";
export type { DispensingSafedonComputed } from "./calc";
