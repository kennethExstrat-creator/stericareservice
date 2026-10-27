import type { AiStatus } from "@/lib/ai/status";
import { conclusionOf } from "@/lib/export/assemble";
import type { EvaluatedInspection } from "@/lib/export/evaluate";
import type { InspectionRecord } from "@/lib/export/record";
import type { AiFinding, AiQuestion, AiReviewActionKind } from "@/lib/schemas/ai-review";
import type { InspectionStatus } from "@/lib/schemas/common";
import type { ModuleStatus } from "@/lib/schemas/module-result";
import type { CustomModule } from "@/lib/schemas/template";
import type { ValidationIssue } from "@/lib/validation";
import { tagLine } from "@/components/qc/photo-tags";
import { photoTags, photoWording, type SectionWording } from "@/lib/inspections/review/photos";
import { readModuleEntry, sizeLabel, type ModuleEvaluation } from "@/modules/_framework";
import { inspectionFingerprint } from "./fingerprint";
import { confidencePercent, formatDateTime } from "./format";
import {
  aiReviewSourceLabel,
  isSameVersion,
  isStale,
  STOPPED_MESSAGE,
  type InspectionVersion,
  type StoredAiReview,
} from "./stored";
import type {
  AiPanelModel,
  DecisionModel,
  FindingModel,
  HandoffModel,
  PhotoEvidenceModel,
  QuestionModel,
  ReviewModel,
  SectionModel,
} from "./types";

/* ------------------------------------------------------------------ *
 * The review panel's view model (BUILD_SPEC 9.2): for each section of
 * the inspection, the system's computed result, the inspector's comment
 * and the AI's findings and questions, side by side; the overall results
 * on top; every review kept per inspection version (its content,
 * fingerprint.ts). Pure: the loader (panel.ts) reads, this arranges, and
 * the tests cover the arranging.
 * ------------------------------------------------------------------ */

/** Second opinions are for these inspections (BUILD_SPEC 9.2). */
export const AI_STATUSES: readonly InspectionStatus[] = ["submitted", "approved"];

export const NOT_REVIEWABLE = "Second opinions are for submitted or approved inspections.";
export const ALREADY_PENDING = "A second opinion of this version is being written.";

/** One recorded decision on a finding (ai_review_actions), with the admin's name. */
export type StoredDecision = {
  reviewId: string;
  findingId: string;
  action: AiReviewActionKind;
  note: string | null;
  at: string;
  actor: string;
};

export type PanelModelInput = {
  record: InspectionRecord;
  evaluated: EvaluatedInspection;
  /** Newest first. */
  reviews: readonly StoredAiReview[];
  /** Empty for inspectors: only admins read decisions (RLS). */
  decisions: readonly StoredDecision[];
  /** Photo id to signed URL, for the photos findings cite. */
  photoLinks: { thumbs: ReadonlyMap<string, string>; full: ReadonlyMap<string, string> };
  aiStatus: AiStatus;
  /** The signed-in user: their half-made decisions are kept on this device under their id. */
  viewerId: string;
  /** Sees every inspection: reads the decisions (RLS) and the set-up details. */
  isAdmin: boolean;
  /**
   * What the user's role allows here (lib/auth/permissions.ts): asking for a
   * second opinion and deciding on its findings (Steri-AI Second Opinion).
   */
  allows: { secondOpinion: boolean };
  /**
   * The master list's names (defect_codes) of defects the cited photos are
   * tagged with that their module has no label for, as the review's report
   * photos and the gallery name them. Left out: such a defect shows as tagged.
   */
  defectNames?: ReadonlyMap<string, string>;
  /** Milliseconds since the epoch. */
  now: number;
};

