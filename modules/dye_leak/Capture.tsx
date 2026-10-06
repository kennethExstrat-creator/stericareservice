"use client";

// Dye leak capture (BUILD_SPEC 6.1 dye_leak, 8 "Speed"): one panel per
// ordered size (tabs on iPad, side by side from 1280 px). Counts are tapped,
// never typed: the pouches tested start from the plan (sampling plan, else
// config n), "No leaks" records a clean size in one tap, and the stepper
// counts leaking pouches. Every size tab carries calc's result. Every change
// goes through useDataUpdater, built from the latest data (edit.ts).
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Figure,
  findIssue,
  issuePathProps,
  SizeTabs,
  StatusPill,
  Stepper,
  useDataUpdater,
  useIssueFocus,
  type IssuePath,
} from "@/components/qc";
import { formatSize } from "@/lib/format";
import { labelFor, type CaptureProps } from "@/modules/_framework";
import { plannedPouches, type DyeLeakComputed } from "./calc";
import type { DyeLeakConfig } from "./config";
import { withNoLeaks, withSizeValues } from "./edit";
import { emptyDyeLeakSize, type DyeLeakData, type DyeLeakSize } from "./schema";

export default function Capture({
  data,
  config,
  labels,
  context,
  evaluation,
  focusPath,
  readOnly,
  onChange,
  onFocusChange,
}: CaptureProps<DyeLeakData, DyeLeakConfig, DyeLeakComputed>) {
  const update = useDataUpdater(data, onChange);
  // SizeTabs corrects a size that is not ordered (or set before sizes were).
  const [size, setSize] = useState(context.sizes[0] ?? "");
  const root = useRef<HTMLDivElement>(null);
  useIssueFocus(focusPath, {
    root,
    reveal: (path) => {
      if (path[0] === "sizes" && typeof path[1] === "string" && context.sizes.includes(path[1])) setSize(path[1]);
    },
  });

  const testedLabel = labelFor(labels, "pouchesTested");
  const failedLabel = labelFor(labels, "pouchesFailed");
  // Reads what is on screen; writes go through `update`.
  const entryOf = (key: string): DyeLeakSize => data.sizes[key] ?? emptyDyeLeakSize();
  const setValues = (key: string, values: Partial<DyeLeakSize>) =>
    update((current) => withSizeValues(current, key, values));
  const selectSize = (next: string) => {
    setSize(next);
    onFocusChange?.({ size: next });
  };
  // Empty when the module could not be evaluated (invalid data or config), whatever its type says.
  const computed: Partial<DyeLeakComputed> | undefined = evaluation?.computed;

  return (
    <div ref={root} className="space-y-4">
      {context.sizes.length > 0 && (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm touch:text-base">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{testedLabel}</dt>
            <dd className="font-semibold">
              <Figure value={computed?.totalTested} grouping />
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{failedLabel}</dt>
            <dd className="font-semibold">
              <Figure value={computed?.totalFailed} grouping />
            </dd>
          </div>
        </dl>
      )}
      <SizeTabs
        sizes={context.sizes}
        templateSizes={context.templateSizes}
        value={size}
        onValueChange={selectSize}
        results={evaluation?.result.perSize}
        wide="all"
      >
        {(key) => {
          const entry = entryOf(key);
          const planned = computed?.pouchesPlanned?.[key] ?? plannedPouches(context, config, key);
          const result = evaluation?.result.perSize?.[key];
          const sizeName = formatSize(key, { sizes: context.templateSizes, prefix: true });
          const path = (field: keyof DyeLeakSize): IssuePath => ["sizes", key, field];
          const message = (field: keyof DyeLeakSize) => findIssue(evaluation?.issues, path(field));
          return (
            <div
              className="space-y-3 rounded-lg border border-border bg-card p-3 touch:p-4"
              onFocus={() => onFocusChange?.({ size: key })}
              {...issuePathProps(["sizes", key])}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex gap-1.5 text-sm text-muted-foreground touch:text-base">
                  {labelFor(labels, "pouchesPlanned")}:
                  <Figure value={planned} className="font-semibold text-foreground" />
                </p>
                <StatusPill size="sm" status={result?.status ?? "not_done"} />
              </div>
              <CountField
                label={testedLabel}
                name={`${testedLabel}, ${sizeName}`}
                value={entry.pouchesTested}
                onValueChange={(pouchesTested) => setValues(key, { pouchesTested })}
                start={planned ?? 0}
                startLabel={planned === null ? "Start counting" : `${planned} as planned`}
                issuePath={path("pouchesTested")}
                message={message("pouchesTested")}
                readOnly={readOnly}
              />
              <CountField
                label={failedLabel}
                name={`${failedLabel}, ${sizeName}`}
                value={entry.pouchesFailed}
                onValueChange={(pouchesFailed) => setValues(key, { pouchesFailed })}
                start={0}
                onStart={() => update((current) => withNoLeaks(current, key, planned))}
                startLabel="No leaks"
                max={entry.pouchesTested ?? undefined}
                issuePath={path("pouchesFailed")}
                message={message("pouchesFailed")}
                readOnly={readOnly}
              />
              <NotesField
                label={labelFor(labels, "notes")}
                name={`${labelFor(labels, "notes")}, ${sizeName}`}
                value={entry.notes}
                onValueChange={(notes) => setValues(key, { notes })}
                issuePath={path("notes")}
                readOnly={readOnly}
              />
              {result?.summary && <p className="text-sm text-muted-foreground touch:text-base">{result.summary}</p>}
            </div>
          );
        }}
      </SizeTabs>
    </div>
  );
}

type Issue = { readonly level: "error" | "warning"; readonly message: string };

/**
 * A count tapped with the stepper. Until it is entered it shows one button
 * that sets the starting value, so "not entered" never looks like 0
 * (BUILD_SPEC 6.2 rule 5); the clear button takes it back to not entered.
 * Read-only, it is the number (or a dash), as the kit's steppers are.
 */
function CountField({
  label,
  name,
  value,
  onValueChange,
  start,
  onStart,
  startLabel,
  max,
  issuePath,
  message,
  readOnly,
}: {
  label: string;
  /** Accessible name with the size, e.g. "Pouches failed, Size 7.0". */
  name: string;
  value: number | null;
  onValueChange: (value: number | null) => void;
  start: number;
  onStart?: () => void;
  startLabel: string;
  max?: number;
  issuePath: IssuePath;
  message?: Issue;
  readOnly: boolean;
}) {
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

  return (
    <div ref={box} className="space-y-1.5" {...issuePathProps(issuePath)}>
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
      {message && <IssueText issue={message} />}
    </div>
  );
}

function NotesField({
  label,
  name,
  value,
  onValueChange,
  issuePath,
  readOnly,
}: {
  label: string;
  name: string;
  value: string | null;
  onValueChange: (value: string | null) => void;
  issuePath: IssuePath;
  readOnly: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5" {...issuePathProps(issuePath)}>
      <Label htmlFor={id} className="touch:text-base">
        {label}
      </Label>
      <Textarea
        id={id}
        aria-label={name}
        value={value ?? ""}
        onChange={(event) => onValueChange(event.target.value === "" ? null : event.target.value)}
        readOnly={readOnly}
        rows={2}
      />
    </div>
  );
}

function IssueText({ issue }: { issue: Issue }): ReactNode {
  return (
    <p className={cn("text-sm touch:text-base", issue.level === "error" ? "text-fail" : "text-warn")}>{issue.message}</p>
  );
}
