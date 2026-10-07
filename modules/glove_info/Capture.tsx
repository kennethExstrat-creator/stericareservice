"use client";

// Glove Information (BUILD_SPEC 6.1 glove_info): the glove's surface texture,
// indicative weight, colour and length, in the order both reports print them
// and in the template's wording (6.2 rule 11), only the fields the template
// shows. The weight is a number on the decimal keypad, more than 0 g (rule
// 1); the rest is text as printed ("240 mm minimum"). Enter moves on through
// the four fields and Shift+Enter back, as in any run of kit fields. Every
// change goes through useDataUpdater, built from the latest data
// (docs/CAPTURE_KIT.md). The weight flows forward to the weight check
// through the context (rule 9).
import { useId, useRef, type FocusEvent, type KeyboardEvent } from "react";
import { EnterGroup, findIssue, issuePathProps, NumberField, useDataUpdater, useIssueFocus } from "@/components/qc";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fieldIssues, labelFor, type CaptureProps } from "@/modules/_framework";
import type { GloveInfoComputed } from "./calc";
import { GLOVE_INFO_FIELDS, type GloveInfoConfig } from "./config";
import { setIndicativeWeight, setText, tidyText } from "./edit";
import { TEXT_MAX_LENGTH, type GloveInfoData, type GloveInfoTextField } from "./schema";

export default function Capture({
  data,
  config,
  labels,
  evaluation,
  focusPath,
  readOnly,
  onChange,
  onFocusChange,
}: CaptureProps<GloveInfoData, GloveInfoConfig, GloveInfoComputed>) {
  const root = useRef<HTMLDivElement>(null);
  useIssueFocus(focusPath, { root });
  const id = useId();
  const update = useDataUpdater(data, onChange);
  const issues = fieldIssues(evaluation?.issues);
  const shown = GLOVE_INFO_FIELDS.filter((field) => config.fields[field]);

  // A photo taken here has no size, hand, defect or box to tag.
  const clearFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFocusChange?.({});
  };

  if (shown.length === 0) {
    return <p className="text-sm text-muted-foreground touch:text-base">No fields are switched on for this template.</p>;
  }

  const textField = (field: GloveInfoTextField) => (
    <div key={field} className="min-w-0 space-y-1.5" {...issuePathProps([field])}>
      <Label htmlFor={`${id}-${field}`} className="leading-snug touch:text-base">
        {labelFor(labels, field)}
      </Label>
      <Input
        id={`${id}-${field}`}
        value={data[field] ?? ""}
        onChange={(event) => {
          const value = event.target.value;
          update((current) => setText(current, field, value));
        }}
        onBlur={() => update((current) => tidyText(current, field))}
        onKeyDown={moveOnEnter}
        enterKeyHint="next"
        autoComplete="off"
        maxLength={TEXT_MAX_LENGTH}
        readOnly={readOnly}
        // One run with the weight field: Enter goes on to the next field (the kit's run attributes).
        data-enter-field=""
        data-enter-group=""
      />
    </div>
  );

  return (
    <div ref={root} data-slot="glove-info" className="relative" onFocus={clearFocus}>
      <EnterGroup className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        {shown.map((field) =>
          field === "indicativeWeight" ? (
            <NumberField
              key={field}
              id={`${id}-${field}`}
              label={labelFor(labels, field)}
              unit="g"
              min={0}
              // calc refuses 0 g or less: so does the field ("Must be more than 0.").
              minExclusive
              value={data.indicativeWeight}
              onValueChange={(grams) => update((current) => setIndicativeWeight(current, grams))}
              error={findIssue(issues, [field])?.message ?? null}
              issuePath={[field]}
              readOnly={readOnly}
            />
          ) : (
            textField(field)
          ),
        )}
      </EnterGroup>
    </div>
  );
}

/**
 * Enter moves on to the next field of the run, Shift+Enter back, as a
 * NumberField does in its EnterGroup: the run is every field marked with the
 * kit's run attributes in the nearest EnterGroup, in reading order.
 */
function moveOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const own = event.currentTarget;
  const scope = own.closest("[data-enter-scope]");
  if (!scope) return;
  const fields = Array.from(scope.querySelectorAll<HTMLInputElement>("input[data-enter-field]")).filter(
    (field) => field === own || (!field.readOnly && !field.disabled && field.getClientRects().length > 0),
  );
  fields[fields.indexOf(own) + (event.shiftKey ? -1 : 1)]?.focus();
}
