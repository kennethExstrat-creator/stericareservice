// Sampling Plan (BUILD_SPEC 6.1): what was sampled per size and n for every
// test that follows. Source of `sampling` and the inspection level in the
// context (docs/MODULES.md section 7).
import { defineModule } from "@/modules/_framework";
import { calcSamplingPlan, contributeSamplingPlan, type SamplingPlanComputed } from "./calc";
import {
  SAMPLING_PLAN_DEFAULT_CONFIG,
  SAMPLING_PLAN_LABELS,
  SAMPLING_PLAN_TITLE,
  SamplingPlanConfigSchema,
  type SamplingPlanConfig,
} from "./config";
import { emptySamplingPlan, SamplingPlanDataSchema, type SamplingPlanData } from "./schema";

export const definition = defineModule<SamplingPlanData, SamplingPlanConfig, SamplingPlanComputed>({
  key: "sampling_plan",
  title: SAMPLING_PLAN_TITLE,
  labels: SAMPLING_PLAN_LABELS,
  dataSchema: SamplingPlanDataSchema,
  emptyData: emptySamplingPlan,
  configSchema: SamplingPlanConfigSchema,
  defaultConfig: SAMPLING_PLAN_DEFAULT_CONFIG,
  perSize: true,
  calc: calcSamplingPlan,
  contribute: contributeSamplingPlan,
  loadCapture: () => import("./Capture"),
});

export type { SamplingPlanData, SamplingSize } from "./schema";
export type { SamplingPlanConfig, SamplingColumn } from "./config";
export type { SamplingPlanComputed, SizePlan } from "./calc";
