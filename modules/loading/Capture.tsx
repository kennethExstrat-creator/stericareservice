"use client";

// Loading capture (BUILD_SPEC 6.1 loading): the fields the template switches
// on, with the cartons loaded next to the order's total cartons, which flow
// forward from order_lots and are never typed (6.2 rule 2). The loading
// stage picked here is reported as the focus, so the photos taken at each
// stage are tagged with it (BUILD_SPEC 8.1).
import { useId, useRef, useState } from "react";
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
  useIssueFocus,
} from "@/components/qc";
import { formatCount } from "@/lib/format";
import { labelFor, type CaptureFocus, type CaptureProps } from "@/modules/_framework";
import { cartonsOrdered, type LoadingComputed } from "./calc";
import { LOADING_STAGES, type LoadingConfig, type LoadingStage } from "./config";
import type { LoadingData } from "./schema";

/**
 * The focus for photo tags. CaptureFocus has no slot yet for an entry of a
 * module's own list, so `item` rides along until the framework and
 * lib/photos take it (handed over as a follow-up).
 */
type ItemFocus = CaptureFocus & { readonly item: string };

function stageFocus(stage: LoadingStage): CaptureFocus {
  const focus: ItemFocus = { item: stage };
  return focus;
}

const isStage = (value: string): value is LoadingStage => (LOADING_STAGES as readonly string[]).includes(value);

/** An emptied field is not entered; calc reads blank text the same way. */
const textOrNull = (value: string) => (value === "" ? null : value);

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
  const uid = useId();
  const root = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<LoadingStage | null>(null);
  useIssueFocus(focusPath, { root });

  const { fields } = config;
  const anyField = fields.containerNo || fields.sealNo || fields.cartonsLoaded || fields.cartonCondition;
  const ordered = evaluation?.computed.cartonsOrdered ?? cartonsOrdered(context);
  const set = (values: Partial<LoadingData>) => onChange({ ...data, ...values });
  const containerIssue = findIssue(evaluation?.issues, ["containerNo"]);
  const quantityIssue = findIssue(evaluation?.issues, ["cartonsLoaded"]);
  const pickStage = (value: string) => {
    const next = isStage(value) ? value : null;
    setStage(next);
    if (next) onFocusChange?.(stageFocus(next));
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
              <Input
                id={`${uid}-container`}
                value={data.containerNo ?? ""}
                // Container numbers are painted in capitals; storing them so keeps the export clean.
                onChange={(event) => set({ containerNo: textOrNull(event.target.value.toUpperCase()) })}
                readOnly={readOnly}
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby={containerIssue ? `${uid}-container-issue` : undefined}
                className={cn("tabular-nums", containerIssue && "border-warn-solid")}
              />
              {containerIssue && (
                <p id={`${uid}-container-issue`} className="text-sm text-warn touch:text-base">
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
                hint={
                  <span className="inline-flex flex-wrap gap-x-1.5">
                    {labelFor(labels, "cartonsOrdered")}:
                    <Figure value={ordered} grouping className="font-semibold text-foreground" />
                  </span>
                }
                readOnly={readOnly}
              />
              {quantityIssue && <p className="text-sm text-warn touch:text-base">{quantityIssue.message}</p>}
              {!readOnly && data.cartonsLoaded === null && ordered !== null && (
                <Button type="button" variant="outline" size="sm" onClick={() => set({ cartonsLoaded: ordered })}>
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
        <ModuleSection
          title={labelFor(labels, "loadingStage")}
          description={
            stage
              ? `Photos taken now are tagged “${labelFor(labels, stage)}”.`
              : "Pick the stage before taking its photos, so each photo is tagged with it."
          }
        >
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
                className="rounded-full px-4 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
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
