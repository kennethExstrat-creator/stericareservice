// Specification limits as the reports print them, with units and decimals:
// "≥ 240", "95 ± 10", "≤ 5%", "≥ 14.00 MPa", "0.05 – 0.10 mm" or "NA".
// The same text as lib/stats' formatSpec when no options are given (spec.test.ts
// checks it), plus a unit, fixed decimals and a missing spec. Display code
// imports this one; calc keeps lib/stats'.
import type { Spec } from "@/lib/stats";
import { formatNumber, withUnit } from "./number";

export type SpecFormat = {
  /** Canonical unit: "≥ 6 N", "≤ 5%". Never added to NA. */
  unit?: string;
  /** Fixed decimals for every limit, as the template prints them: "≥ 14.00". */
  decimals?: number;
};

export function formatSpec(spec: Spec | null | undefined, { unit, decimals }: SpecFormat = {}): string {
  if (!spec) return "NA";
  const n = (value: number) => formatNumber(value, { decimals });
  switch (spec.kind) {
    case "min":
      return withUnit(`≥ ${n(spec.min)}`, unit);
    case "max":
      return withUnit(`≤ ${n(spec.max)}`, unit);
    case "range":
      return withUnit(`${n(spec.min)} – ${n(spec.max)}`, unit);
    case "tolerance":
      return withUnit(`${n(spec.nominal)} ± ${n(spec.tolerance)}`, unit);
    case "na":
      return "NA";
  }
}

/** True when the spec sets a limit a value can pass or fail. */
export function hasLimit(spec: Spec | null | undefined): spec is Exclude<Spec, { kind: "na" }> {
  return spec !== null && spec !== undefined && spec.kind !== "na";
}
