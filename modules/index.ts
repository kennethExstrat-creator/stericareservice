// The app's entry to the module engine, bound to the registry: screens,
// server actions and the export import from `@/modules`. Module code never
// does (it would import itself through the registry); it uses
// `@/modules/_framework`.
import { resolveTemplate as resolveWith, type TemplateLookup, type TemplateResolution } from "@/lib/templates";
import {
  buildInspectionContext as buildWith,
  evaluateInspection as evaluateWith,
  type BuildContextInput,
  type EvaluateInput,
  type InspectionContext,
  type InspectionEvaluation,
} from "./_framework";
import { MODULE_REGISTRY } from "./registry";

export { MODULE_REGISTRY, getModuleDefinition } from "./registry";

/** Numbers that flow forward, from the inspection's data (modules/_framework/context.ts). */
export function buildInspectionContext(input: BuildContextInput): InspectionContext {
  return buildWith(input, MODULE_REGISTRY);
}

/** Every included module's result, computed values and issues, and the suggested result. */
export function evaluateInspection(input: EvaluateInput): InspectionEvaluation {
  return evaluateWith(input, MODULE_REGISTRY);
}

/** A template definition resolved down its extends chain against the real modules. */
export function resolveTemplate(definition: unknown, getBase: TemplateLookup): TemplateResolution {
  return resolveWith(definition, { getBase, registry: MODULE_REGISTRY });
}
