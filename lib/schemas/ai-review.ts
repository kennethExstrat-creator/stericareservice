import { z } from "zod";
import { InspectionResultSchema } from "./common";
import type { InspectionExport } from "./export";
import { ALWAYS_ON_MODULE_KEYS } from "./module-result";

/* ------------------------------------------------------------------ *
 * AI second opinion (BUILD_SPEC 9.2)
 *
 * AiReviewSchema is also the structured-output schema Claude answers in,
 * so it sticks to objects, arrays, strings, numbers, enums and nullable
 * fields. Bounds such as `.min()` are checked here after the model answers;
 * the descriptions are what the model reads.
 * ------------------------------------------------------------------ */

export const FINDING_SEVERITIES = ["critical", "major", "minor", "info"] as const;
export const FindingSeveritySchema = z.enum(FINDING_SEVERITIES);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const AiEvidenceValueSchema = z.object({
  label: z.string().min(1).describe("What the value is, e.g. 'Average weight, size M'."),
  value: z.string().min(1).describe("The value as recorded or computed in the export, e.g. '2.9'."),
  unit: z
    .string()
    .nullable()
    .default(null)
    .describe("Unit such as 'g', 'mm', 'N', 'MPa' or '%', or null when there is none."),
});
export type AiEvidenceValue = z.infer<typeof AiEvidenceValueSchema>;

export const AiFindingSchema = z.object({
  id: z.string().min(1).describe("Stable finding id: F1, F2, F3 and so on."),
  module: z
    .string()
    .min(1)
    .describe("Key of the module (e.g. 'weight') or custom module in the export that the finding is about."),
  size: z
    .string()
    .nullable()
    .describe("Glove size the finding is about, e.g. 'M' or '7.0', or null when it is not size specific."),
  severity: FindingSeveritySchema,
  message: z.string().min(1).describe("What is wrong or notable and what the admin should check."),
  evidence: z.object({
    values: z.array(AiEvidenceValueSchema).describe("The recorded or computed values the finding rests on."),
    boxes: z.array(z.string()).describe("Carton or box numbers involved, as written in the export."),
    photos: z.array(z.string()).describe("Ids of photos in the export that show the issue."),
  }),
});
export type AiFinding = z.infer<typeof AiFindingSchema>;

export const AiQuestionSchema = z.object({
  id: z.string().min(1).describe("Stable question id: Q1, Q2, Q3 and so on."),
  module: z.string().nullable().describe("Key of the module in the export that the question is about, or null."),
  question: z.string().min(1).describe("A question only the inspector can answer."),
});
export type AiQuestion = z.infer<typeof AiQuestionSchema>;

export const AiReviewSchema = z
  .object({
    suggestedResult: InspectionResultSchema.describe(
      "The reviewer's suggested overall result. A suggestion only: it never changes the inspection.",
    ),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .describe("How sure the reviewer is of suggestedResult, from 0 to 1."),
    summary: z.string().min(1).describe("Two to four plain sentences for the QC admin."),
    findings: z.array(AiFindingSchema).describe("One per distinct issue, most severe first."),
    questions: z.array(AiQuestionSchema).describe("Open questions for the inspector."),
  })
  .superRefine((review, ctx) => {
    // Admin actions are stored against these ids, so they must be unique within a review.
    flagDuplicateIds(ctx, review.findings, "findings");
    flagDuplicateIds(ctx, review.questions, "questions");
  });
export type AiReview = z.infer<typeof AiReviewSchema>;

function flagDuplicateIds(
  ctx: z.RefinementCtx,
  items: readonly { id: string }[],
  key: "findings" | "questions",
): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      ctx.addIssue({
        code: "custom",
        path: [key, index, "id"],
        message: `Id "${item.id}" is used more than once.`,
      });
    }
    seen.add(item.id);
  });
}

/* ------------------------------------------------------------------ *
 * References into the reviewed export
 *
 * The review panel links findings and questions to modules and photos,
 * so those must exist in the export the review is about: a review that
 * cites evidence the inspection does not have is rejected, not repaired.
 * Sizes and box numbers are not checked. Naming a size that was not
 * ordered, or a size seen only in a comment or a photo, is part of the
 * reviewer's job. Box numbers are the inspector's own, never carton
 * numbers, so nothing compares them with the carton list (BUILD_SPEC 6.2
 * rule 7; Kenneth, 12 October 2026).
 * ------------------------------------------------------------------ */

export interface ReviewReferenceIssue {
  path: (string | number)[];
  message: string;
}

export function findUnknownReferences(review: AiReview, exportDoc: InspectionExport): ReviewReferenceIssue[] {
  const modules = new Set<string>([
    // Always on, and the export's conclusion section exists even if a builder leaves the module out.
    ...ALWAYS_ON_MODULE_KEYS,
    ...exportDoc.modules.map((module) => module.key),
    ...exportDoc.excludedModules.map((module) => module.key),
    ...exportDoc.custom.map((module) => module.key),
  ]);
  const photos = new Set(exportDoc.photos.map((photo) => photo.id));
  const issues: ReviewReferenceIssue[] = [];

  const checkModule = (key: string | null, path: ReviewReferenceIssue["path"]) => {
    if (key !== null && !modules.has(key)) {
      issues.push({ path, message: `${quote(key)} is not a module of this inspection` });
    }
  };

  review.findings.forEach((finding, index) => {
    checkModule(finding.module, ["findings", index, "module"]);
    finding.evidence.photos.forEach((id, photoIndex) => {
      if (!photos.has(id)) {
        issues.push({
          path: ["findings", index, "evidence", "photos", photoIndex],
          message: `${quote(id)} is not a photo of this inspection`,
        });
      }
    });
  });
  review.questions.forEach((question, index) => checkModule(question.module, ["questions", index, "module"]));
  return issues;
}

/** The value as the reviewer wrote it, cut short: it lands in an admin-facing message. */
function quote(value: string): string {
  return JSON.stringify(value.length > 60 ? `${value.slice(0, 57)}...` : value);
}

/* ------------------------------------------------------------------ *
 * Admin decision on one finding
 * ------------------------------------------------------------------ */

export const AI_REVIEW_ACTIONS = ["agree", "disagree", "fixed"] as const;
export const AiReviewActionKindSchema = z.enum(AI_REVIEW_ACTIONS);
export type AiReviewActionKind = z.infer<typeof AiReviewActionKindSchema>;

export const AiReviewActionSchema = z
  .object({
    findingId: z.string().min(1),
    action: AiReviewActionKindSchema,
    note: z
      .string()
      .trim()
      .max(2000)
      .nullish()
      .transform((note) => note || null),
  })
  .superRefine((value, ctx) => {
    if (value.action === "disagree" && value.note === null) {
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: "Add a note explaining why you disagree.",
      });
    }
  });
export type AiReviewAction = z.infer<typeof AiReviewActionSchema>;
export type AiReviewActionInput = z.input<typeof AiReviewActionSchema>;
