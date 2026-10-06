import "server-only";
import type {
  BetaContentBlockParam,
  BetaJSONOutputFormat,
  BetaMessageStreamParams,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ExportPhoto, InspectionExport } from "@/lib/schemas";
import type { AiReviewEffort } from "../config";
import { REVIEW_SYSTEM_PROMPT } from "../prompts/review-system";
import { aiReviewOutputFormat } from "./claude-format";

/**
 * Room for adaptive thinking plus the JSON answer. xhigh and max think
 * longer, and Anthropic advises at least 64K tokens there. The request is
 * streamed, which any budget above about 16K tokens needs.
 */
export const CLAUDE_MAX_TOKENS: Readonly<Record<AiReviewEffort, number>> = {
  low: 16_000,
  medium: 16_000,
  high: 16_000,
  xhigh: 64_000,
  max: 64_000,
};

/** Header for `fallbacks: "default"`. The array form needs server-side-fallback-2026-06-01; never mix them. */
export const SERVER_SIDE_FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Sent with client.beta.messages.stream(), which sets `stream: true` itself.
 * Structured outputs (`output_config.format`) are generally available, so
 * they need no beta header.
 */
export type ClaudeReviewParams = BetaMessageStreamParams & {
  output_config: { effort: AiReviewEffort; format: BetaJSONOutputFormat };
};

export interface ReviewRequestSettings {
  model: string;
  effort: AiReviewEffort;
}

/**
 * One user turn: the export, then the selected photos, then the ask.
 * Thinking is always on for this model, so no `thinking`, sampling
 * parameters or prefill; depth is set by `effort`.
 */
export function buildReviewRequest(
  doc: InspectionExport,
  settings: ReviewRequestSettings,
  photos: readonly ExportPhoto[],
): ClaudeReviewParams {
  return {
    model: settings.model,
    max_tokens: CLAUDE_MAX_TOKENS[settings.effort],
    betas: [SERVER_SIDE_FALLBACK_BETA],
    fallbacks: "default",
    system: [{ type: "text", text: REVIEW_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent(doc, photos) }],
    output_config: { effort: settings.effort, format: aiReviewOutputFormat() },
  };
}

/**
 * Photos to attach, include-in-report ones first, in export order. Flagged
 * photos are unconverted originals (often HEIC), which the API cannot read.
 */
export function selectReviewPhotos(photos: readonly ExportPhoto[], max: number): ExportPhoto[] {
  const usable = photos.filter((photo) => !photo.flagged);
  const ranked = [...usable.filter((photo) => photo.includeInReport), ...usable.filter((photo) => !photo.includeInReport)];
  return ranked.slice(0, Math.max(0, max));
}

/**
 * The export as Claude sees it. Signed URLs are left out (they are bearer
 * links to private storage, and the attached images carry their own), as is
 * the inspector's email.
 */
export function toModelView(doc: InspectionExport) {
  const { template, conclusion } = doc;
  return {
    schemaVersion: doc.schemaVersion,
    refNo: doc.refNo,
    status: doc.status,
    timestamps: doc.timestamps,
    inspector: doc.inspector.name,
    template: {
      code: template.code,
      version: template.version,
      standard: template.standard,
      productType: template.productType,
      client: template.client?.name ?? null,
      manufacturer: template.manufacturer?.name ?? null,
      reportTitle: template.reportTitle,
    },
    modules: doc.modules,
    excludedModules: doc.excludedModules,
    custom: doc.custom,
    photos: doc.photos.map(({ id, moduleKey, target, caption, takenAt, includeInReport, flagged }) => ({
      id,
      moduleKey,
      target,
      caption,
      takenAt,
      includeInReport,
      flagged,
    })),
    files: doc.files.map(({ id, moduleKey, kind, name }) => ({ id, moduleKey, kind, name })),
    conclusion: { ...conclusion, inspector: conclusion.inspector?.name ?? null },
  };
}

function userContent(doc: InspectionExport, photos: readonly ExportPhoto[]): BetaContentBlockParam[] {
  // "<" escaped as < (still valid JSON), so text typed by an inspector cannot close the tag.
  const json = JSON.stringify(toModelView(doc)).replaceAll("<", "\\u003c");
  const blocks: BetaContentBlockParam[] = [{ type: "text", text: `<inspection_export>\n${json}\n</inspection_export>` }];
  for (const photo of photos) {
    blocks.push({ type: "text", text: describePhoto(photo) });
    blocks.push({ type: "image", source: { type: "url", url: photo.url } });
  }
  blocks.push({ type: "text", text: ask(doc, photos.length) });
  return blocks;
}

/** Id and tags, quoted. The caption is free text, so it stays inside the export block. */
function describePhoto(photo: ExportPhoto): string {
  const tags = [
    photo.moduleKey ? `module ${JSON.stringify(photo.moduleKey)}` : "no module",
    ...(photo.target ? [`target ${JSON.stringify(photo.target)}`] : []),
  ];
  return `Photo ${photo.id} (${tags.join(", ")}):`;
}

function ask(doc: InspectionExport, attached: number): string {
  const photos =
    attached === 0
      ? "No photos are attached: judge photos only from their metadata, and say so where it matters."
      : `${attached} of ${doc.photos.length} photos are attached above, each after a line with its id. Judge the others only from their metadata.`;
  return `Give your second opinion on inspection ${doc.refNo}. ${photos}`;
}
