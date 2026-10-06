// The data dictionary and source-field coverage inventory (BUILD_SPEC 4.2
// rules 1 to 5 and 10). Human-readable version: docs/DATA_DICTIONARY.md.
export * from "./types";
export * from "./keys";
export {
  captionLabel,
  dataField,
  fieldLabel,
  MODULE_DICTIONARY,
  moduleSpec,
  moduleTitle,
  VALIDATION_RULES,
  type ConfigKey,
  type DataKey,
  type Dictionary,
  type LabelKey,
} from "./fields";
export * from "./defects";
export * from "./templates";
export { SOURCE_DOCUMENTS, SOURCE_FIELDS, sourceFields, type SourceDocument } from "./sources";
