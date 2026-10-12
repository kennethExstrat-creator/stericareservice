"use client";

// A box number, typed (BUILD_SPEC 6.2 rule 7): the inspector's own entry, a
// whole number from 1, on the numeric keypad as the carton numbers are. A
// box number is not a carton number: it is never picked from the carton list
// nor checked against it (Kenneth, 12 October 2026: "the box number has
// nothing to do with carton number"). Otherwise a NumberField: Enter walks
// its group, a pasted column fills down, refused text stays with its reason
// and, with `issuePath`, outlives the field.
import { NumberField, type NumberFieldProps } from "./number-field";

export type BoxNumberFieldProps = Omit<
  NumberFieldProps,
  "unit" | "min" | "max" | "minExclusive" | "integer" | "decimals" | "inputMode"
>;

export function BoxNumberField(props: BoxNumberFieldProps) {
  return <NumberField {...props} integer min={1} inputMode="numeric" />;
}
