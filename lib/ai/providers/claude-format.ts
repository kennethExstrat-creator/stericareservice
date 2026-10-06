import type { BetaJSONOutputFormat } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { AiReviewSchema, type AiReview } from "@/lib/schemas";
import { summarizeIssues } from "../issues";

/* ------------------------------------------------------------------ *
 * Structured-output format for AiReviewSchema
 *
 * Not the SDK's zodOutputFormat, for two reasons (SDK 0.131):
 * - its schema transform turns `enum` and `const` into description text,
 *   so the API would not hold Claude to pass | fail | hold;
 * - its parse throws on text that does not validate, so a max_tokens cut
 *   fails the whole stream and hides stop_reason.
 * The format here carries the schema only. The provider reads stop_reason
 * first, then parses the answer text with parseAiReviewText. The schema is
 * still generated from zod: one source of truth.
 * ------------------------------------------------------------------ */

type JsonSchema = Record<string, unknown>;

/** String formats the structured-output subset accepts. */
const SUPPORTED_FORMATS = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "uri",
  "ipv4",
  "ipv6",
  "uuid",
]);

/** Keywords passed through unchanged. Everything else the API would reject becomes a hint. */
const KEPT_KEYWORDS = new Set(["type", "required", "enum", "const", "description", "title", "$ref"]);

/**
 * Restricts a JSON schema to the structured-output subset: every object
 * closed with `additionalProperties: false`, and unsupported constraints
 * (minimum, minLength, default ...) moved into the description, where the
 * model still reads them. zod re-checks them on the answer.
 */
export function toStructuredOutputSchema(schema: JsonSchema): JsonSchema {
  const result: JsonSchema = {};
  const hints: string[] = [];

  for (const [key, value] of Object.entries(schema)) {
    if ((key === "properties" || key === "$defs") && isSchema(value)) {
      result[key] = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, isSchema(child) ? toStructuredOutputSchema(child) : child]),
      );
    } else if (key === "items" && isSchema(value)) {
      result.items = toStructuredOutputSchema(value);
    } else if ((key === "anyOf" || key === "oneOf" || key === "allOf") && Array.isArray(value)) {
      result[key === "oneOf" ? "anyOf" : key] = value.map((child) =>
        isSchema(child) ? toStructuredOutputSchema(child) : child,
      );
    } else if (key === "format" && typeof value === "string" && SUPPORTED_FORMATS.has(value)) {
      result.format = value;
    } else if (key === "minItems" && (value === 0 || value === 1)) {
      result.minItems = value;
    } else if (KEPT_KEYWORDS.has(key)) {
      result[key] = value;
    } else if (key !== "additionalProperties" && key !== "$schema") {
      hints.push(`${key}: ${JSON.stringify(value)}`);
    }
  }

  if (result.type === "object") result.additionalProperties = false;
  if (hints.length > 0) {
    const description = typeof result.description === "string" ? `${result.description}\n\n` : "";
    result.description = `${description}{${hints.join(", ")}}`;
  }
  return result;
}

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

let reviewSchema: JsonSchema | undefined;

/** The JSON schema Claude answers in, generated once from AiReviewSchema. */
export function aiReviewJsonSchema(): JsonSchema {
  reviewSchema ??= toStructuredOutputSchema(z.toJSONSchema(AiReviewSchema, { target: "draft-2020-12" }));
  return reviewSchema;
}

export type ParsedReviewText = { review: AiReview; problem: null } | { review: null; problem: string };

export function parseAiReviewText(text: string): ParsedReviewText {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { review: null, problem: "the answer is not complete JSON" };
  }
  const parsed = AiReviewSchema.safeParse(json);
  return parsed.success ? { review: parsed.data, problem: null } : { review: null, problem: summarizeIssues(parsed.error) };
}

export function aiReviewOutputFormat(): BetaJSONOutputFormat {
  return { type: "json_schema", schema: aiReviewJsonSchema() };
}
