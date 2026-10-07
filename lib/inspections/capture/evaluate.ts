// One evaluation of an inspection, the same on the iPad, in the save and
// submit actions and in tests: the template with this inspection's module
// overrides applied, the context that flows forward, and the validation
// report (every included module's result, computed values and issues, the
// suggested result). Excluded modules, by the template or by an override,
// drop out of all three (BUILD_SPEC 4.4, 6.2).
import type { EntityRef } from "@/lib/schemas/common";
import type { ModuleOverrides, ResolvedTemplate } from "@/lib/schemas/template";
import { applyModuleOverrides } from "@/lib/templates";
import { validateInspection, type ValidationReport } from "@/lib/validation";
import { MODULE_REGISTRY } from "@/modules/registry";
import {
  buildInspectionContext,
  type InspectionContext,
  type InspectionData,
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
};

export type CaptureEvaluation = {
  /** The inspection's copy of the template: overrides applied. */
  template: ResolvedTemplate;
  context: InspectionContext;
  report: ValidationReport;
};

export function evaluateCapture(
  {
    template,
    overrides,
    data,
    meta,
  }: {
    /** As stored in `templates.resolved`, without this inspection's overrides. */
    template: ResolvedTemplate;
    overrides: ModuleOverrides;
    data: InspectionData;
    meta: CaptureMeta;
  },
  registry: ModuleRegistry = MODULE_REGISTRY,
): CaptureEvaluation {
  const effective = applyModuleOverrides(template, overrides);
  const context = buildInspectionContext({ template: effective, data, meta }, registry);
  return { template: effective, context, report: validateInspection(data, effective, context, registry) };
}
