// Result "info" once the glove has every field the template shows; "not
// done" until then (BUILD_SPEC 6.2 rule 5). One glove per inspection
// (Kenneth, 26 October 2026); an inspection saved with several variants is
// judged on each, its messages naming them. Each variant's indicative weight
// flows forward to the weight module through the context, for the sizes it
// covers (rule 9).
import { formatDecimal } from "@/lib/stats";
import {
  errorIssue,
  isBlank,
  labelFor,
  notDone,
  warningIssue,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type ContextContribution,
  type ContributeInput,
  type Labels,
} from "@/modules/_framework";
import { VARIANT_FIELDS, type GloveInfoConfig, type VariantField } from "./config";
import type { GloveInfoData, GloveVariant } from "./schema";

/** Nothing is computed: every value is entered. */
export type GloveInfoComputed = Record<string, never>;

/** "Variant 2": how the screen and the messages name a variant. */
export function variantName(index: number): string {
  return `Variant ${index + 1}`;
}

/**
 * The weight field's label for a variant: the template's wording without a
 * "(Size M)" from the one-weight form, since a variant's weight is for its
 * own sizes.
 */
export function weightLabel(labels: Labels): string {
  return labelFor(labels, "indicativeWeight").replace(/\s*\(size [^)]*\)\s*$/i, "");
}

function fieldLabel(labels: Labels, field: VariantField): string {
  return field === "indicativeWeight" ? weightLabel(labels) : labelFor(labels, field);
}

export function calcGloveInfo({
  data,
  config,
  labels,
}: CalcInput<GloveInfoData, GloveInfoConfig>): CalcOutput<GloveInfoComputed> {
  // What the step waits for: each variant's shown fields (Glove Type is recorded when known, never waited for).
  const needed = VARIANT_FIELDS.filter((field) => config.fields[field]);
  const issues: CalcIssue[] = [];
  // The variant is named only where there are several (saved before one glove per inspection).
  const several = data.variants.length > 1;

  data.variants.forEach((variant, index) => {
    const weight = variant.indicativeWeight;
    if (config.fields.indicativeWeight && weight !== null && weight <= 0) {
      issues.push(
        errorIssue("indicative_weight_not_positive", `${several ? `${variantName(index)}, ` : ""}${weightLabel(labels)}: must be more than 0 g.`, {
          path: ["variants", index, "indicativeWeight"],
        }),
      );
    }
  });

  // A size two variants pick: its weight check takes the first one's weight.
  const claimed = new Map<string, number>();
  data.variants.forEach((variant, index) => {
    for (const size of variant.sizes) {
      const first = claimed.get(size);
      if (first === undefined) claimed.set(size, index);
      else {
        issues.push(
          warningIssue("size_in_two_variants", `Size ${size} is in ${variantName(first)} and ${variantName(index)}.`, {
            path: ["variants", index, "sizes"],
          }),
        );
      }
    }
  });

  if (needed.length === 0) {
    return { result: { status: "info", summary: "No fields are switched on." }, computed: {}, issues };
  }
  if (data.variants.length === 0) {
    return { result: notDone(`Missing: ${needed.map((field) => fieldLabel(labels, field)).join(", ")}.`), computed: {}, issues };
  }
  const missing = data.variants.flatMap((variant, index) =>
    needed
      .filter((field) => !isFilled(variant, field))
      .map((field) => (several ? `${variantName(index)} ${fieldLabel(labels, field)}` : fieldLabel(labels, field))),
  );
  if (missing.length > 0) return { result: notDone(`Missing: ${missing.join(", ")}.`), computed: {}, issues };
  const lead = config.fields.gloveType && data.gloveType?.trim() ? `${data.gloveType.trim()}. ` : "";
  return { result: { status: "info", summary: `${lead}${summarise(data, config)}` }, computed: {}, issues };
}

/**
 * The size a variant's indicative weight is compared with: its one size, or
 * the template's reference size (M on both reports) when it covers several
 * sizes, or every size, that include it; null when it covers several without it.
 */
export function weightSizeOf(variant: Pick<GloveVariant, "sizes">, referenceSize: string): string | null {
  if (variant.sizes.length === 1) return variant.sizes[0];
  return variant.sizes.length === 0 || variant.sizes.includes(referenceSize) ? referenceSize : null;
}

export function contributeGloveInfo({
  data,
  config,
}: ContributeInput<GloveInfoData, GloveInfoConfig>): ContextContribution {
  if (!config.fields.indicativeWeight) return {};
  const weights: Record<string, number> = {};
  for (const variant of data.variants) {
    const grams = variant.indicativeWeight;
    const size = weightSizeOf(variant, config.indicativeWeightSize);
    if (grams === null || grams <= 0 || size === null || size in weights) continue;
    weights[size] = grams;
  }
  // The reference size's, as before variants (the export's indicative weight).
  const reference = weights[config.indicativeWeightSize];
  return {
    indicativeWeights: weights,
    indicativeWeight: reference === undefined ? null : { grams: reference, size: config.indicativeWeightSize },
  };
}

function isFilled(variant: GloveVariant, field: VariantField): boolean {
  if (field === "indicativeWeight") return variant.indicativeWeight !== null && variant.indicativeWeight > 0;
  if (field === "length") return variant.length !== null && variant.length > 0;
  return !isBlank(variant[field]);
}

/**
 * "Finger-textured, Blue, 240 mm; indicative weight 3.5 g (size M).",
 * a sentence per variant, its sizes after its words when it has some picked.
 */
function summarise(data: GloveInfoData, config: GloveInfoConfig): string {
  return data.variants
    .map((variant) => {
      const words = (["surfaceTexture", "colour"] as const)
        .filter((field) => config.fields[field])
        .map((field) => variant[field]?.trim() ?? "")
        .filter((word) => word !== "");
      if (config.fields.length && variant.length !== null) words.push(`${formatDecimal(variant.length)} mm`);
      const sizes = variant.sizes.length > 0 ? ` (${variant.sizes.join(", ")})` : "";
      const parts = [`${words.join(", ")}${sizes}`];
      const weightSize = weightSizeOf(variant, config.indicativeWeightSize);
      if (config.fields.indicativeWeight && variant.indicativeWeight !== null) {
        parts.push(`indicative weight ${formatDecimal(variant.indicativeWeight)} g${weightSize ? ` (size ${weightSize})` : ""}`);
      }
      const text = parts.filter((part) => part.trim() !== "").join("; ");
      return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
    })
    .join(" ");
}
