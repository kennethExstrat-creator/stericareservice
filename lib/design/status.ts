// Labels and class strings for result states. Kept as literal strings so
// Tailwind sees every class; components pick from these maps.
import type { Status } from "./tokens";

export type { Status } from "./tokens";
export { STATUSES } from "./tokens";

/** The pill words, in Title Case like every label (docs/DESIGN.md, Capitalisation). */
export const STATUS_LABEL: Readonly<Record<Status, string>> = {
  pass: "Passed",
  fail: "Failed",
  warn: "Warning",
  hold: "On Hold",
  info: "Info",
  not_done: "Not Done",
};

/**
 * A part of a check the inspector left out, with no result of its own: a
 * visual class with no sample entered and nothing counted (Kenneth, 30
 * October 2026). It wears not_done's look, the dashed slate pill, with this
 * word, wherever the class shows: the capture card, the review, the report.
 */
export const NOT_INSPECTED_LABEL = "Not Inspected";

/** Tinted pill: status text on its tint. not_done is dashed, so empty reads as empty. */
export const STATUS_TINT_CLASS: Readonly<Record<Status, string>> = {
  pass: "border-pass-border bg-pass-tint text-pass",
  fail: "border-fail-border bg-fail-tint text-fail",
  warn: "border-warn-border bg-warn-tint text-warn",
  hold: "border-hold-border bg-hold-tint text-hold",
  info: "border-info-border bg-info-tint text-info",
  not_done: "border-dashed border-not-done-border bg-not-done-tint text-not-done",
};

/** Solid fill for compact or emphatic use (module tabs, the final result). */
export const STATUS_SOLID_CLASS: Readonly<Record<Status, string>> = {
  pass: "border-pass-solid bg-pass-solid text-pass-solid-foreground",
  fail: "border-fail-solid bg-fail-solid text-fail-solid-foreground",
  warn: "border-warn-solid bg-warn-solid text-warn-solid-foreground",
  hold: "border-hold-solid bg-hold-solid text-hold-solid-foreground",
  info: "border-info-solid bg-info-solid text-info-solid-foreground",
  not_done: "border-not-done-solid bg-not-done-solid text-not-done-solid-foreground",
};

/** Plain status text on white or mist, e.g. a P/F cell. */
export const STATUS_TEXT_CLASS: Readonly<Record<Status, string>> = {
  pass: "text-pass",
  fail: "text-fail",
  warn: "text-warn",
  hold: "text-hold",
  info: "text-info",
  not_done: "text-not-done",
};
