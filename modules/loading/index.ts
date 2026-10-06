// Loading (BUILD_SPEC 6.1, optional): container, seal, cartons loaded against the order.
import { defineModule } from "@/modules/_framework";
import { calcLoading, type LoadingComputed } from "./calc";
import { LOADING_DEFAULT_CONFIG, LOADING_LABELS, LOADING_TITLE, LoadingConfigSchema, type LoadingConfig } from "./config";
import { emptyLoading, LoadingDataSchema, type LoadingData } from "./schema";

export const definition = defineModule<LoadingData, LoadingConfig, LoadingComputed>({
  key: "loading",
  title: LOADING_TITLE,
  labels: LOADING_LABELS,
  dataSchema: LoadingDataSchema,
  emptyData: emptyLoading,
  configSchema: LoadingConfigSchema,
  defaultConfig: LOADING_DEFAULT_CONFIG,
  canonicalPaths: [
    { path: "containerNo", label: LOADING_LABELS.containerNo, type: "text" },
    { path: "sealNo", label: LOADING_LABELS.sealNo, type: "text" },
    { path: "cartonsLoaded", label: LOADING_LABELS.cartonsLoaded, type: "counter" },
    { path: "cartonCondition", label: LOADING_LABELS.cartonCondition, type: "textarea" },
  ],
  calc: calcLoading,
});

export type { LoadingData } from "./schema";
export type { LoadingConfig, LoadingField, LoadingStage } from "./config";
export type { LoadingComputed } from "./calc";
