"use client";

// A count tapped with a Stepper that can also be not entered yet (BUILD_SPEC
// 6.2 rule 5): until it is entered it shows one button that sets the starting
// value ("13 as Planned", "No Leaks"), so "not entered" never looks like 0;
// a clear button takes it back to not entered. Read-only, it is the number,
// or a dash. calc's error or warnings about the count show below it.
import { useEffect, useRef } from "react";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Figure } from "./figure";
import { issuePathProps, type IssuePath } from "./issue-path";
import { StatusIcon } from "./status-icon";
import { Stepper } from "./stepper";

type CountFieldProps = {
  /** In the template's wording, e.g. "Pouches Failed". */
  label: string;
  /** Accessible name of the stepper and its buttons, e.g. "Pouches Failed, Size 7.0". Defaults to the label. */
  name?: string;
  value: number | null;
  onValueChange: (value: number | null) => void;
  /** What the start button sets. Default 0. */
  start?: number;
  /** Replaces setting `start`, e.g. an edit that also fills another count. */
  onStart?: () => void;
  /** Words on the start button, in Title Case as every button is, e.g. "13 as Planned" or "No Leaks". */
  startLabel?: string;
  min?: number;
  /** Ignored while below the value, so a stored count above it can still be lowered. */
  max?: number;
  /** calc's error about the count, in red below it. */
  error?: string | null;
  /** calc's warnings about the count, in amber below it. */
  warning?: string | readonly string[] | null;
  /** Marks the field for issue links (useIssueFocus). */
  issuePath?: IssuePath;
  readOnly?: boolean;
  className?: string;
};

export function CountField({
  label,
  name = label,
  value,
  onValueChange,
  start = 0,
  onStart,
  startLabel = "Start Counting",
  min = 0,
  max,
  error,
  warning,
  issuePath,
  readOnly = false,
  className,
}: CountFieldProps) {
  const box = useRef<HTMLDivElement>(null);
  // The start and clear buttons each replace themselves with the other
  // control: a keyboard user's focus moves on to it instead of being dropped.
  const refocus = useRef(false);
  const holdFocus = () => {
    refocus.current = box.current?.contains(document.activeElement) ?? false;
  };
  const entered = value !== null;
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    box.current?.querySelector<HTMLElement>(entered ? '[role="spinbutton"]' : "button")?.focus();
  }, [entered]);

  const warnings = (typeof warning === "string" ? [warning] : (warning ?? [])).filter((text) => text !== "");

  return (
    <div ref={box} data-slot="count-field" className={cn("space-y-1.5", className)} {...issuePathProps(issuePath)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="text-sm font-medium touch:text-base">{label}</span>
        {readOnly ? (
          <Figure value={value} className="text-base font-semibold touch:text-lg" />
        ) : value === null ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="touch:text-base"
            aria-label={`${startLabel}, ${name}`}
            onClick={() => {
              holdFocus();
              if (onStart) onStart();
              else onValueChange(start);
            }}
          >
            {startLabel}
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            <Stepper
              label={name}
              value={value}
              onValueChange={onValueChange}
              min={min}
              max={max !== undefined && max >= value ? max : undefined}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Clear ${name}`}
              onClick={() => {
                holdFocus();
                onValueChange(null);
              }}
            >
              <XIcon aria-hidden />
            </Button>
          </div>
        )}
      </div>
      {error && <p className="text-sm text-fail touch:text-base">{error}</p>}
      {warnings.map((message) => (
        <p key={message} className="flex items-start gap-1.5 text-sm text-warn touch:text-base">
          <StatusIcon status="warn" className="mt-0.5 size-4 shrink-0 touch:mt-1" />
          <span>{message}</span>
        </p>
      ))}
    </div>
  );
}
