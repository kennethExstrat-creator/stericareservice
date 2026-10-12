// One evaluation of an inspection, the same on the iPad, in the save and
// submit actions and in tests: the template with this inspection's module
// overrides applied and its titles as the inspection shows them, the context
// that flows forward, and the validation report (every included module's
// result, computed values and issues, the suggested result). Excluded
// modules, by the template or by an override, drop out of all three
// (BUILD_SPEC 4.4, 6.2).
import type { EntityRef } from "@/lib/schemas/common";
import type { ModuleOverrides, ResolvedTemplate } from "@/lib/schemas/template";
import { applyModuleOverrides } from "@/lib/templates";
import { validateInspection, type ValidationReport } from "@/lib/validation";
import { MODULE_REGISTRY } from "@/modules/registry";
import {
  buildInspectionContext,
  buildInspectionView,
  withShownTitles,
  type InspectionContext,
  type InspectionData,
  type InspectionFileRef,
  type ModuleRegistry,
} from "@/modules/_framework";

/** Facts from the inspection row that modules read through the context. */
export type CaptureMeta = {
  refNo: string | null;
  /** `YYYY-MM-DD`; a blank header date falls back to it. */
  inspectionDate: string | null;
  inspector: EntityRef | null;
  client: EntityRef | null;
  manufacturer: EntityRef | null;
  /**
   * The inspection's files (lab reports, certificates) as `{ id, moduleKey,
   * kind }`: whether a kept file is attached (docs/MODULES.md 10.1). The
   * actions read inspection_files; the screen adds this device's queued
   * files. Left out, or null, only while they are not known.
   */
  files?: readonly InspectionFileRef[] | null;
};

export type CaptureEvaluation = {
  /**
   * The inspection's copy of the template: overrides applied, titles as
   * shown (a count in a title follows the inspection, withShownTitles).
   */
  template: ResolvedTemplate;
  context: InspectionContext;
  report: ValidationReport;
};

type CaptureInput = {
  /** As stored in `templates.resolved`, without this inspection's overrides. */
  template: ResolvedTemplate;
  overrides: ModuleOverrides;
  data: InspectionData;
  meta: CaptureMeta;
};

export function evaluateCapture(
  { template, overrides, data, meta }: CaptureInput,
  registry: ModuleRegistry = MODULE_REGISTRY,
): CaptureEvaluation {
  const view = buildInspectionView({ template: applyModuleOverrides(template, overrides), data, meta }, registry);
  return { ...view, report: validateInspection(data, view.template, view.context, registry) };
}

/**
 * The template as stored (no overrides applied), with its titles as this
 * inspection shows them: for what reads the stored template and names a
 * module, such as the switch-off messages and the save's refusals. The
 * context comes from the inspection's copy, overrides applied, as on the
 * screen.
 */
export function storedTemplateWithShownTitles(
  { template, overrides, data, meta }: Omit<CaptureInput, "meta"> & { meta?: CaptureMeta },
  registry: ModuleRegistry = MODULE_REGISTRY,
): ResolvedTemplate {
  const context = buildInspectionContext({ template: applyModuleOverrides(template, overrides), data, meta }, registry);
  return withShownTitles(template, context, registry).template;
}
