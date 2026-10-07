// The engine: runs every included module of an inspection and applies the
// framework's rules on top, so each result obeys BUILD_SPEC 6.2 whatever the
// module returns. One pure pass gives the capture screen its chips, live
// totals and issue list, submit its errors, and the export everything it
// needs. A module whose data, config, calc or contribution is broken shows an
// error, and "not done" where its own result cannot be trusted; it never
// takes the other modules down.
import { z } from "zod";
import { ModuleResultSchema, type ModuleKey, type ModuleResult } from "@/lib/schemas/module-result";
import { JsonObjectSchema, type CustomModule, type ResolvedModule, type ResolvedTemplate } from "@/lib/schemas/template";
import { excludedForInspection } from "@/lib/templates/overrides";
import { sectionOrder } from "@/lib/templates/sections";
import { evaluateCustomValues } from "@/lib/validation/custom";
import {
  IssuePathSchema,
  sortIssues,
  stampIssues,
  ValidationIssueSchema,
  type CalcIssue,
  type IssuePath,
  type ValidationIssue,
} from "@/lib/validation/issues";
import { enforceResultRules, notDone, perSizeResults } from "@/lib/validation/results";
import {
  calcFailedIssues,
  contributeFailedIssues,
  describeDataPath,
  inspectorIssues,
  invalidConfigIssues,
  invalidDataIssues,
  invalidOutputIssues,
  notDoneIssues,
  restrictToOrderedSizes,
  sizeDuplicateIssues,
  sizeNotOrderedIssues,
} from "@/lib/validation/rules";
import { suggestResult, type SuggestedResult } from "@/lib/validation/suggested-result";
import type { AnyModuleDefinition, JsonObject, ModuleDefinition, ModuleRegistry } from "./contract";
import { readableData, type InspectionContext } from "./context";
import { parseModuleData, readModuleEntry, type InspectionData, type ModuleEntry } from "./data";
import { effectiveLabels } from "./labels";
import { calcOrder, resultsFor } from "./order";
import { parseCanonicalPath, readPath } from "./paths";

export type ModuleEvaluation<TComputed extends JsonObject = JsonObject> = {
  key: ModuleKey;
  title: string;
  /** The template's labels over the module's defaults (effectiveLabels): what calc saw and the export shows. */
  labels: Readonly<Record<string, string>>;
  /** Effective config as parsed; the template's raw config when it is invalid. */
  config: unknown;
  /**
   * Saved data as parsed, ordered sizes only: what calc saw and the export
   * shows. Null when unreadable. Not for Capture, which edits every saved
   * size (parseModuleData).
   */
  data: unknown;
  hasData: boolean;
  comment: string | null;
  computed: TComputed;
  /** After the framework's rules: never a pass with missing data, no unordered sizes. */
  result: ModuleResult;
  issues: ValidationIssue[];
  stub: boolean;
};

export type CustomModuleEvaluation = {
  custom: CustomModule;
  values: Record<string, unknown>;
  comment: string | null;
  issues: ValidationIssue[];
};

export type ExcludedModule = { key: ModuleKey; title: string; reason: string };

export type InspectionEvaluation = {
  /** Included modules in template order. */
  modules: ModuleEvaluation[];
  /** Switched off for this inspection, with the reason. */
  excluded: ExcludedModule[];
  custom: CustomModuleEvaluation[];
  /** Every issue, in screen order. */
  issues: ValidationIssue[];
  suggested: SuggestedResult;
};

export type EvaluateInput = {
  /** With per-inspection overrides applied (lib/templates applyModuleOverrides). */
  template: ResolvedTemplate;
  data: InspectionData;
  /** Built from the same template and data (buildInspectionContext). */
  context: InspectionContext;
};

export function evaluateInspection({ template, data, context }: EvaluateInput, registry: ModuleRegistry): InspectionEvaluation {
  const included = template.modules.filter((module) => module.include);
  const keys = included.map((module) => module.key);
  const results = new Map<ModuleKey, ModuleResult>();
  const evaluated = new Map<ModuleKey, ModuleEvaluation>();

  for (const key of calcOrder(keys, registry)) {
    const resolved = included.find((candidate) => candidate.key === key);
    if (!resolved) continue;
    const evaluation = evaluateModule(resolved, registry[key], data, context, resultsFor(key, keys, results, registry));
    results.set(key, evaluation.result);
    evaluated.set(key, evaluation);
  }

  const modules = keys.flatMap((key) => evaluated.get(key) ?? []);
  const custom = template.customModules.map((module) => evaluateCustomModule(module, data, context));
  const issues = sortIssues(
    [
      ...modules.flatMap((module) => module.issues),
      ...custom.flatMap((module) => module.issues),
      ...inspectorIssues(context.inspection.inspector),
    ],
    sectionOrder(template),
  );
  const suggested = suggestResult(
    modules.map((module) => ({ key: module.key, status: module.result.status, title: module.title })),
  );
  return { modules, excluded: excludedForInspection(template), custom, issues, suggested };
}

const CalcIssuesSchema = z.array(ValidationIssueSchema.omit({ moduleKey: true }));

