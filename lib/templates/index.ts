// Templates (BUILD_SPEC 4): resolution down the extends chain, selection for
// a new inspection, per-inspection overrides, screen order, step short names
// and versions.
// Pure functions; the registry is passed in (`@/modules` binds the app's).
export {
  resolveTemplate,
  resolveTemplateOrThrow,
  lookupFrom,
  MAX_EXTENDS_DEPTH,
  type ResolveOptions,
  type TemplateBase,
  type TemplateLookup,
  type TemplateProblem,
  type TemplateResolution,
} from "./resolve";
export { mergeConfig, isJsonObject, isTagged, TAG_KEY, type JsonObject } from "./merge";
export { applyListedOrder, pinEnds } from "./module-order";
export {
  selectTemplate,
  rankTemplates,
  specificityOf,
  templateCandidateFromRow,
  SPECIFICITY,
  type RankedTemplate,
  type SelectionCriteria,
  type Specificity,
  type TemplateCandidate,
  type TemplateSelection,
  type TemplateStatus,
} from "./select";
export {
  applyModuleOverrides,
  parseModuleOverrides,
  moduleOverrideProblem,
  includedModules,
  excludedForInspection,
} from "./overrides";
export { templateSections, sectionOrder, type TemplateSection } from "./sections";
export {
  CUSTOM_SHORT_TITLES,
  MODULE_SHORT_TITLES,
  SHORT_TITLE_MAX,
  WORDING_SHORT_TITLES,
  customShortTitle,
  shortTitleFor,
  withoutNote,
} from "./short-titles";
export {
  nextVersion,
  planTemplateEdit,
  planActivation,
  staleBases,
  templateRowFields,
  type ActivationPlan,
  type StaleBase,
  type TemplateEditPlan,
  type TemplateEditTarget,
  type TemplateRowFields,
  type VersionRow,
} from "./versions";
