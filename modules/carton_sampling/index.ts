// Finished Goods Sampling Information (BUILD_SPEC 6.1): the sampled carton
// numbers per size. Source of `cartons` in the context, which the box
// pickers of dispensing and labelling offer (6.2 rule 7).
import { defineModule } from "@/modules/_framework";
import { calcCartonSampling, contributeCartonSampling, type CartonSamplingComputed } from "./calc";
import {
  CARTON_SAMPLING_DEFAULT_CONFIG,
  CARTON_SAMPLING_LABELS,
  CARTON_SAMPLING_TITLE,
  CartonSamplingConfigSchema,
  type CartonSamplingConfig,
} from "./config";
import { CartonSamplingDataSchema, emptyCartonSampling, type CartonSamplingData } from "./schema";

export const definition = defineModule<CartonSamplingData, CartonSamplingConfig, CartonSamplingComputed>({
  key: "carton_sampling",
  title: CARTON_SAMPLING_TITLE,
  labels: CARTON_SAMPLING_LABELS,
  dataSchema: CartonSamplingDataSchema,
  emptyData: emptyCartonSampling,
  configSchema: CartonSamplingConfigSchema,
  defaultConfig: CARTON_SAMPLING_DEFAULT_CONFIG,
  perSize: true,
  calc: calcCartonSampling,
  contribute: contributeCartonSampling,
  loadCapture: () => import("./Capture"),
});

export type { CartonSamplingData, CartonSize } from "./schema";
export type { CartonSamplingConfig } from "./config";
export type { CartonSamplingComputed, CartonSizeComputed } from "./calc";
