// Compact result for module tabs: a filled disc with a glyph whose shape
// carries the meaning, plus a screen-reader label. Not Done stays an empty
// dashed ring, so an unfinished module never looks like a result. The disc is
// positioned so its sr-only label stays inside it: in a horizontally scrolling
// tab bar an unanchored label would widen the whole page.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_SOLID_CLASS, STATUS_TINT_CLASS, type Status } from "@/lib/design/status";

const GLYPH: Readonly<Record<Exclude<Status, "not_done">, ReactNode>> = {
  pass: <path d="m6.25 10.25 2.5 2.5 5-5.25" />,
  fail: <path d="m7 7 6 6m0-6-6 6" />,
  warn: (
    <>
      <path d="M10 5.75v5" />
      <circle cx="10" cy="14" r="0.4" />
    </>
  ),
  hold: <path d="M8 6.75v6.5m4-6.5v6.5" />,
  info: (
    <>
      <circle cx="10" cy="6.25" r="0.4" />
      <path d="M10 9.25v5" />
    </>
  ),
};

export function ResultChip({
  status,
  label,
  className,
}: {
  status: Status;
  /** Screen-reader text; defaults to the status label. */
  label?: string;
  className?: string;
}) {
  return (
    <span
      data-slot="result-chip"
      data-status={status}
      className={cn(
        "relative inline-flex size-5 shrink-0 items-center justify-center rounded-full border",
        status === "not_done" ? STATUS_TINT_CLASS.not_done : STATUS_SOLID_CLASS[status],
        className,
      )}
    >
      {status !== "not_done" && (
        <svg
          viewBox="0 0 20 20"
          aria-hidden
          className="size-full"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {GLYPH[status]}
        </svg>
      )}
      <span className="sr-only">{label ?? STATUS_LABEL[status]}</span>
    </span>
  );
}
