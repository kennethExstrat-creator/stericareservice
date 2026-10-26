// The Change the Spec dialog's form (Kenneth, 26 October 2026), kept pure so
// it is tested without a browser: the kinds of spec the template takes, NA
// included, the figures each needs, typed as text, and the spec they make,
// read as the readings are (parseDecimal) and checked with the template's
// own SpecSchema.
import { parseDecimal, type Spec } from "@/lib/stats";
import { SpecSchema } from "@/modules/_framework";

export const SPEC_KINDS = [
  { kind: "min", label: "At Least (≥)" },
  { kind: "max", label: "At Most (≤)" },
  { kind: "tolerance", label: "Nominal ± Tolerance" },
  { kind: "range", label: "Range (From – To)" },
  { kind: "na", label: "NA (No Spec)" },
] as const satisfies readonly { kind: Spec["kind"]; label: string }[];

/** The figures typed for a kind, as text until Save reads them: one, two, or none (NA). */
export type SpecFigures = { first: string; second: string };

/** A spec's figures as the dialog's fields show them. */
export function figuresOf(spec: Spec | null): SpecFigures {
  switch (spec?.kind) {
    case "min":
      return { first: String(spec.min), second: "" };
    case "max":
      return { first: String(spec.max), second: "" };
    case "tolerance":
      return { first: String(spec.nominal), second: String(spec.tolerance) };
    case "range":
      return { first: String(spec.min), second: String(spec.max) };
    default:
      return { first: "", second: "" };
  }
}

/** The names of a kind's fields, in Title Case: "At Least"; "Nominal", "Tolerance"; none for NA. */
export function fieldsOf(kind: Spec["kind"]): readonly string[] {
  if (kind === "min") return ["At Least"];
  if (kind === "max") return ["At Most"];
  if (kind === "tolerance") return ["Nominal", "Tolerance"];
  if (kind === "range") return ["From", "To"];
  return [];
}

/** The spec the figures make, or what is wrong with them, in a sentence. */
export function specFromFigures(kind: Spec["kind"], figures: SpecFigures): { spec: Spec } | { error: string } {
  const values: number[] = [];
  for (const [index, name] of fieldsOf(kind).entries()) {
    const parsed = parseDecimal(index === 0 ? figures.first : figures.second);
    if (!parsed.ok) return { error: `${name}: ${parsed.error}` };
    if (parsed.value === null) return { error: `Enter a figure for ${name}, in mm.` };
    values.push(parsed.value);
  }
  if (kind === "tolerance" && values[1] < 0) return { error: "The tolerance cannot be below 0." };
  if (kind === "range" && values[0] > values[1]) return { error: "From must not be more than To." };
  const candidate =
    kind === "min"
      ? { kind, min: values[0] }
      : kind === "max"
        ? { kind, max: values[0] }
        : kind === "tolerance"
          ? { kind, nominal: values[0], tolerance: values[1] }
          : kind === "range"
            ? { kind, min: values[0], max: values[1] }
            : { kind };
  const parsed = SpecSchema.safeParse(candidate);
  return parsed.success ? { spec: parsed.data } : { error: "That spec cannot be used. Check the figures." };
}
