// Result "info" once every field the template shows is filled in; "not
// done" until then (BUILD_SPEC 6.2 rule 5). The indicative weight flows
// forward to the weight module through the context (rule 9).
import { formatDecimal } from "@/lib/stats";
import {
  errorIssue,
  isBlank,
  labelFor,
  notDone,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type ContextContribution,
  type ContributeInput,
} from "@/modules/_framework";
import { GLOVE_INFO_FIELDS, type GloveInfoConfig, type GloveInfoField } from "./config";
import type { GloveInfoData } from "./schema";

/** Nothing is computed: every value is entered. */
export type GloveInfoComputed = Record<string, never>;

export function calcGloveInfo({
  data,
  config,
  labels,
}: CalcInput<GloveInfoData, GloveInfoConfig>): CalcOutput<GloveInfoComputed> {
  const shown = GLOVE_INFO_FIELDS.filter((field) => config.fields[field]);
  const issues: CalcIssue[] = [];

  const weight = data.indicativeWeight;
  if (config.fields.indicativeWeight && weight !== null && weight <= 0) {
    issues.push(
      errorIssue("indicative_weight_not_positive", `${labelFor(labels, "indicativeWeight")}: must be more than 0 g.`, {
        path: ["indicativeWeight"],
      }),
    );
  }

  if (shown.length === 0) {
    return { result: { status: "info", summary: "No fields are switched on." }, computed: {}, issues };
  }
  const missing = shown.filter((field) => !isFilled(data, field));
  if (missing.length > 0) {
    return {
      result: notDone(`Missing: ${missing.map((field) => labelFor(labels, field)).join(", ")}.`),
      computed: {},
      issues,
    };
  }
  return { result: { status: "info", summary: summarise(data, config) }, computed: {}, issues };
}

export function contributeGloveInfo({
  data,
  config,
}: ContributeInput<GloveInfoData, GloveInfoConfig>): ContextContribution {
  const grams = data.indicativeWeight;
  if (!config.fields.indicativeWeight || grams === null || grams <= 0) return {};
  return { indicativeWeight: { grams, size: config.indicativeWeightSize } };
}

function isFilled(data: GloveInfoData, field: GloveInfoField): boolean {
  if (field === "indicativeWeight") return data.indicativeWeight !== null && data.indicativeWeight > 0;
  return !isBlank(data[field]);
}

/** "Finger-textured, Blue, 240 mm minimum; indicative weight 3.5 g (size M)." */
function summarise(data: GloveInfoData, config: GloveInfoConfig): string {
  const words = (["surfaceTexture", "colour", "length"] as const)
    .filter((field) => config.fields[field])
    .map((field) => data[field]?.trim());
  const parts = [words.join(", ")];
  if (config.fields.indicativeWeight && data.indicativeWeight !== null) {
    parts.push(`indicative weight ${formatDecimal(data.indicativeWeight)} g (size ${config.indicativeWeightSize})`);
  }
  const text = parts.filter((part) => part !== "").join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
