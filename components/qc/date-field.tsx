"use client";

// A date from the date picker (BUILD_SPEC 6.2 rule 3: dates use pickers, so
// a count never turns into a date): the browser's own picker (the iPad's
// wheel, a desktop calendar), stored as "YYYY-MM-DD" or null when cleared,
// with four-digit years only (some browsers take a sixth year digit without a
// maximum). Labelled above, calc's error in red or warnings in amber below,
// as NumberField does. Read-only it sits on grey and stays focusable.
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { issuePathProps, type IssuePath } from "./issue-path";
import { StatusIcon } from "./status-icon";

type DateFieldProps = Omit<ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange" | "children"> & {
  /** In the template's wording. */
  label: ReactNode;
  /** "YYYY-MM-DD", or null while none is picked. */
  value: string | null;
  onValueChange: (value: string | null) => void;
  hint?: ReactNode;
  /** A problem calc found with the date, in red. */
  error?: string | null;
  /** calc's warnings about the date, in amber, e.g. an expiry date not after the manufacturing date. */
  warning?: string | readonly string[] | null;
  /** Marks the field for issue links (useIssueFocus). */
  issuePath?: IssuePath;
  /** The wrapper's class; the input's own is `inputClassName`. */
  className?: string;
  inputClassName?: string;
};

export function DateField({
  label,
  value,
  onValueChange,
  hint,
  error,
  warning,
  issuePath,
  id,
  max = "9999-12-31",
  className,
  inputClassName,
  "aria-describedby": describedBy,
  ...props
}: DateFieldProps) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-calc-error`;
  const warningId = `${inputId}-calc-warning`;
  const warnings = (typeof warning === "string" ? [warning] : (warning ?? [])).filter((text) => text !== "");
  const description = [describedBy, hint ? hintId : null, error ? errorId : null, warnings.length > 0 ? warningId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div data-slot="date-field" className={cn("min-w-0 space-y-1.5", className)} {...issuePathProps(issuePath)}>
      <Label htmlFor={inputId} className="leading-snug touch:text-base">
        {label}
      </Label>
      <Input
        {...props}
        id={inputId}
        type="date"
        max={max}
        value={value ?? ""}
        onChange={(event) => onValueChange(event.target.value === "" ? null : event.target.value)}
        aria-describedby={description || undefined}
        className={cn(error ? "border-destructive" : warnings.length > 0 && "border-warn-solid", inputClassName)}
      />
      {hint && (
        <p id={hintId} className="text-sm text-muted-foreground touch:text-base">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm text-fail touch:text-base">
          {error}
        </p>
      )}
      {warnings.length > 0 && (
        <div id={warningId} className="space-y-1 text-sm text-warn touch:text-base">
          {warnings.map((message) => (
            <p key={message} className="flex items-start gap-1.5">
              <StatusIcon status="warn" className="mt-0.5 size-4 shrink-0 touch:mt-1" />
              <span>{message}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
