// The data dictionary and source-field coverage inventory (BUILD_SPEC 4.2
// rules 1 to 5 and 10). Human-readable version: docs/DATA_DICTIONARY.md.
export * from "./types";
export * from "./keys";
export {
  captionLabel,
  dataField,
  dataKeys,
  defaultLabels,
  DIMENSION_DECIMALS,
  fieldLabel,
  groupLabelKey,
  MODULE_DICTIONARY,
  moduleSpec,
  moduleTitle,
  VALIDATION_RULES,
  type ComputedKey,
  type ConfigKey,
  type DataKey,
  type Dictionary,
  type EnteredKey,
  type LabelKey,
  type SystemKey,
} from "./fields";
export * from "./defects";
export * from "./merge";
export * from "./templates";
export { SOURCE_DOCUMENTS, SOURCE_FIELDS, sourceFields, type SourceDocument } from "./sources";
