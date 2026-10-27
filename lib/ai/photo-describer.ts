import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { ClaudeModelIdSchema, DEFAULT_DOCUMENT_MODEL } from "@/lib/schemas/ai-settings";
import { PHOTO_DESCRIPTION_TEXT_MAX, PhotoDescriptionSchema, type PhotoDescription } from "@/lib/schemas/photo-description";
import type { PhotoMarker } from "@/lib/schemas/photo-markers";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import { includedModules } from "@/lib/templates/overrides";
import { OTHER_LOCATION } from "@/modules/watertight/config";
import type { AiEnv } from "./config";
import { createMessage, fail, type ReadFailure } from "./document-reader";
import type { ClaudeImage } from "./photo-image";
import { PHOTO_DESCRIPTION_SYSTEM_PROMPT } from "./prompts/photo-description-system";
import { toStructuredOutputSchema } from "./providers/claude-format";
import { SERVER_SIDE_FALLBACK_BETA } from "./providers/claude-request";
import { hasServerSideFallbacks } from "./summary-writer";
import type { OnAiCall } from "./usage";

/*
 * Describing the report's photos (docs/AI.md, "Describing photos"; Kenneth,
 * 27 October 2026: "Please loop in AI to identify properly rather than
 * squeezing in all photos without analyzing"). Claude sees a few photos at a
 * time, each after a label with the inspector's tags and caption, and where
 * the inspector circled a defect on it (the red circles of Media's preview,
 * kept apart from the image), and answers for each: a caption in the report's style ("Pinhole, palm area",
 * "Test rig"), whether it shows a defect or the setting, the test it belongs
 * to (the watertight test or the visual inspection, context shots included),
 * the defect by the inspection's own template's code, and how clearly it
 * shows. The codes are a closed list, the watertight check's hole locations
 * and each visual class's defects: the structured output allows no other,
 * and the answer is checked again here, so an unsure answer is null, never
 * an invented code. A leak is always a hole: the code of its place, else the
 * template's catch-all hole code (Other). Captions only: nothing here
 * touches a result.
 *
 * One request per batch, with the model chosen for reading documents (Admin
 * > Steri-AI Settings), at low effort. The system prompt and the template's
 * defect list are cached, so the batches of one inspection read them from
 * the cache.
 */

/** Holes and defects as the template words them: a code and its label. */
export type VocabularyEntry = { code: string; label: string };

export type PhotoVocabulary = {
  /** The watertight check's hole locations: a hole's code names where it is, so it is its location too. */
  holes: VocabularyEntry[];
  /** The visual classes' defects, each code once, with the classes that list it ("Major"). */
  visual: (VocabularyEntry & { classes: string[] })[];
};

/** One photo to describe: the copy Claude sees, and what the inspector filed it as. */
export type PhotoToDescribe = {
  image: ClaudeImage;
  /** The inspector's tags in words ("Watertight Test · Size M · Pin Hole: Palm"); null for none. */
  tags: string | null;
  /** The inspector's own caption, as data. */
  caption: string | null;
  /**
   * The red circles the inspector drew on the photo's preview to mark a
   * defect (lib/schemas/photo-markers.ts). They are kept apart from the
   * image, so Claude never sees them drawn: the label says where they are,
   * in rough percentages of the photo (circledText).
   */
  markers?: readonly PhotoMarker[];
};

/** A photo's answer: its description, or null when Steri-AI could not tell what it shows. Null when it gave none. */
export type PhotoAnswer = { description: PhotoDescription | null } | null;

export type DescribeOutcome = { ok: true; answers: PhotoAnswer[]; model: string } | ReadFailure;

const TIMEOUT_MS = 120_000;
/** A short answer per photo; the rest is room for the model's own thinking. */
const MAX_TOKENS = 8_000;

const CODE = /^[a-z][a-z0-9_]*$/;
const CLASS_WORDS = [
  ["critical", "Critical"],
  ["major", "Major"],
  ["minor", "Minor"],
] as const;

/**
 * The defect and hole location codes a description may use: the inspection's
 * own template (the caller applies its per-inspection overrides), only the
 * watertight check and the visual classes it includes.
 */
