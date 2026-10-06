import { z } from "zod";
import { InspectionResultSchema } from "./common";

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
    .describe("Key of the module (e.g. 'weight') or custom module the finding is about."),
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
  module: z.string().nullable().describe("Key of the module the question is about, or null."),
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
