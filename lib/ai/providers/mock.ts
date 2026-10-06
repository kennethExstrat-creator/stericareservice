import type {
  AiEvidenceValue,
  AiFinding,
  AiQuestion,
  AiReview,
  ExportModule,
  FindingSeverity,
  InspectionExport,
  InspectionResult,
  ModuleStatus,
} from "@/lib/schemas";

/* ------------------------------------------------------------------ *
 * Deterministic stand-in for the AI second opinion: the same export
 * always gives the same review. For tests, local development and the
 * /api/dev/mock-ai-review receiver. It reads only the app's own module
 * results, so it never finds anything the app did not.
 * ------------------------------------------------------------------ */

type AttentionStatus = Extract<ModuleStatus, "fail" | "warn" | "not_done">;

interface Attention {
  module: ExportModule;
  status: AttentionStatus;
}

const SEVERITY: Record<AttentionStatus, FindingSeverity> = {
  fail: "critical",
  not_done: "major",
  warn: "minor",
};

const CONFIDENCE: Record<InspectionResult, number> = { pass: 0.9, hold: 0.6, fail: 0.85 };

const MAX_PHOTOS_PER_FINDING = 3;

export function mockReview(doc: InspectionExport): AiReview {
  const attention = doc.modules.flatMap((module): Attention[] => {
    const status = module.result.status;
    return needsAttention(status) ? [{ module, status }] : [];
  });
  const suggestedResult = suggest(attention);
  const questions: AiQuestion[] = isBlank(doc.conclusion.remark)
    ? [
        {
          id: "Q1",
          module: "conclusion",
          question: "The conclusion has no remark. What should the client know about this result?",
        },
      ]
    : [];

  return {
    suggestedResult,
    confidence: CONFIDENCE[suggestedResult],
    summary: summarize(doc.modules.length, attention, suggestedResult),
    findings: attention.map((item, index) => findingFor(doc, item, index)),
    questions,
  };
}

function needsAttention(status: ModuleStatus): status is AttentionStatus {
  return status === "fail" || status === "warn" || status === "not_done";
}

function suggest(attention: readonly Attention[]): InspectionResult {
  if (attention.some((item) => item.status === "fail")) return "fail";
  return attention.length > 0 ? "hold" : "pass";
}

function findingFor(doc: InspectionExport, { module, status }: Attention, index: number): AiFinding {
  const sizes = Object.entries(module.result.perSize ?? {}).filter(([, result]) => needsAttention(result.status));

  const values: AiEvidenceValue[] = [
    { label: "Module result", value: status, unit: null },
    ...sizes.map(([size, result]) => ({ label: `Size ${size}`, value: result.status, unit: null })),
    ...module.warnings.map((warning) => ({
      label: warning.size ? `Warning ${warning.code}, size ${warning.size}` : `Warning ${warning.code}`,
      value: warning.message,
      unit: null,
    })),
  ];

  return {
    id: `F${index + 1}`,
    module: module.key,
    size: sizes.length === 1 ? sizes[0][0] : null,
    severity: SEVERITY[status],
    message: messageFor(module.title, status, module.result.summary),
    evidence: {
      values,
      boxes: [],
      photos: doc.photos
        .filter((photo) => photo.moduleKey === module.key)
        .slice(0, MAX_PHOTOS_PER_FINDING)
        .map((photo) => photo.id),
    },
  };
}

function messageFor(title: string, status: AttentionStatus, summary: string): string {
  const lead = {
    fail: `${title} failed.`,
    warn: `${title} has a warning.`,
    not_done: `${title} is not done.`,
  }[status];
  return isBlank(summary) ? lead : `${lead} ${summary}`;
}

function summarize(moduleCount: number, attention: readonly Attention[], result: InspectionResult): string {
  const lead = "Mock second opinion (test data, no AI model).";
  if (attention.length === 0) {
    return `${lead} All ${moduleCount} modules passed or are informational. Suggested result: ${result}.`;
  }
  const count = (status: AttentionStatus) => attention.filter((item) => item.status === status).length;
  return (
    `${lead} ${attention.length} of ${moduleCount} modules need attention: ` +
    `${count("fail")} failed, ${count("warn")} with warnings, ${count("not_done")} not done. ` +
    `Suggested result: ${result}.`
  );
}

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim() === "";
}