export function photoVocabulary(template: ResolvedTemplate): PhotoVocabulary {
  const modules = includedModules(template);
  const config = (key: string) => modules.find((entry) => entry.key === key)?.config ?? null;
  const holes = entriesOf(config("watertight")?.locations);
  const visual: PhotoVocabulary["visual"] = [];
  const classes = record(config("visual")?.classes);
  for (const [key, word] of CLASS_WORDS) {
    const listed = record(classes[key]);
    if (listed.include === false) continue;
    for (const entry of entriesOf(listed.defects)) {
      if (holes.some((hole) => hole.code === entry.code)) continue;
      const known = visual.find((item) => item.code === entry.code);
      if (known) {
        if (!known.classes.includes(word)) known.classes.push(word);
      } else {
        visual.push({ ...entry, classes: [word] });
      }
    }
  }
  return { holes, visual };
}

/**
 * The template's catch-all hole code (the watertight check's Other: the
 * reports' "Other :" row), for a leak whose place cannot be told; null when
 * the template lists none.
 */
export function catchAllHole(vocabulary: Pick<PhotoVocabulary, "holes">): string | null {
  return vocabulary.holes.find((hole) => hole.code === OTHER_LOCATION)?.code ?? null;
}

/** The template's list as Claude reads it, after the system prompt. */
export function photoVocabularyText(vocabulary: PhotoVocabulary): string {
  const { holes, visual } = vocabulary;
  const catchAll = catchAllHole(vocabulary);
  const lines = ["<defect_list>"];
  lines.push(
    holes.length > 0
      ? "Holes (pinholes and leaks), by where the hole is, whether the photo shows the watertight test or a glove held up:"
      : "Holes: none in this inspection.",
  );
  for (const hole of holes) {
    lines.push(`- ${hole.code}: ${hole.label}${hole.code === catchAll ? " (the catch-all: any other place, or a hole whose place cannot be told)" : ""}`);
  }
  lines.push(visual.length > 0 ? "Visual defects:" : "Visual defects: none in this inspection.");
  for (const defect of visual) lines.push(`- ${defect.code}: ${defect.label} (${defect.classes.join(", ")})`);
  lines.push("</defect_list>");
  return lines.join("\n");
}

/** Every code a description may name. */
function codesOf(vocabulary: PhotoVocabulary): string[] {
  return [...vocabulary.holes, ...vocabulary.visual].map((entry) => entry.code);
}

/** The answer's JSON schema: the codes as an enum, so the structured output allows no other. */
export function describeJsonSchema(vocabulary: PhotoVocabulary): Record<string, unknown> {
  const codes = codesOf(vocabulary);
  const answer = z.object({
    photos: z.array(
      z.object({
        photo: z.number().int().min(1).describe("The photo's number, as labelled"),
        text: z.string().max(PHOTO_DESCRIPTION_TEXT_MAX).nullable().describe("The caption; null only when the photo shows nothing you can tell"),
        kind: PhotoDescriptionSchema.shape.kind,
        check: PhotoDescriptionSchema.shape.check.unwrap().describe("The test the photo belongs to, or null"),
        defect: (codes.length > 0 ? z.enum(codes as [string, ...string[]]).nullable() : z.null()).describe(
          "The defect's code from the defect list, or null",
        ),
        clarity: z.number().min(0).max(1).describe("How clearly the photo shows what the text says, 0 to 1"),
      }),
    ),
  });
  return toStructuredOutputSchema(z.toJSONSchema(answer, { target: "draft-2020-12" }));
}

/** The request for one batch: the system prompt and the template's list (cached), then each photo after its label. */
export function buildDescribeRequest(
  photos: readonly PhotoToDescribe[],
  vocabulary: PhotoVocabulary,
  model: string,
): MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: MAX_TOKENS,
    ...(hasServerSideFallbacks(model) ? { betas: [SERVER_SIDE_FALLBACK_BETA], fallbacks: "default" as const } : {}),
    system: [
      { type: "text", text: PHOTO_DESCRIPTION_SYSTEM_PROMPT },
      { type: "text", text: photoVocabularyText(vocabulary), cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: describeContent(photos) }],
    // Low effort: a caption and a code per photo, and the Report page is waiting.
    output_config: { effort: "low", format: { type: "json_schema", schema: describeJsonSchema(vocabulary) } },
  };
}

/**
 * "Photo 2. Tags: Watertight Test · Size M. Inspector's caption: "leak at thumb"." and, for
 * a photo the inspector circled, where (circledText).
 */
