// Specification limits as the reports print them: a minimum (≥ 240), a
// maximum (≤ 80), a range, a nominal with tolerance (95 ± 10) or NA.
// Limits are inclusive.
import { formatDecimal } from "./number";

export type Spec =
  | { kind: "min"; min: number }
  | { kind: "max"; max: number }
  | { kind: "range"; min: number; max: number }
  | { kind: "tolerance"; nominal: number; tolerance: number }
  | { kind: "na" };

export type SpecOutcome = "pass" | "fail" | "na";

export function checkSpec(value: number, spec: Spec): SpecOutcome {
  switch (spec.kind) {
    case "min":
      return value >= spec.min ? "pass" : "fail";
    case "max":
      return value <= spec.max ? "pass" : "fail";
    case "range":
      return value >= spec.min && value <= spec.max ? "pass" : "fail";
    case "tolerance": {
      // Compare at the precision the limits are written in, so 95 ± 10 is
      // not failed by binary noise in 85.00000000000001.
      const low = Number((spec.nominal - spec.tolerance).toPrecision(12));
      const high = Number((spec.nominal + spec.tolerance).toPrecision(12));
      return value >= low && value <= high ? "pass" : "fail";
    }
    case "na":
      return "na";
  }
}

export function formatSpec(spec: Spec): string {
  switch (spec.kind) {
    case "min":
      return `≥ ${formatDecimal(spec.min)}`;
    case "max":
      return `≤ ${formatDecimal(spec.max)}`;
    case "range":
      return `${formatDecimal(spec.min)} – ${formatDecimal(spec.max)}`;
    case "tolerance":
      return `${formatDecimal(spec.nominal)} ± ${formatDecimal(spec.tolerance)}`;
    case "na":
      return "NA";
  }
}
