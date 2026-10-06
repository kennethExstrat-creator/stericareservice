"use client";

// Loading capture (BUILD_SPEC 6.1 loading): the fields the template switches
// on, with the cartons loaded next to the order's total cartons, which flow
// forward from order_lots and are never typed (6.2 rule 2). The loading
// stage picked here is reported as the focus for photo tags (BUILD_SPEC 8.1);
// lib/photos cannot tag by stage yet, so the screen promises no tag. Every
// change goes through useDataUpdater, built from the latest data (edit.ts).
import { useId, useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Figure,
  findIssue,
  issuePathProps,
  ModuleSection,
  NumberField,
  useDataUpdater,
  useIssueFocus,
} from "@/components/qc";
import { formatCount } from "@/lib/format";
import { labelFor, type CaptureFocus, type CaptureProps } from "@/modules/_framework";
import { cartonsOrdered, type LoadingComputed } from "./calc";
import { LOADING_STAGES, type LoadingConfig, type LoadingStage } from "./config";
import { withLoadingValues } from "./edit";
import type { LoadingData } from "./schema";

/**
 * The focus for photo tags. CaptureFocus has no slot yet for an entry of a
 * module's own list, so `item` rides along until the framework and
 * lib/photos take it (handed over as a follow-up); autoTag drops it today.
 */
type ItemFocus = CaptureFocus & { readonly item: string };

function stageFocus(stage: LoadingStage): CaptureFocus {
  const focus: ItemFocus = { item: stage };
  return focus;
}

const isStage = (value: string): value is LoadingStage => (LOADING_STAGES as readonly string[]).includes(value);

/** An emptied field is not entered; calc reads blank text the same way. */
const textOrNull = (value: string) => (value === "" ? null : value);

