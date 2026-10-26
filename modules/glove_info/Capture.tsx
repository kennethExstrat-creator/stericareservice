"use client";

// Glove Information (BUILD_SPEC 6.1 glove_info): the Glove Type first, once
// per inspection (Kenneth, 12 October 2026), then the glove's surface
// texture, indicative weight, colour and length. One glove per inspection
// (Kenneth, 26 October 2026: "one inspection only includes one type of
// glove, so only 1 glove information variant"): one set of fields for every
// size, no Add Variant and no sizes to pick. An inspection saved with
// several variants (one PO could hold several from 11 October 2026) keeps
// them: each in a card with the sizes it covers and Remove, until one is
// left; one saved with sizes picked says so and offers to cover every size. Each shows the fields the template shows, in its wording (6.2 rule
// 11). The weight is a number on the decimal keypad, more than 0 g (rule 1),
// and so is the length in mm; the rest is text as printed. Enter moves on
// through the fields and Shift+Enter back. Every change goes through
// useDataUpdater, built from the latest data (docs/CAPTURE_KIT.md). The
// weight flows forward to the weight check through the context (rule 9).
// It sits beside packing configuration on the order's page, at about a
// third of the width: the fields lay out by the module's own width.
import { Trash2Icon } from "lucide-react";
import { useId, useRef, type FocusEvent, type KeyboardEvent } from "react";
import { EnterGroup, findIssue, issuePathProps, NumberField, useDataUpdater, useIssueFocus } from "@/components/qc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fieldIssues, labelFor, type CaptureProps } from "@/modules/_framework";
import { variantName, weightLabel, type GloveInfoComputed } from "./calc";
import { GLOVE_COLOURS, listedColour } from "./colours";
import { VARIANT_FIELDS, type GloveInfoConfig } from "./config";
import {
  coverEverySize,
  removeVariant,
  setGloveType,
  setIndicativeWeight,
  setLength,
  setText,
  tidyGloveType,
  tidyText,
} from "./edit";
import { emptyVariant, TEXT_MAX_LENGTH, type GloveInfoData, type GloveVariant } from "./schema";

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
  const shown = VARIANT_FIELDS.filter((field) => config.fields[field]);
  const sizeLabel = new Map(context.templateSizes.map((size) => [size.value, size.label]));
  // One blank glove on screen while none is saved: typing into it saves it.
  const variants = data.variants.length > 0 ? data.variants : [emptyVariant()];
  const several = variants.length > 1;

  // A photo taken here has no size, hand, defect or box to tag.
  const clearFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFocusChange?.({});
  };

  if (shown.length === 0 && !config.fields.gloveType) {
    return <p className="text-sm text-muted-foreground touch:text-base">No fields are switched on for this template.</p>;
  }

  /** A variant's fields, in the template's order and wording. */
  const fields = (variant: GloveVariant, index: number) => (
    <EnterGroup className="grid gap-x-6 gap-y-5 @md:grid-cols-2">
      {shown.map((field) =>
        field === "length" ? (
          <NumberField
            key={field}
            id={`${id}-${index}-${field}`}
            label={labelFor(labels, field)}
            unit="mm"
            min={0}
            minExclusive
            value={variant.length}
            onValueChange={(mm) => update((current) => setLength(current, index, mm))}
            error={findIssue(issues, ["variants", index, field])?.message ?? null}
            issuePath={["variants", index, field]}
            readOnly={readOnly}
          />
        ) : field === "indicativeWeight" ? (
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
          />
        ) : field === "colour" ? (
          <ColourField
            key={field}
            id={`${id}-${index}-${field}`}
            label={labelFor(labels, field)}
            value={variant.colour}
            issuePath={["variants", index, field]}
            readOnly={readOnly}
            onValueChange={(value) => update((current) => setText(current, index, field, value))}
          />
        ) : (
          <TextField
            key={field}
            id={`${id}-${index}-${field}`}
            label={labelFor(labels, field)}
            value={variant[field]}
            issuePath={["variants", index, field]}
            readOnly={readOnly}
            onValueChange={(value) => update((current) => setText(current, index, field, value))}
            onLeave={() => update((current) => tidyText(current, index, field))}
          />
        ),
      )}
    </EnterGroup>
  );

  /** The sizes a saved variant covers, in words; none picked covers every size. */
  const coveredSizes = (variant: GloveVariant) => variant.sizes.map((size) => sizeLabel.get(size) ?? size).join(", ");

  return (
    <div ref={root} data-slot="glove-info" className="@container relative flex flex-col gap-4" onFocus={clearFocus}>
      {config.fields.gloveType && (
        <div className="grid gap-x-6 @md:grid-cols-2">
          <div className="min-w-0 space-y-1.5" {...issuePathProps(["gloveType"])}>
            <Label htmlFor={`${id}-gloveType`} className="leading-snug touch:text-base">
              {labelFor(labels, "gloveType")}
            </Label>
            <Input
              id={`${id}-gloveType`}
              value={data.gloveType ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                update((current) => setGloveType(current, value));
              }}
              onBlur={() => update(tidyGloveType)}
              autoComplete="off"
              maxLength={TEXT_MAX_LENGTH}
              readOnly={readOnly}
            />
          </div>
        </div>
      )}

      {shown.length > 0 && !several && (
        <>
          {variants[0].sizes.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-muted px-3 py-2" {...issuePathProps(["variants", 0, "sizes"])}>
              <p className="min-w-0 flex-1 text-sm text-muted-foreground touch:text-base">
                Saved for size {coveredSizes(variants[0])} only.
              </p>
              {!readOnly && (
                <Button type="button" variant="outline" size="sm" onClick={() => update((current) => coverEverySize(current, 0))}>
                  Cover Every Size
                </Button>
              )}
            </div>
          )}
          {fields(variants[0], 0)}
        </>
      )}

      {shown.length > 0 && several && (
        <>
          <p className="text-sm text-muted-foreground touch:text-base">
            One glove per inspection: this one was saved with {variants.length} variants. Remove the ones that do not apply.
          </p>
          {variants.map((variant, index) => {
            const headingId = `${id}-variant-${index}`;
            const sizesIssue = findIssue(issues, ["variants", index, "sizes"]);
            return (
              <section
                key={index}
                aria-labelledby={headingId}
                data-variant={index}
                className="flex flex-col gap-4 rounded-lg bg-card p-4 ring-1 ring-border"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 id={headingId} className="text-base leading-snug font-semibold text-foreground">
                      {variantName(index)}
                    </h3>
                    <p className="text-sm text-muted-foreground touch:text-base" {...issuePathProps(["variants", index, "sizes"])}>
                      {variant.sizes.length > 0 ? `Size ${coveredSizes(variant)}` : "Every size"}
                    </p>
                  </div>
                  {!readOnly && (
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
                {sizesIssue && <p className="text-sm text-warn">{sizesIssue.message}</p>}
                {fields(variant, index)}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

/**
 * Glove Colour as a dropdown: each colour by its name and a dot of it
 * (colours.ts; Kenneth, 26 October 2026). A name saved earlier that is not
 * on the list comes first, as it is, so nothing is lost.
 */
function ColourField({
  id,
  label,
  value,
  issuePath,
  readOnly,
  onValueChange,
}: {
  id: string;
  label: string;
  value: string | null;
  issuePath: readonly (string | number)[];
  readOnly: boolean;
  onValueChange: (value: string) => void;
}) {
  const listed = listedColour(value);
  const options = listed !== null || value === null ? GLOVE_COLOURS : [{ name: value, swatch: null }, ...GLOVE_COLOURS];
  return (
    <div className="min-w-0 space-y-1.5" {...issuePathProps([...issuePath])}>
      <Label htmlFor={id} className="leading-snug touch:text-base">
        {label}
      </Label>
      <Select value={listed?.name ?? value ?? ""} onValueChange={onValueChange} disabled={readOnly}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Choose the colour" />
        </SelectTrigger>
        <SelectContent>
          {options.map((colour) => (
            <SelectItem key={colour.name} value={colour.name}>
              {/* The dot before the name (Kenneth, 26 October 2026); a name with no colour keeps the dot's space, so
                  the names line up. */}
              <span
                aria-hidden
                data-slot="colour-dot"
                className={cn(
                  "inline-block size-3 shrink-0 rounded-full",
                  colour.swatch === null ? "invisible" : "ring-1 ring-slate-900/20",
                )}
                style={colour.swatch === null ? undefined : { backgroundColor: colour.swatch }}
              />
              {colour.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** A text field of the variant, in the run Enter moves through with the number fields. */
function TextField({
  id,
  label,
  value,
  issuePath,
  readOnly,
  onValueChange,
  onLeave,
}: {
  id: string;
  label: string;
  value: string | null;
  issuePath: readonly (string | number)[];
  readOnly: boolean;
  onValueChange: (value: string) => void;
  onLeave: () => void;
}) {
  return (
    <div className="min-w-0 space-y-1.5" {...issuePathProps([...issuePath])}>
      <Label htmlFor={id} className="leading-snug touch:text-base">
        {label}
      </Label>
      <Input
        id={id}
        value={value ?? ""}
        onChange={(event) => onValueChange(event.target.value)}
        onBlur={onLeave}
        onKeyDown={moveOnEnter}
        enterKeyHint="next"
        autoComplete="off"
        maxLength={TEXT_MAX_LENGTH}
        readOnly={readOnly}
        // One run with the number fields: Enter goes on to the next field (the kit's run attributes).
        data-enter-field=""
        data-enter-group=""
      />
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