export function photoLabel(number: number, { tags, caption, markers }: Pick<PhotoToDescribe, "tags" | "caption" | "markers">): string {
  const parts = [`Photo ${number}.`];
  if (tags?.trim()) parts.push(`Tags: ${tags.trim()}.`);
  if (caption?.trim()) parts.push(`Inspector's caption: ${JSON.stringify(caption.trim())}.`);
  const circled = circledText(markers ?? []);
  if (circled) parts.push(circled);
  return parts.join(" ");
}

/**
 * Where the inspector circled defects on the photo (Kenneth, 27 October
 * 2026), in rough percentages from its top left corner, the radius of the
 * photo's shorter side, as the marks keep them: "The inspector circled a
 * defect (the circle is not drawn on the photo): centred about 42% from the
 * left and 58% from the top, its radius about 12% of the photo's shorter
 * side." Null for a photo with none.
 */
export function circledText(markers: readonly PhotoMarker[]): string | null {
  if (markers.length === 0) return null;
  const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;
  const place = (marker: PhotoMarker) =>
    `centred about ${percent(marker.x)} from the left and ${percent(marker.y)} from the top, its radius about ${percent(marker.r)} of the photo's shorter side`;
  if (markers.length === 1) return `The inspector circled a defect (the circle is not drawn on the photo): ${place(markers[0])}.`;
  return `The inspector circled ${markers.length} defects (the circles are not drawn on the photo): ${markers.map((marker) => `one ${place(marker)}`).join("; ")}.`;
}

function describeContent(photos: readonly PhotoToDescribe[]): BetaContentBlockParam[] {
  const blocks: BetaContentBlockParam[] = photos.flatMap((photo, index): BetaContentBlockParam[] => [
    { type: "text", text: photoLabel(index + 1, photo) },
    { type: "image", source: { type: "base64", media_type: photo.image.mediaType, data: photo.image.base64 } },
  ]);
  blocks.push({ type: "text", text: `Describe the ${photos.length === 1 ? "photo" : `${photos.length} photos`} above.` });
  return blocks;
}

const AnswerSchema = z.object({ photos: z.array(z.unknown()) });
const AnswerEntrySchema = z.object({
  photo: z.number().int().min(1),
  text: z.string().nullable(),
  kind: PhotoDescriptionSchema.shape.kind,
  // An answer written before the test was asked for has none.
  check: PhotoDescriptionSchema.shape.check.unwrap().optional(),
  defect: z.string().nullable(),
  clarity: z.number(),
});

/**
 * Claude's answer as one entry per photo, in order. A code the template's
 * list does not have is null; a hole's code is its location too; a photo
 * with a defect code is a defect photo; a defect in the watertight test with
 * no code is a leak whose place could not be told, the template's catch-all
 * hole code (Other) where it has one. Null for a photo it left out or
 * answered twice in two ways; null altogether when the answer is not the
 * JSON object.
 */
export function parseDescribeAnswer(text: string, count: number, vocabulary: PhotoVocabulary): PhotoAnswer[] | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let json: unknown;
  try {
    json = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const answer = AnswerSchema.safeParse(json);
  if (!answer.success) return null;

  const holes = new Set(vocabulary.holes.map((entry) => entry.code));
  const known = new Set(codesOf(vocabulary));
  const catchAll = catchAllHole(vocabulary);
  const answered = new Map<number, PhotoAnswer>();
  const conflicting = new Set<number>();
  for (const raw of answer.data.photos) {
    const entry = AnswerEntrySchema.safeParse(raw);
    if (!entry.success || entry.data.photo > count) continue;
    const { photo } = entry.data;
    const next = answerOf(entry.data, holes, known, catchAll);
    const before = answered.get(photo);
    if (before !== undefined && JSON.stringify(before) !== JSON.stringify(next)) conflicting.add(photo);
    answered.set(photo, next);
  }
  return Array.from({ length: count }, (_, index) => (conflicting.has(index + 1) ? null : (answered.get(index + 1) ?? null)));
}

function answerOf(
  entry: z.infer<typeof AnswerEntrySchema>,
  holes: ReadonlySet<string>,
  known: ReadonlySet<string>,
  catchAll: string | null,
): NonNullable<PhotoAnswer> {
  const text = captionText(entry.text);
  if (text === null) return { description: null };
  const check = entry.check ?? null;
  const listed = entry.defect !== null && known.has(entry.defect) ? entry.defect : null;
  // The watertight test finds holes: a leak whose place could not be told is the catch-all's.
  const defect = listed ?? (entry.kind === "defect" && check === "watertight" ? catchAll : null);
  return {
    description: {
      text,
      kind: defect ? "defect" : entry.kind,
      defect,
      location: defect && holes.has(defect) ? defect : null,
      clarity: Math.round(Math.min(1, Math.max(0, Number.isFinite(entry.clarity) ? entry.clarity : 0)) * 100) / 100,
      check,
    },
  };
}