export function buildAiPanelModel(input: PanelModelInput): AiPanelModel {
  const { record, evaluated, reviews, isAdmin, allows, aiStatus, now } = input;
  // Cited photos are worded as the review's report photos are: module, size, defect, level and entry.
  const wording = photoWording(evaluated);
  // The version reviews are compared with: the inspection's content as it is now.
  const version: InspectionVersion = { fingerprint: inspectionFingerprint(record), updatedAt: record.updatedAt };
  const toReview = (review: StoredAiReview) => reviewModel(review, input, wording, version);

  // The AI column shows the newest finished review; a newer request that is
  // still running, failed or stopped is the attempt shown above it.
  const current = reviews.find((review) => review.status === "done") ?? null;
  const newest = reviews[0] ?? null;
  const attempt = newest && newest.status !== "done" ? newest : null;
  const history = reviews.filter((review) => review !== current && review !== attempt);

  const reviewable = AI_STATUSES.includes(record.status);
  const runningNow = reviews.some(
    (review) => review.status === "pending" && !isStale(review, now) && isSameVersion(review, version),
  );
  const reviewHandoff = handoff(aiStatus.review, isAdmin, aiStatus.review.provider === "mock");

  const currentModel = current ? toReview(current) : null;
  const findings = currentModel?.findings ?? [];
  const questions = currentModel?.questions ?? [];
  const conclusion = conclusionOf(record, evaluated);
  const conclusionEvaluation = evaluated.report.modules.find((module) => module.key === "conclusion");

  const all = sectionModels(evaluated, findings, questions);
  const sections = all.filter(isNotable);
  const quiet = all
    .filter((section) => !isNotable(section))
    .map(({ key, title, system }) => ({ key, title, status: system.status }));

  return {
    inspection: {
      id: record.id,
      refNo: record.refNo,
      status: record.status,
      updatedAt: record.updatedAt,
      savedAt: formatDateTime(record.updatedAt),
    },
    viewer: { id: input.viewerId, isAdmin, canDecide: allows.secondOpinion },
    review: {
      ...reviewHandoff,
      canRequest: allows.secondOpinion && reviewHandoff.connected && reviewable && !runningNow,
      blockedReason: !reviewable ? NOT_REVIEWABLE : runningNow ? ALREADY_PENDING : null,
      switchedOff: aiStatus.review.switchedOff === true,
    },
    current: currentModel,
    attempt: attempt ? toReview(attempt) : null,
    history: history.map(toReview),
    overall: {
      // The summary says why, never the overall result (the pill beside it says that); empty for a clean pass.
      system: { result: evaluated.report.suggested.result, summary: evaluated.report.suggested.summary },
      inspector: {
        name: evaluated.inspector.name,
        finalResult: conclusion.finalResult,
        remark: conclusion.remark,
        comment: conclusionEvaluation?.comment ?? null,
      },
      ai: {
        findings: findings.filter((finding) => finding.module === "conclusion"),
        questions: questions.filter((question) => question.module === null || question.module === "conclusion"),
      },
    },
    sections,
    quiet,
    pendingIds: reviews
      .filter((review) => review.status === "pending" && !isStale(review, now))
      .map((review) => review.id),
  };
}

function handoff(
  status: { connected: boolean; label: string; detail?: string },
  isAdmin: boolean,
  mock: boolean,
): HandoffModel {
  // The detail names the variable to fix: for admins, who can fix it.
  return { connected: status.connected, label: status.label, detail: isAdmin ? (status.detail ?? null) : null, mock };
}

/* ------------------------------------------------------------------ *
 * Sections: modules, custom modules and modules switched off, in
 * template order. The conclusion is the overall row instead.
 * ------------------------------------------------------------------ */

function sectionModels(
  evaluated: EvaluatedInspection,
  findings: readonly FindingModel[],
  questions: readonly QuestionModel[],
): SectionModel[] {
  const { template, report } = evaluated;
  const byModule = new Map(report.modules.map((module) => [module.key as string, module]));
  const customAfter = new Map<string, CustomModule[]>();
  for (const custom of template.customModules) {
    customAfter.set(custom.after, [...(customAfter.get(custom.after) ?? []), custom]);
  }
  const customs = new Map(report.custom.map((entry) => [entry.custom.key, entry]));
  const ai = (key: string) => ({
    findings: findings.filter((finding) => finding.module === key),
    questions: questions.filter((question) => question.module === key),
  });

  const sections: SectionModel[] = [];
  const addCustom = (custom: CustomModule) => {
    const entry = customs.get(custom.key);
    sections.push({
      key: custom.key,
      title: custom.title,
      kind: "custom",
      system: {
        status: null,
        summary: null,
        perSize: [],
        ...issueTexts(entry?.issues ?? []),
        excludedReason: null,
      },
      inspector: { comment: entry?.comment ?? null },
      ai: ai(custom.key),
    });
  };

  for (const entry of template.modules) {
    const evaluation = byModule.get(entry.key);
    if (entry.include && evaluation && entry.key !== "conclusion") {
      sections.push(moduleSection(evaluated, evaluation, ai(entry.key)));
    } else if (!entry.include && entry.override) {
      sections.push({
        key: entry.key,
        title: entry.title,
        kind: "excluded",
        system: { status: null, summary: null, perSize: [], warnings: [], errors: [], excludedReason: entry.override.reason },
        inspector: { comment: readModuleEntry(evaluated.data, "modules", entry.key).comment },
        ai: ai(entry.key),
      });
    }
    for (const custom of customAfter.get(entry.key) ?? []) addCustom(custom);
    customAfter.delete(entry.key);
  }
  for (const orphans of customAfter.values()) orphans.forEach(addCustom);

  // A review of an earlier version can name a section this version no longer has.
  const known = new Set([...sections.map((section) => section.key), "conclusion"]);
  const others = [...new Set([...findings.map((f) => f.module), ...questions.flatMap((q) => (q.module ? [q.module] : []))])];
  for (const key of others.filter((candidate) => !known.has(candidate))) {
    sections.push({
      key,
      title: key,
      kind: "other",
      system: { status: null, summary: null, perSize: [], warnings: [], errors: [], excludedReason: null },
      inspector: { comment: null },
      ai: ai(key),
    });
  }
  return sections;
}

