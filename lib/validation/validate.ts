// Validating an inspection (BUILD_SPEC 6.2): every included module's own
// checks plus the framework's cross-module rules. Errors block submit and
// each links to its problem (module key and path); warnings are allowed and
// go into the export. The report also carries what the checks computed
// (results, computed values, the suggested result), so a screen or the
// submit action needs one call.
import type { ResolvedTemplate } from "@/lib/schemas/template";
import {
  evaluateInspection,
  type InspectionContext,
  type InspectionData,
  type InspectionEvaluation,
  type ModuleRegistry,
} from "@/modules/_framework";
import { MODULE_REGISTRY } from "@/modules/registry";
import { partitionIssues, type ValidationIssue } from "./issues";

export type ValidationReport = InspectionEvaluation & {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** No errors. Submit also waits for the photo upload queue (BUILD_SPEC 8.1). */
  canSubmit: boolean;
};

/**
 * @param template the inspection's resolved template with its module overrides applied
 * @param context built from the same template and data (buildInspectionContext)
 */
export function validateInspection(
  data: InspectionData,
  template: ResolvedTemplate,
  context: InspectionContext,
  registry: ModuleRegistry = MODULE_REGISTRY,
): ValidationReport {
  const evaluation = evaluateInspection({ template, data, context }, registry);
  const { errors, warnings } = partitionIssues(evaluation.issues);
  return { ...evaluation, errors, warnings, canSubmit: errors.length === 0 };
}
