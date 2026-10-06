"use client";

// Packing configuration: three counts on the numeric keypad (Enter moves on,
// a pasted column fills the next fields), then the check the app computes,
// gloves per inner unit x inner units per case, against the gloves per case
// as printed (BUILD_SPEC 6.1, 6.2 rule 2). The onsite Packing Mode text when
// the template shows it. Every label is the template's (rule 11). Every
// change goes through useDataUpdater, built from the latest data.
import { useId, useRef, type FocusEvent } from "react";
import {
  EnterGroup,
  Figure,
  findIssue,
  issuePathProps,
  NumberField,
  StatusIcon,
  useDataUpdater,
  useIssueFocus,
} from "@/components/qc";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labelFor, type CaptureProps } from "@/modules/_framework";
import type { PackingConfigComputed } from "./calc";
import { PACKING_COUNTS, type PackingConfigConfig } from "./config";
import { setCount, setPackingMode, tidyPackingMode } from "./edit";
import type { PackingConfigData } from "./schema";

export default function Capture({
  data,
  config,
  labels,
  evaluation,
  focusPath,
  readOnly,
  onChange,
  onFocusChange,
}: CaptureProps<PackingConfigData, PackingConfigConfig, PackingConfigComputed>) {
  const root = useRef<HTMLDivElement>(null);
  useIssueFocus(focusPath, { root });
  const id = useId();
  const update = useDataUpdater(data, onChange);
  const issues = evaluation?.issues ?? [];
  const mismatch = issues.find((issue) => issue.code === "gloves_per_case_mismatch");
  // Errors show on the field; the mismatch is a warning and shows by the computed check.
  const errorAt = (field: string) => {
    const issue = findIssue(issues, [field]);
    return issue?.level === "error" ? issue.message : null;
  };

  // A photo taken here has no size, hand, defect or box to tag.
  const clearFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFocusChange?.({});
  };

  return (
    <div ref={root} className="relative space-y-5" onFocus={clearFocus}>
      <EnterGroup className="grid gap-x-6 gap-y-5 sm:grid-cols-3">
        {PACKING_COUNTS.map((field) => (
          <NumberField
            key={field}
            id={`${id}-${field}`}
            label={labelFor(labels, field)}
            integer
            min={1}
            value={data[field]}
            onValueChange={(value) => update((current) => setCount(current, field, value))}
            error={errorAt(field)}
            issuePath={[field]}
            readOnly={readOnly}
          />
        ))}
      </EnterGroup>

      <div className="space-y-2 rounded-lg border border-border bg-muted px-4 py-3">
        <dl className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <dt className="text-sm text-muted-foreground touch:text-base">{labelFor(labels, "glovesPerCaseCheck")}</dt>
          <dd className="text-base font-semibold">
            <Figure value={evaluation?.computed.glovesPerCaseCheck} grouping />
          </dd>
        </dl>
        {mismatch && (
          <p className="flex items-start gap-1.5 text-sm text-warn touch:text-base">
            <StatusIcon status="warn" className="mt-0.5 size-4 shrink-0" />
            {mismatch.message}
          </p>
        )}
      </div>

      {config.fields.packingMode && (
        <div className="space-y-1.5" {...issuePathProps(["packingMode"])}>
          <Label htmlFor={`${id}-packingMode`} className="leading-snug touch:text-base">
            {labelFor(labels, "packingMode")}
          </Label>
          <Input
            id={`${id}-packingMode`}
            value={data.packingMode ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              update((current) => setPackingMode(current, value));
            }}
            onBlur={() => update(tidyPackingMode)}
            autoComplete="off"
            readOnly={readOnly}
          />
        </div>
      )}
    </div>
  );
}
