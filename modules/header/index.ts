// Manufacturer Information: always on (BUILD_SPEC 4.1); its rows switch on and off.
import { defineModule } from "@/modules/_framework";
import { calcHeader, contributeHeader, type HeaderComputed } from "./calc";
import { HEADER_DEFAULT_CONFIG, HEADER_LABELS, HEADER_TITLE, HeaderConfigSchema, type HeaderConfig } from "./config";
import { emptyHeader, HeaderDataSchema, type HeaderData } from "./schema";

export const definition = defineModule<HeaderData, HeaderConfig, HeaderComputed>({
  key: "header",
  title: HEADER_TITLE,
  labels: HEADER_LABELS,
  dataSchema: HeaderDataSchema,
  emptyData: emptyHeader,
  configSchema: HeaderConfigSchema,
  defaultConfig: HEADER_DEFAULT_CONFIG,
  canonicalPaths: [
    { path: "factoryAddress", label: HEADER_LABELS.factoryAddress, type: "textarea" },
    { path: "poNo", label: HEADER_LABELS.poNo, type: "text" },
    { path: "productName", label: HEADER_LABELS.productName, type: "textarea" },
    { path: "productCode", label: HEADER_LABELS.productCode, type: "text" },
    { path: "factoryGloveCode", label: HEADER_LABELS.factoryGloveCode, type: "text" },
    { path: "inspectionDate", label: HEADER_LABELS.inspectionDate, type: "date" },
    { path: "mfgDate", label: HEADER_LABELS.mfgDate, type: "date" },
    { path: "expiryDate", label: HEADER_LABELS.expiryDate, type: "date" },
  ],
  calc: calcHeader,
  contribute: contributeHeader,
});

export type { HeaderData } from "./schema";
export type { HeaderConfig } from "./config";
export type { HeaderComputed } from "./calc";
