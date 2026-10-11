"use client";

// Glove Information (BUILD_SPEC 6.1 glove_info): the glove's variants. A
// variant is one combination of surface texture, indicative weight, colour
// and length, for the sizes it covers (Kenneth, 11 October 2026: one PO can
// hold several); none picked covers every size. Each shows the fields the
// template shows, in its wording (6.2 rule 11). The weight is a number on
// the decimal keypad, more than 0 g (rule 1); the rest is text as printed
// ("240 mm minimum"). Enter moves on through a variant's fields and
// Shift+Enter back. Every change goes through useDataUpdater, built from the
// latest data (docs/CAPTURE_KIT.md). Each variant's weight flows forward to
// the weight check through the context, for its sizes (rule 9).
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useId, useRef, type FocusEvent, type KeyboardEvent } from "react";
import { EnterGroup, findIssue, issuePathProps, NumberField, useDataUpdater, useIssueFocus } from "@/components/qc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { fieldIssues, labelFor, type CaptureProps } from "@/modules/_framework";
import { variantName, weightLabel, weightSizeOf, type GloveInfoComputed } from "./calc";
import { GLOVE_INFO_FIELDS, OPTIONAL_GLOVE_INFO_FIELDS, type GloveInfoConfig } from "./config";
import { addVariant, removeVariant, setIndicativeWeight, setText, tidyText, toggleSize } from "./edit";
import { emptyVariant, MAX_VARIANTS, TEXT_MAX_LENGTH, type GloveInfoData, type GloveInfoTextField } from "./schema";

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
}: CaptureProps<GloveInfoData, GloveInfoConfig, GloveInfoComputed>) {
  const root = useRef<HTMLDivElement>(null);
  useIssueFocus(focusPath, { root });
  const id = useId();
  const update = useDataUpdater(data, onChange);
  const issues = fieldIssues(evaluation?.issues);
  const shown = GLOVE_INFO_FIELDS.filter((field) => config.fields[field]);
  const sizes = context.templateSizes;
  const sizeOrder = sizes.map((size) => size.value);
  // One blank variant on screen while none is saved: typing into it saves it.
  const variants = data.variants.length > 0 ? data.variants : [emptyVariant()];

  // A photo taken here has no size, hand, defect or box to tag.
  const clearFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFocusChange?.({});
  };

  if (shown.length === 0) {
    return <p className="text-sm text-muted-foreground touch:text-base">No fields are switched on for this template.</p>;
  }

  return (
    <div ref={root} data-slot="glove-info" className="relative flex flex-col gap-4" onFocus={clearFocus}>
      {variants.map((variant, index) => {
        const headingId = `${id}-variant-${index}`;
        const textField = (field: GloveInfoTextField) => (
          <div key={field} className="min-w-0 space-y-1.5" {...issuePathProps(["variants", index, field])}>
            <Label htmlFor={`${id}-${index}-${field}`} className="leading-snug touch:text-base">
              {labelFor(labels, field)}
              {OPTIONAL_GLOVE_INFO_FIELDS.has(field) && <span className="font-normal text-muted-foreground"> (Optional)</span>}
            </Label>
            <Input
              id={`${id}-${index}-${field}`}
              value={variant[field] ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                update((current) => setText(current, index, field, value));
              }}
              onBlur={() => update((current) => tidyText(current, index, field))}
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
          <section
            key={index}
            aria-labelledby={headingId}
            data-variant={index}
            className="flex flex-col gap-4 rounded-lg bg-card p-4 ring-1 ring-border"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 id={headingId} className="text-base leading-snug font-semibold text-foreground">
                {variantName(index)}
              </h3>
              {!readOnly && data.variants.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title={`Remove ${variantName(index)}`}
                  className="text-destructive hover:bg-fail-tint hover:text-destructive"
                  onClick={() => update((current) => removeVariant(current, index))}
                >
                  <Trash2Icon aria-hidden />
                  <span className="sr-only">Remove {variantName(index)}</span>
                </Button>
              )}
            </div>

            {sizes.length > 0 && (
              <div className="flex flex-col gap-2" {...issuePathProps(["variants", index, "sizes"])}>
                <p id={`${headingId}-sizes`} className="text-sm leading-snug font-medium text-foreground touch:text-base">
                  Sizes{" "}
                  <span className="font-normal text-muted-foreground">
                    {variant.sizes.length === 0 ? "(None Picked: Every Size)" : ""}
                  </span>
                </p>
                <div role="group" aria-labelledby={`${headingId}-sizes`} className="flex flex-wrap gap-2">
                  {sizes.map((size) => {
                    const picked = variant.sizes.includes(size.value);
                    return (
                      <button
                        key={size.value}
                        type="button"
                        aria-pressed={picked}
                        disabled={readOnly}
                        onClick={() => update((current) => toggleSize(current, index, size.value, sizeOrder))}
                        className={cn(
                          "min-w-10 rounded-full px-3 text-sm font-semibold ring-1 transition-colors outline-none focus-ring h-8 touch:h-11 touch:min-w-11",
                          picked
                            ? "bg-brand-600 text-white ring-brand-600"
                            : "bg-card text-muted-foreground ring-border hover:text-foreground",
                          readOnly && "cursor-default",
                        )}
                      >
                        {size.label}
                      </button>
                    );
                  })}
                </div>
                {findIssue(issues, ["variants", index, "sizes"]) && (
                  <p className="text-sm text-warn">{findIssue(issues, ["variants", index, "sizes"])?.message}</p>
                )}
              </div>
            )}

            <EnterGroup className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
              {shown.map((field) =>
                field === "indicativeWeight" ? (
                  <NumberField
                    key={field}
                    id={`${id}-${index}-${field}`}
                    label={weightLabel(labels)}
                    unit="g"
                    min={0}
                    // calc refuses 0 g or less: so does the field ("Must be more than 0.").
                    minExclusive
                    value={variant.indicativeWeight}
                    onValueChange={(grams) => update((current) => setIndicativeWeight(current, index, grams))}
                    error={findIssue(issues, ["variants", index, field])?.message ?? null}
                    issuePath={["variants", index, field]}
                    readOnly={readOnly}
                    hint={weightHint(weightSizeOf(variant, config.indicativeWeightSize))}
                  />
                ) : (
                  textField(field)
                ),
              )}
            </EnterGroup>
          </section>
        );
      })}

      {!readOnly && variants.length < MAX_VARIANTS && (
        <Button type="button" variant="outline" className="self-start" onClick={() => update(addVariant)}>
          <PlusIcon aria-hidden />
          Add Variant
        </Button>
      )}
    </div>
  );
}

/** Under the weight: which size's weighed gloves it is compared with. */
function weightHint(size: string | null): string {
  return size ? `Compared with size ${size}'s weighed gloves.` : "Pick one size to compare it with the weighed gloves.";
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