/**
 * A caption as the report prints it: one line, no quotes or full stop,
 * its first letter a capital, at most 80 characters (cut at a word). Null
 * when nothing is left.
 */
export function captionText(value: string | null): string | null {
  if (value === null) return null;
  let text = value
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/gu, "")
    .replace(/[.。]+$/u, "")
    .trim();
  if (text.length > PHOTO_DESCRIPTION_TEXT_MAX) {
    const cut = text.slice(0, PHOTO_DESCRIPTION_TEXT_MAX + 1);
    const space = cut.lastIndexOf(" ");
    text = (space >= 20 ? cut.slice(0, space) : text.slice(0, PHOTO_DESCRIPTION_TEXT_MAX)).replace(/[\s,;:–—-]+$/u, "");
  }
  if (!text) return null;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Describes a batch of photos. Never throws: a failure comes back in words
 * for the screen. `onCall` hears of the Claude call, billed or failed, for
 * its cost (lib/ai/usage.ts): one per batch.
 */
export async function describePhotoBatch(
  photos: readonly PhotoToDescribe[],
  vocabulary: PhotoVocabulary,
  env: AiEnv,
  onCall?: OnAiCall,
): Promise<DescribeOutcome> {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return fail("not_connected", "Steri-AI is not connected yet. Ask an admin to add the Anthropic API key under Admin > Steri-AI Settings.");
  }
  const model = ClaudeModelIdSchema.safeParse(env.AI_DOCUMENT_MODEL?.trim() || DEFAULT_DOCUMENT_MODEL);
  if (!model.success) {
    return fail("misconfigured", "The model for reading documents is not a Claude model. Ask an admin to check Admin > Steri-AI Settings.");
  }
  if (photos.length === 0) return { ok: true, answers: [], model: model.data };

  try {
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: TIMEOUT_MS });
    const message = await createMessage(client, buildDescribeRequest(photos, vocabulary, model.data), onCall);
    if (message.stop_reason === "refusal") return fail("error", "Steri-AI declined to describe these photos.");
    if (message.stop_reason === "max_tokens") return fail("error", "Steri-AI's answer was cut off. Try again.");
    const text = message.content.filter((block) => block.type === "text").at(-1)?.text ?? "";
    const answers = parseDescribeAnswer(text, photos.length, vocabulary);
    if (!answers) return fail("error", "Steri-AI's answer could not be read. Try again.");
    return { ok: true, answers, model: message.model };
  } catch (error) {
    return describeError(error);
  }
}

/** A failed request in words the inspector can act on (as describeReadError, for photos). */
function describeError(error: unknown): ReadFailure {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return fail("error", "Steri-AI took too long to describe the photos. Try again.");
  if (error instanceof Anthropic.APIConnectionError) return fail("error", "Could not reach Steri-AI. Check the connection and try again.");
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return fail("misconfigured", "Steri-AI did not accept the API key. Ask an admin to check Admin > Steri-AI Settings.");
  }
  if (error instanceof Anthropic.NotFoundError) {
    return fail("misconfigured", "The model for reading documents is not available to this key. Ask an admin to check Admin > Steri-AI Settings.");
  }
  if (error instanceof Anthropic.RateLimitError) return fail("error", "Steri-AI is busy. Wait a minute and try again.");
  if (error instanceof Anthropic.BadRequestError) {
    console.error("[photo describer] request refused", error.message);
    return fail("error", "Steri-AI could not open these photos. Try again.");
  }
  console.error("[photo describer] failed", error);
  return fail("error", "Steri-AI could not describe the photos. Try again.");
}

/** A list of { code, label } entries from a template's config, a label's closing colon left out ("Other :"). */
function entriesOf(value: unknown): VocabularyEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: VocabularyEntry[] = [];
  for (const item of value) {
    const { code, label } = record(item);
    if (typeof code !== "string" || !CODE.test(code) || typeof label !== "string") continue;
    const words = label.replace(/\s*:\s*$/u, "").trim();
    if (words && !entries.some((entry) => entry.code === code)) entries.push({ code, label: words });
  }
  return entries;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
