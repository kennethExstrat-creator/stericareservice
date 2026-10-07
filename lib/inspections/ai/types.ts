// Shapes shared by the AI actions (lib/inspections/ai/actions.ts), the panel
// loader and the review panel (components/ai). Types only, so client
// components can import them.
import type { AiReviewActionKind, FindingSeverity } from "@/lib/schemas/ai-review";
import type { InspectionResult, InspectionStatus } from "@/lib/schemas/common";
import type { ModuleStatus } from "@/lib/schemas/module-result";

/* ------------------------------------------------------------------ *
 * Server Action results (useActionState)
 * ------------------------------------------------------------------ */

export type AiActionField = "action" | "note";

export type AiActionState =
  | { status: "idle" }
  | { status: "success"; message: string; reportUrl?: string }
  | { status: "error"; message: string; fieldErrors?: Partial<Record<AiActionField, string>> }
  /** "Send to AI report" with no report service: the JSON download is the way out. */
  | { status: "not_connected"; message: string; downloadHref: string };

export const AI_ACTION_IDLE: AiActionState = { status: "idle" };

/** What the panel's poller learns while a second opinion is being written. */
export type AiReviewProgress = { ok: true; pending: string[] } | { ok: false };

/* ------------------------------------------------------------------ *
 * The review panel's view of one inspection (BUILD_SPEC 9.2)
 * ------------------------------------------------------------------ */

/** A stored review as the panel shows it; "stopped" is a pending one that never got an answer. */
export type ReviewState = "pending" | "done" | "failed" | "stopped";

export type DecisionModel = {
  action: AiReviewActionKind;
  note: string | null;
  actor: string;
  /** "6 Oct 2026, 14:02" (Malaysia time). */
  at: string;
};

export type PhotoEvidenceModel = {
  id: string;
  caption: string | null;
  /** "Visual Inspection · Size M · Thin spot on glove body", from the photo's tags in the template's wording. */
  tags: string | null;
  /** Signed for an hour; null when it could not be signed or the photo has no thumbnail. */
  thumbUrl: string | null;
  url: string | null;
  /** Gone from the inspection since the review, or an original the browser cannot show (HEIC). */
  state: "ok" | "missing" | "flagged";
};

export type FindingModel = {
  id: string;
  module: string;
  severity: FindingSeverity;
  size: string | null;
  message: string;
  evidence: {
    values: { label: string; value: string; unit: string | null }[];
    boxes: string[];
    photos: PhotoEvidenceModel[];
  };
  /** The latest decision; earlier ones are kept in `history`. Admins only (RLS). */
  decision: DecisionModel | null;
  history: DecisionModel[];
};

export type QuestionModel = { id: string; module: string | null; question: string };

export type ReviewModel = {
  id: string;
  state: ReviewState;
  /** "Mock reviewer (test data only)", "Review service (webhook)" or the Claude model id. */
  source: string | null;
  requestedAt: string;
  /** When the reviewed version of the inspection was saved. */
  version: string;
  /** It reviewed the inspection as it is now (see comparedBy). */
  isCurrentVersion: boolean;
  /**
   * How it is compared with the inspection now: by its content (data,
   * modules switched off, final result and remark, template version and
   * files), whatever was saved since; or, for a review stored without a
   * fingerprint, by the save (any save since makes it an earlier version).
   */
  comparedBy: "content" | "save";
  suggestedResult: InspectionResult | null;
  /** 0 to 100. */
  confidencePct: number | null;
  summary: string | null;
  /** Why it failed or stopped. */
  problem: string | null;
  /** False when the stored findings could not be read. */
  readable: boolean;
  findings: FindingModel[];
  questions: QuestionModel[];
};

export type SectionModel = {
  key: string;
  title: string;
  kind: "module" | "custom" | "excluded" | "other";
  system: {
    status: ModuleStatus | null;
    summary: string | null;
    perSize: { size: string; label: string; status: ModuleStatus; summary: string | null }[];
    warnings: string[];
    errors: string[];
    /** Switched off for this inspection, with the admin's reason. */
    excludedReason: string | null;
  };
  inspector: { comment: string | null };
  ai: { findings: FindingModel[]; questions: QuestionModel[] };
};

export type HandoffModel = {
  connected: boolean;
  /** "AI second opinion connected (webhook)", "AI not connected" ... */
  label: string;
  /** Which variable to fix; admins only. */
  detail: string | null;
  mock: boolean;
};

export type AiPanelModel = {
  inspection: {
    id: string;
    refNo: string;
    status: InspectionStatus;
    /** Exactly as stored: identifies the version a review belongs to. */
    updatedAt: string;
    savedAt: string;
    reportUrl: string | null;
    exportHref: string;
  };
  /** The signed-in user: decisions are for admins, and a half-made one is kept under the user's id on this device. */
  viewer: { id: string; isAdmin: boolean };
  review: HandoffModel & {
    canRequest: boolean;
    /** Why an admin cannot request one now, e.g. "Only submitted or approved inspections are reviewed." */
    blockedReason: string | null;
    /** Not connected because AI_REVIEW_PROVIDER is off on purpose, not because nothing is set up. */
    switchedOff: boolean;
  };
  report: HandoffModel & { canSend: boolean; blockedReason: string | null };
  /** The newest finished review: the AI column. */
  current: ReviewModel | null;
  /** A newer request than `current` that is still running, failed or stopped. */
  attempt: ReviewModel | null;
  /** Every other review, newest first. */
  history: ReviewModel[];
  overall: {
    /** The suggestion, and why in one line ("Failed: …. Warnings: …."): empty for a clean pass. */
    system: { result: InspectionResult; summary: string };
    inspector: { name: string; finalResult: InspectionResult | null; remark: string | null; comment: string | null };
    ai: { findings: FindingModel[]; questions: QuestionModel[] };
  };
  /** Sections with something to compare, in template order. */
  sections: SectionModel[];
  /** Sections that passed or are informational, with no comment, finding or question. */
  quiet: { key: string; title: string; status: ModuleStatus | null }[];
  /** Reviews still being written: the panel refreshes when they finish. */
  pendingIds: string[];
};