/** calc's checks here are warnings (amber); an error stays red. */
const issueTone = (issue: { readonly level: string }) => (issue.level === "error" ? "text-fail" : "text-warn");

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
}: CaptureProps<LoadingData, LoadingConfig, LoadingComputed>) {
  const update = useDataUpdater(data, onChange);
  const uid = useId();
  const root = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<LoadingStage | null>(null);
  useIssueFocus(focusPath, { root });

  const { fields } = config;
  const anyField = fields.containerNo || fields.sealNo || fields.cartonsLoaded || fields.cartonCondition;
  const ordered = evaluation?.computed.cartonsOrdered ?? cartonsOrdered(context);
  const set = (values: Partial<LoadingData>) => update((current) => withLoadingValues(current, values));
  const containerIssue = findIssue(evaluation?.issues, ["containerNo"]);
  const quantityIssue = findIssue(evaluation?.issues, ["cartonsLoaded"]);
  const pickStage = (value: string) => {
    const next = isStage(value) ? value : null;
    setStage(next);
    // A stage picked again is let go: the focus no longer names it.
    onFocusChange?.(next ? stageFocus(next) : {});
  };

  return (
    <div ref={root} className="space-y-5">
      {anyField && (
        // Not an EnterGroup: with one number field there is no run for Enter to move along.
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.containerNo && (
            <div className="space-y-1.5" {...issuePathProps(["containerNo"])}>
              <Label htmlFor={`${uid}-container`} className="touch:text-base">
                {labelFor(labels, "containerNo")}
              </Label>
              <CapitalsInput
                id={`${uid}-container`}
                value={data.containerNo ?? ""}
                onValueChange={(containerNo) => set({ containerNo: textOrNull(containerNo) })}
                readOnly={readOnly}
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby={containerIssue ? `${uid}-container-issue` : undefined}
                className={cn("tabular-nums", containerIssue && "border-warn-solid")}
              />
              {containerIssue && (
                <p id={`${uid}-container-issue`} className={cn("text-sm touch:text-base", issueTone(containerIssue))}>
                  {containerIssue.message}
                </p>
              )}
            </div>
          )}
          {fields.sealNo && (
            <div className="space-y-1.5" {...issuePathProps(["sealNo"])}>
              <Label htmlFor={`${uid}-seal`} className="touch:text-base">
                {labelFor(labels, "sealNo")}
              </Label>
              <Input
                id={`${uid}-seal`}
                value={data.sealNo ?? ""}
                onChange={(event) => set({ sealNo: textOrNull(event.target.value) })}
                readOnly={readOnly}
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          )}
          {fields.cartonsLoaded && (
            <div className="space-y-2">
              <NumberField
                label={labelFor(labels, "cartonsLoaded")}
                value={data.cartonsLoaded}
                onValueChange={(cartonsLoaded) => set({ cartonsLoaded })}
                integer
                min={0}
                issuePath={["cartonsLoaded"]}
                // The hint describes the field, so the mismatch warning is read out with it.
                hint={
                  <>
                    <span className="inline-flex flex-wrap gap-x-1.5">
                      {labelFor(labels, "cartonsOrdered")}:
                      <Figure value={ordered} grouping className="font-semibold text-foreground" />
                    </span>
                    {quantityIssue && <span className={cn("block", issueTone(quantityIssue))}>{quantityIssue.message}</span>}
                  </>
                }
                readOnly={readOnly}
              />
              {!readOnly && data.cartonsLoaded === null && ordered !== null && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="touch:text-base"
                  onClick={() => set({ cartonsLoaded: ordered })}
                >
                  All {formatCount(ordered)} loaded
                </Button>
              )}
            </div>
          )}
          {fields.cartonCondition && (
            <div className="space-y-1.5 sm:col-span-2" {...issuePathProps(["cartonCondition"])}>
              <Label htmlFor={`${uid}-condition`} className="touch:text-base">
                {labelFor(labels, "cartonCondition")}
              </Label>
              <Textarea
                id={`${uid}-condition`}
                value={data.cartonCondition ?? ""}
                onChange={(event) => set({ cartonCondition: textOrNull(event.target.value) })}
                readOnly={readOnly}
                rows={2}
              />
            </div>
          )}
        </div>
      )}

      {/* Photos cannot be added to a read-only inspection, so there is no stage to pick. */}
      {!readOnly && (
        <ModuleSection title={labelFor(labels, "loadingStage")}>
          <ToggleGroup
            type="single"
            variant="outline"
            spacing={1}
            value={stage ?? ""}
            onValueChange={pickStage}
            aria-label={labelFor(labels, "loadingStage")}
            className="w-full flex-wrap"
          >
            {LOADING_STAGES.map((value) => (
              <ToggleGroupItem
                key={value}
                value={value}
                className="rounded-full px-4 touch:text-base data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              >
                {labelFor(labels, value)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </ModuleSection>
      )}
    </div>
  );
}

/** Where the inspector's caret was in the value they typed, rewritten in capitals. */
type Caret = { value: string; start: number; end: number; direction: NonNullable<HTMLInputElement["selectionDirection"]> };

/**
 * A text field kept in capitals: container numbers are painted in capitals,
 * and storing them so keeps the export clean. Writing the capitals back
 * moves the browser's caret to the end, so a letter typed in lower case in
 * the middle of a number would send the next one to the end; the caret is
 * put back where it was before the screen paints.
 */
function CapitalsInput({
  value,
  onValueChange,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "ref"> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<Caret | null>(null);
  useLayoutEffect(() => {
    const typed = caret.current;
    caret.current = null;
    const node = input.current;
    if (!typed || !node || node.value !== typed.value || node.ownerDocument.activeElement !== node) return;
    node.setSelectionRange(typed.start, typed.end, typed.direction);
  });

  return (
    <Input
      {...props}
      ref={input}
      value={value}
      onChange={(event) => {
        const { value: text, selectionStart: start, selectionEnd: end, selectionDirection } = event.target;
        const capitals = text.toUpperCase();
        // Only a value rewritten in capitals moves the caret.
        caret.current =
          capitals !== text && start !== null && end !== null
            ? { value: capitals, start, end, direction: selectionDirection ?? "none" }
            : null;
        onValueChange(capitals);
      }}
    />
  );
}