function evaluateModule(
  resolved: ResolvedModule,
  definition: AnyModuleDefinition,
  data: InspectionData,
  context: InspectionContext,
  results: Partial<Record<ModuleKey, ModuleResult>>,
): ModuleEvaluation {
  const { key, title } = resolved;
  const labels = effectiveLabels(definition, resolved);
  const entry = readModuleEntry(data, "modules", key);
  const rules = { perSize: definition.perSize, sizes: context.sizes, hasData: entry.hasData };
  const base = { key, title, labels, hasData: entry.hasData, comment: entry.comment, stub: definition.stub };

  const broken = (config: unknown, moduleData: unknown, summary: string, issues: CalcIssue[]): ModuleEvaluation => ({
    ...base,
    config,
    data: moduleData,
    computed: {},
    result: definition.perSize
      ? { ...notDone(summary), perSize: perSizeResults(context.sizes, () => ({ status: "not_done" })) }
      : notDone(summary),
    issues: stampIssues(key, issues),
  });

  const contributed = contributeFailedIssues(
    title,
    context.contributionErrors.filter((error) => error.moduleKey === key).map((error) => error.message),
  );

  // Module code runs in the schemas' refinements too, not only in calc.
  try {
    const config = definition.configSchema.safeParse(resolved.config);
    if (!config.success) {
      return broken(resolved.config, null, "Template settings are invalid.", invalidConfigIssues(title, config.error));
    }
    const parsed = parseModuleData(definition, entry);
    if (!parsed.success) {
      return broken(config.data, null, "Saved data could not be read.", [
        ...contributed,
        ...invalidDataIssues(title, parsed.error, [], {
          describe: (path) => describeDataPath(path, labels),
          consequence: unreadableConsequence(definition, entry),
        }),
      ]);
    }

    const { data: moduleData, ignored, duplicates } = definition.perSize
      ? restrictToOrderedSizes(parsed.data, context.sizes)
      : { data: parsed.data, ignored: [], duplicates: [] };
    const issues: CalcIssue[] = [
      ...contributed,
      ...sizeNotOrderedIssues(ignored, title),
      ...sizeDuplicateIssues(duplicates, title),
    ];

    let output: ReturnType<AnyModuleDefinition["calc"]>;
    try {
      output = definition.calc({
        data: moduleData,
        config: config.data,
        title,
        labels,
        context,
        results,
        hasData: entry.hasData,
      });
    } catch (error) {
      return broken(config.data, moduleData, "Could not be calculated.", [...issues, ...calcFailedIssues(title, error)]);
    }

    const result = ModuleResultSchema.safeParse(output.result);
    if (!result.success) {
      return broken(config.data, moduleData, "Could not be calculated.", [
        ...issues,
        ...invalidOutputIssues(title, "result"),
      ]);
    }
    const computed = JsonObjectSchema.safeParse(output.computed);
    if (!computed.success) issues.push(...invalidOutputIssues(title, "set of computed values"));
    const own = CalcIssuesSchema.safeParse(output.issues);
    issues.push(...(own.success ? own.data : invalidOutputIssues(title, "issue list")));

    const final = enforceResultRules(result.data, rules);
    issues.push(...notDoneIssues(title, final, definition.requiredForSubmit, notDonePathOf(output)));
    return {
      ...base,
      config: config.data,
      data: moduleData,
      computed: computed.success ? computed.data : {},
      result: final,
      issues: stampIssues(key, issues),
    };
  } catch (error) {
    return broken(resolved.config, null, "Could not be calculated.", [...contributed, ...calcFailedIssues(title, error)]);
  }
}

/** The field calc names for its not-done link, when it is a valid path; else the module. */
function notDonePathOf(output: { readonly notDonePath?: unknown }): IssuePath {
  const path = IssuePathSchema.safeParse(output.notDonePath ?? []);
  return path.success ? path.data : [];
}

/**
 * What the other modules do while a source module's saved data cannot be
 * read in full: they use what can be read (readableData), or get nothing
 * from it. Said on each of its invalid_data errors, so a size that drops out
 * of every module is never a silent loss.
 */
function unreadableConsequence(definition: AnyModuleDefinition, entry: ModuleEntry): string {
  if (!definition.contribute) return "";
  return readableData(definition, entry) === null
    ? "Until it is corrected, the other sections get nothing from this one."
    : "Until it is corrected, the other sections use the rest of what is saved here.";
}

/**
 * One module's evaluation with its computed values typed as the module
 * declares them, for code that holds the definition: a module's own tests,
 * a screen that renders one module's Capture. Null when the inspection does
 * not include the module.
 */
export function evaluationOf<TComputed extends JsonObject>(
  evaluation: Pick<InspectionEvaluation, "modules">,
  definition: Pick<ModuleDefinition<unknown, unknown, TComputed>, "key" | "calc">,
): ModuleEvaluation<TComputed> | null {
  const found = evaluation.modules.find((entry) => entry.key === definition.key);
  // computed was checked to be a JSON object; its shape is the module's own (calc built it).
  return (found as ModuleEvaluation<TComputed> | undefined) ?? null;
}

function evaluateCustomModule(
  custom: CustomModule,
  data: InspectionData,
  context: InspectionContext,
): CustomModuleEvaluation {
  const entry = readModuleEntry(data, "custom", custom.key);
  const { values, issues } = evaluateCustomValues({
    custom,
    value: entry.value,
    sizes: context.sizes,
    readMapped: (mapsTo) => {
      const target = parseCanonicalPath(mapsTo);
      return target ? readPath(readModuleEntry(data, "modules", target.moduleKey).value, target.segments) : undefined;
    },
  });
  return { custom, values, comment: entry.comment, issues: stampIssues(custom.key, issues) };
}