function moduleSection(
  evaluated: EvaluatedInspection,
  evaluation: ModuleEvaluation,
  ai: SectionModel["ai"],
): SectionModel {
  const own = evaluated.report.issues.filter((issue) => issue.moduleKey === evaluation.key);
  return {
    key: evaluation.key,
    title: evaluation.title,
    kind: "module",
    system: {
      status: evaluation.result.status,
      summary: blankToNull(evaluation.result.summary),
      perSize: Object.entries(evaluation.result.perSize ?? {}).map(([size, result]) => ({
        size,
        label: sizeLabel(evaluated.context, size),
        status: result.status,
        summary: blankToNull(result.summary),
      })),
      ...issueTexts(own),
      excludedReason: null,
    },
    inspector: { comment: evaluation.comment },
    ai,
  };
}

function issueTexts(issues: readonly ValidationIssue[]): { warnings: string[]; errors: string[] } {
  return {
    warnings: issues.filter((issue) => issue.level === "warning").map((issue) => issue.message),
    errors: issues.filter((issue) => issue.level === "error").map((issue) => issue.message),
  };
}

const QUIET_STATUSES: ReadonlySet<ModuleStatus | null> = new Set<ModuleStatus | null>(["pass", "info", null]);

/** Something to compare: a result to look at, a comment, a finding or a question. */
function isNotable(section: SectionModel): boolean {
  return (
    section.kind === "excluded" ||
    section.kind === "other" ||
    !QUIET_STATUSES.has(section.system.status) ||
    section.system.warnings.length > 0 ||
    section.system.errors.length > 0 ||
    section.inspector.comment !== null ||
    section.ai.findings.length > 0 ||
    section.ai.questions.length > 0
  );
}

/* ------------------------------------------------------------------ *
 * Reviews, findings and decisions
 * ------------------------------------------------------------------ */

function reviewModel(
  review: StoredAiReview,
  input: PanelModelInput,
  wording: SectionWording,
  version: InspectionVersion,
): ReviewModel {
  const stale = isStale(review, input.now);
  const state = stale ? "stopped" : review.status;
  const done = review.status === "done";
  return {
    id: review.id,
    state,
    source: aiReviewSourceLabel(review.model),
    requestedAt: formatDateTime(review.createdAt),
    version: formatDateTime(review.inspectionUpdatedAt),
    isCurrentVersion: isSameVersion(review, version),
    comparedBy: review.inspectionFingerprint === null ? "save" : "content",
    suggestedResult: done ? review.suggestedResult : null,
    confidencePct: done ? confidencePercent(review.confidence) : null,
    summary: done ? blankToNull(review.summary) : null,
    problem:
      state === "failed"
        ? (blankToNull(review.summary) ?? "The second opinion failed.")
        : state === "stopped"
          ? STOPPED_MESSAGE
          : null,
    readable: review.readable,
    findings: done ? review.findings.map((finding) => findingModel(review.id, finding, input, wording)) : [],
    questions: done ? review.questions.map(questionModel) : [],
  };
}

function findingModel(
  reviewId: string,
  finding: AiFinding,
  input: PanelModelInput,
  wording: SectionWording,
): FindingModel {
  const decisions = input.decisions
    .filter((decision) => decision.reviewId === reviewId && decision.findingId === finding.id)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .map(decisionModel);
  return {
    id: finding.id,
    module: finding.module,
    severity: finding.severity,
    size: finding.size,
    message: finding.message,
    evidence: {
      values: finding.evidence.values.map((value) => ({ label: value.label, value: value.value, unit: value.unit ?? null })),
      boxes: finding.evidence.boxes,
      photos: finding.evidence.photos.map((id) => photoEvidence(id, input, wording)),
    },
    decision: decisions[0] ?? null,
    history: decisions.slice(1),
  };
}

function photoEvidence(id: string, input: PanelModelInput, wording: SectionWording): PhotoEvidenceModel {
  const photo = input.record.photos.find((candidate) => candidate.id === id);
  if (!photo) return { id, caption: null, tags: null, thumbUrl: null, url: null, state: "missing" };
  // A blank tag is no tag (as in the export).
  const moduleKey = blankToNull(photo.moduleKey)?.trim() ?? null;
  const target = blankToNull(photo.target);
  // "Visual Inspection · Size M · Thin Spot on Glove Body"; nothing for a photo tagged with nothing.
  const tags =
    moduleKey === null && target === null ? null : tagLine(photoTags({ module_key: moduleKey, target }, wording, input.defectNames));
  return {
    id,
    caption: blankToNull(photo.caption),
    tags,
    thumbUrl: photo.flagged ? null : (input.photoLinks.thumbs.get(id) ?? null),
    url: input.photoLinks.full.get(id) ?? null,
    state: photo.flagged ? "flagged" : "ok",
  };
}

function decisionModel(decision: StoredDecision): DecisionModel {
  return { action: decision.action, note: blankToNull(decision.note), actor: decision.actor, at: formatDateTime(decision.at) };
}

function questionModel(question: AiQuestion): QuestionModel {
  return { id: question.id, module: question.module, question: question.question };
}

function blankToNull(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
