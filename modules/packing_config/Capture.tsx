"use client";

// Packing configuration: three counts on the numeric keypad (Enter moves on,
// a pasted column fills the next fields). The gloves per case is worked out,
// gloves per inner unit x inner units per case (Kenneth, 27 October 2026:
// "if there is already an auto calulate field, why another to fill?"): once
// both are in, it shows read-only in its place with "100 × 10" under it,
// and it is typed only while one of them is missing (a document may state
// only the gloves per case). A stored one that is not their product, as data
// saved before may hold, shows with calc's warning until either count is
// edited (BUILD_SPEC 6.1, 6.2 rule 2). The onsite Packing Mode text when the
// template shows it. Every label is the template's (rule 11). Every change
// goes through useDataUpdater, built from the latest data.
import { useId, useRef, type FocusEvent } from "react";
import { EnterGroup, issuePathProps, NumberField, useDataUpdater, useIssueFocus } from "@/components/qc";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCount } from "@/lib/format";
import { labelFor, type CaptureProps } from "@/modules/_framework";
import { workedOutGlovesPerCase, type PackingConfigComputed } from "./calc";
import { PACKING_COUNTS, type PackingConfigConfig } from "./config";
import { setCount, setPackingMode, tidyPackingMode } from "./edit";
import { TEXT_MAX_LENGTH, type PackingConfigData } from "./schema";

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
  // calc's problems show on the field they point at: errors in red, a stored gloves per case that is not the product in amber.
  const messagesAt = (field: string, level: "error" | "warning") =>
    issues
      .filter((issue) => issue.level === level && issue.path.length === 1 && issue.path[0] === field)
      .map((issue) => issue.message);
  // From the data on screen, not calc's, so the field turns read-only with the count that completes it.
  const workedOut = workedOutGlovesPerCase(data);

  // A photo taken here has no size, hand, defect or box to tag.
  const clearFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFocusChange?.({});
  };

  return (
    <div ref={root} className="relative space-y-5" onFocus={clearFocus}>
      <EnterGroup className="grid gap-x-6 gap-y-5 sm:grid-cols-3">
        {PACKING_COUNTS.map((field) => {
          const worked = field === "glovesPerCase" && workedOut !== null;
          const value = worked ? (data.glovesPerCase ?? workedOut) : data[field];
          return (
            <NumberField
              key={field}
              id={`${id}-${field}`}
              label={labelFor(labels, field)}
              integer
              min={1}
              value={value}
              onValueChange={(next) => update((current) => setCount(current, field, next))}
              // What it is worked out from; a stored value that is not the product has calc's warning instead.
              hint={
                worked && value === workedOut
                  ? `${formatCount(data.glovesPerInner)} × ${formatCount(data.innersPerCase)}`
                  : undefined
              }
              error={messagesAt(field, "error")[0] ?? null}
              warning={messagesAt(field, "warning")}
              issuePath={[field]}
              readOnly={readOnly || worked}
            />
          );
        })}
      </EnterGroup>

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
            maxLength={TEXT_MAX_LENGTH}
            readOnly={readOnly}
          />
        </div>
      )}
    </div>
  );
}
