// Defaults a template can override: the heading, the labels (the data
// dictionary's wording: no current form has a loading section, it comes from
// the QC scope on the website) and the config (BUILD_SPEC 6.1: fields on/off).
import { z } from "zod";

export const LOADING_TITLE = "Loading";

export const LOADING_FIELDS = ["containerNo", "sealNo", "cartonsLoaded", "cartonCondition"] as const;
export type LoadingField = (typeof LOADING_FIELDS)[number];

/**
 * Where loading photos are taken, in order. Photos are the module's own
 * (BUILD_SPEC 6.1); the stage in focus tags them. The stages are to confirm
 * with Kenneth (DATA_DICTIONARY loading note).
 */
export const LOADING_STAGES = ["emptyContainer", "halfLoaded", "fullyLoaded", "doorsClosed", "sealed"] as const;
export type LoadingStage = (typeof LOADING_STAGES)[number];

export const LOADING_LABELS: Readonly<Record<LoadingField | LoadingStage | "cartonsOrdered" | "loadingStage", string>> = {
  containerNo: "Container no.",
  sealNo: "Seal no.",
  cartonsLoaded: "Cartons loaded",
  cartonCondition: "Carton condition",
  cartonsOrdered: "Cartons ordered",
  loadingStage: "Loading stage",
  emptyContainer: "Empty container",
  halfLoaded: "Half loaded",
  fullyLoaded: "Fully loaded",
  doorsClosed: "Doors closed",
  sealed: "Sealed",
};

export const LoadingConfigSchema = z.strictObject({
  fields: z
    .strictObject({
      containerNo: z.boolean(),
      sealNo: z.boolean(),
      cartonsLoaded: z.boolean(),
      cartonCondition: z.boolean(),
    })
    .describe("Fields shown on this template"),
});
export type LoadingConfig = z.infer<typeof LoadingConfigSchema>;

export const LOADING_DEFAULT_CONFIG: LoadingConfig = {
  fields: { containerNo: true, sealNo: true, cartonsLoaded: true, cartonCondition: true },
};
