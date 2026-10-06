// The review's results: the framework's evaluation over the inspection's
// stored data and the exact template version it was started with, with the
// admin's per-inspection overrides applied (BUILD_SPEC 4.4, 6.2). The same
// calls the capture screen and the export make (docs/MODULES.md section 13),
// so the three agree. Pure: the page loads the row, this computes.
import { InspectionResultSchema, type EntityRef, type InspectionResult } from "@/lib/schemas/common";
import { ResolvedTemplateSchema, type ResolvedTemplate } from "@/lib/schemas/template";
import { applyModuleOverrides, parseModuleOverrides } from "@/lib/templates";
import { validateInspection, type ValidationIssue, type ValidationReport } from "@/lib/validation";
import {
  buildInspectionContext,
  InspectionDataSchema,
  readPath,
  type InspectionContext,
  type InspectionData,
  type ModuleRegistry,
} from "@/modules/_framework";
import { MODULE_REGISTRY } from "@/modules/registry";

/** What the evaluation needs from the inspection row. */
export type StoredInspection = {
  refNo: string;
  inspectionDate: string;
  /** `inspections.data`. */
  data: unknown;
  /** `inspections.module_overrides`. */
  moduleOverrides: unknown;
  /** `templates.resolved` of the inspection's template version. */
  resolved: unknown;
  inspector: EntityRef | null;
  client: EntityRef | null;
  manufacturer: EntityRef | null;
};

export type ReviewEvaluation =
  | {
      ok: true;
      /** The inspection's copy of the template: overrides applied. */
      template: ResolvedTemplate;
      context: InspectionContext;
      report: ValidationReport;
      summary: IssueSummary;
    }
  | { ok: false; problem: "template" | "data"; message: string };

/**
 * The counts the review leads with. A module that is not done already says
 * so with its own "Not done" result, so the framework's `module_not_done`
 * warning is counted under notDone, not warnings: the screen lists every
 * other issue under its module.
 */
export type IssueSummary = {
  errors: number;
  warnings: number;
  /** Included modules whose result is not done. */
  notDone: number;
};

export const NOT_DONE_CODE = "module_not_done";

/** True for the issues the review lists under their module: all but the not-done warning. */
export function isListedIssue(issue: Pick<ValidationIssue, "code" | "level">): boolean {
  return !(issue.code === NOT_DONE_CODE && issue.level === "warning");
}

export function summariseIssues(report: Pick<ValidationReport, "errors" | "warnings" | "modules">): IssueSummary {
  return {
    errors: report.errors.length,
    warnings: report.warnings.filter(isListedIssue).length,
    notDone: report.modules.filter((entry) => entry.result.status === "not_done").length,
  };
}

export function evaluateStoredInspection(
  stored: StoredInspection,
  registry: ModuleRegistry = MODULE_REGISTRY,
): ReviewEvaluation {
  const resolved = ResolvedTemplateSchema.safeParse(stored.resolved);
  if (!resolved.success) {
    return {
      ok: false,
      problem: "template",
      message:
        "The template version this inspection uses could not be read, so its results cannot be worked out. Ask a developer to check the template.",
    };
  }
  const data = readInspectionData(stored.data);
  if (!data) {
    return {
      ok: false,
      problem: "data",
      message: "The inspection's saved data could not be read, so its results cannot be worked out. Ask a developer to check it.",
    };
  }

  const template = applyModuleOverrides(resolved.data, parseModuleOverrides(stored.moduleOverrides));
  const context = buildInspectionContext(
    {
      template,
      data,
      meta: {
        refNo: stored.refNo,
        inspectionDate: stored.inspectionDate,
        inspector: stored.inspector,
        client: stored.client,
        manufacturer: stored.manufacturer,
      },
    },
    registry,
  );
  const report = validateInspection(data, template, context, registry);
  return { ok: true, template, context, report, summary: summariseIssues(report) };
}

/** The inspector's final result and remark. */
export type InspectorDecision = { result: InspectionResult | null; remarks: string | null };

/**
 * The inspector's final result and remark: the row's `result` and `remarks`,
 * which lists and approval read, else what the conclusion saved
 * (docs/DATA_DICTIONARY.md: `conclusion.finalResult` and `conclusion.remark`
 * are those columns) as the evaluation parsed it. Capture copies them into
 * the row; until it has, the conclusion's own values stand in. The export's
 * conclusion block takes them the same way, so the review and the export
 * (and the AI second opinion fed from it) never disagree.
 */
export function inspectorDecision(row: InspectorDecision, evaluation: ReviewEvaluation): InspectorDecision {
  const saved = evaluation.ok ? evaluation.report.modules.find((entry) => entry.key === "conclusion")?.data : undefined;
  return {
    result: row.result ?? InspectionResultSchema.safeParse(readPath(saved, ["finalResult"])).data ?? null,
    remarks: textOrNull(row.remarks) ?? textOrNull(readPath(saved, ["remark"])),
  };
}

/** Trimmed text, or null when there is none. */
function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** `{ modules, custom }`; a missing namespace is empty, anything else that is not an object is unreadable. */
function readInspectionData(value: unknown): InspectionData | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const parsed = InspectionDataSchema.safeParse({ modules: {}, custom: {}, ...value });
  return parsed.success ? parsed.data : null;
}
