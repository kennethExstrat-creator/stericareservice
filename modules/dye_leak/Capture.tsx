"use client";

// Dye leak capture (BUILD_SPEC 6.1 dye_leak, 8 "Speed"): one panel per
// ordered size (tabs on iPad, side by side from 1280 px). Counts are tapped,
// never typed: the pouches tested start from the plan (sampling plan, else
// config n), "No Leaks" records a clean size in one tap, and the stepper
// counts leaking pouches. Every size tab carries calc's result. Every change
// goes through useDataUpdater, built from the latest data (edit.ts).
import { useId, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CountField,
  Figure,
  findIssue,
  issuePathProps,
  SizeTabs,
  StatusPill,
  useDataUpdater,
  useIssueFocus,
  type IssuePath,
} from "@/components/qc";
import { formatSize } from "@/lib/format";
import { initialSize, labelFor, type CaptureProps } from "@/modules/_framework";
import { useReportShownSize, useSizeShownAlone } from "@/modules/_framework/shown-size";
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
  focus,
  onChange,
  onFocusChange,
}: CaptureProps<DyeLeakData, DyeLeakConfig, DyeLeakComputed>) {
  const update = useDataUpdater(data, onChange);
  // Opens on the size chosen in the last module; SizeTabs corrects a size that is not ordered (or set before sizes were).
  const [size, setSize] = useState(() => initialSize(context, focus));
  // The size on the tabs tags the photos taken now (BUILD_SPEC 8.1), from the moment the section
  // opens; from 1280 px every size is on screen and none is.
  useReportShownSize(useSizeShownAlone(context.sizes, size), onFocusChange);
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
                startLabel={planned === null ? "Start Counting" : `${planned} as Planned`}
                issuePath={path("pouchesTested")}
                {...messageProps(message("pouchesTested"))}
                readOnly={readOnly}
              />
              <CountField
                label={failedLabel}
                name={`${failedLabel}, ${sizeName}`}
                value={entry.pouchesFailed}
                onValueChange={(pouchesFailed) => setValues(key, { pouchesFailed })}
                start={0}
                onStart={() => update((current) => withNoLeaks(current, key, planned))}
                startLabel="No Leaks"
                max={entry.pouchesTested ?? undefined}
                issuePath={path("pouchesFailed")}
                {...messageProps(message("pouchesFailed"))}
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

/** calc's issue about a count, as CountField shows it: an error in red, a warning in amber. */
function messageProps(issue: Issue | undefined): { error?: string; warning?: string } {
  if (!issue) return {};
  return issue.level === "error" ? { error: issue.message } : { warning: issue.message };
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
