"use client";

// Physical properties capture (BUILD_SPEC 6.1, 8 "Speed"): per size the lab
// report's two averages in NumberFields (decimal keypad; Enter moves on, and
// across sizes on desktop; a pasted block of averages fills the fields in
// reading order), each with its spec and live verdict; sizes as SizeTabs on
// iPad (swipe, arrow keys) and side by side on desktop; and the lab report,
// which this module requires: whether it is attached, and the screen's file
// slot to attach it (the framework's file channel, BUILD_SPEC 8.1). Wording
// is the template's (6.2 rule 11); verdicts are computed, never typed. Every
// write goes through useDataUpdater, from the latest data, so a pasted block
// lands whole in one change (docs/CAPTURE_KIT.md).
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { FileCheckIcon, FileTextIcon, FileXIcon } from "lucide-react";
import {
  EnterGroup,
  findIssue,
  issuePathProps,
  NumberField,
  SizeTabs,
  StatusPill,
  useDataUpdater,
  useIssueFocus,
} from "@/components/qc";
// The kit's touch size for small pills; not exported from @/components/qc yet.
import { SMALL_PILL_TOUCH } from "@/components/qc/status-pill";
import { fieldIssues, initialSize, labelFor, type CaptureProps, type HeldFileState } from "@/modules/_framework";
import { ModuleFileSlot } from "@/modules/_framework/file-slot";
import { formatMinimum, judgeAverage, labReportState, MEASURE_RULES, specCaption, type TensileOutcome } from "./calc";
import { TENSILE_MEASURES } from "./config";
import { withAverage, withLabReport, withoutLabReport } from "./edit";
import type { TensileComputed, TensileConfig, TensileData } from ".";

export default function Capture({
  data,
  config,
  title,
  labels,
  context,
  evaluation,
  focusPath,
  readOnly,
  focus,
  onChange,
  onFocusChange,
}: CaptureProps<TensileData, TensileConfig, TensileComputed>) {
  const root = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const update = useDataUpdater(data, onChange);
  const [selected, setSelected] = useState(() => initialSize(context, focus));
  // A size taken out of the order falls back to the first one ordered.
  const size = context.sizes.includes(selected) ? selected : (context.sizes[0] ?? "");

  // The size on screen tags the photos taken now (BUILD_SPEC 8.1).
  const reportSize = useEffectEvent((shown: string) => onFocusChange?.({ size: shown }));
  useEffect(() => {
    if (size !== "") reportSize(size);
  }, [size]);

  useIssueFocus(focusPath, {
    root,
    reveal: (path) => {
      if (path[0] === "sizes" && typeof path[1] === "string" && context.sizes.includes(path[1])) setSelected(path[1]);
    },
  });

  const caption = specCaption(labelFor(labels, "specRow"), config.standardLabel);

  return (
    // relative: screen-reader text inside never lays out against the page (docs/DESIGN.md).
    <div ref={root} data-slot="tensile" className="relative space-y-4">
      <section
        data-slot="lab-report"
        {...issuePathProps(["labReport"])}
        aria-label={labelFor(labels, "labReport")}
        className="relative space-y-3 rounded-lg border border-border bg-card px-3 py-2.5"
      >
        <LabReportStatus
          label={labelFor(labels, "labReport")}
          state={labReportState(context, data.labReport)}
          message={evaluation?.issues.find((issue) => issue.code === "lab_report_missing")?.message}
        />
        <ModuleFileSlot
          moduleKey="tensile"
          kind="lab_report"
          focus={size === "" ? null : { size }}
          readOnly={readOnly}
          onAdded={(file) => update((current) => withLabReport(current, file.id))}
          onRemoved={(fileId) => update((current) => withoutLabReport(current, fileId))}
        />
      </section>
      {/* One run for Enter and paste: one size's two fields on iPad, every size in reading order on desktop. */}
      <EnterGroup>
        <SizeTabs
          sizes={context.sizes}
          templateSizes={context.templateSizes}
          value={size}
          onValueChange={setSelected}
          results={evaluation?.result.perSize}
          wide="all"
          label={`${title}: sizes`}
        >
          {(shown) => (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              {TENSILE_MEASURES.map((measure) => {
                const value = data.sizes[shown]?.[measure] ?? null;
                const path = ["sizes", shown, measure];
                // calc's own rule on the value on screen: live as it is typed, never behind an evaluation.
                const outcome = judgeAverage(value, config, measure);
                return (
                  <NumberField
                    key={measure}
                    id={`${baseId}-${shown}-${measure}`}
                    label={labelFor(labels, measure)}
                    unit={MEASURE_RULES[measure].unit}
                    decimals={config.decimals[measure]}
                    min={0}
                    value={value}
                    onValueChange={(next) => update((current) => withAverage(current, shown, measure, next))}
                    hint={<SpecHint caption={caption} minimum={formatMinimum(config, measure)} outcome={outcome} />}
                    error={findIssue(fieldIssues(evaluation?.issues), path)?.message}
                    issuePath={path}
                    onFocus={() => {
                      setSelected(shown);
                      onFocusChange?.({ size: shown });
                    }}
                    readOnly={readOnly}
                  />
                );
              })}
            </div>
          )}
        </SizeTabs>
      </EnterGroup>
    </div>
  );
}

/**
 * Whether the lab report is attached; it is required, so until it is the
 * module is not done. The file slot below it attaches the file and the
 * module keeps its id (edit.ts withLabReport); one added in the gallery
 * counts once the inspection's files are known, and a kept file they do not
 * hold is missing, with calc's message.
 */
function LabReportStatus({ label, state, message }: { label: string; state: HeldFileState; message?: string }) {
  const attached = state === "attached";
  const Icon = attached ? FileCheckIcon : state === "missing" ? FileXIcon : FileTextIcon;
  return (
    <div
      data-attached={attached || undefined}
      data-state={state}
      className="relative flex flex-wrap items-center gap-x-3 gap-y-1 text-sm touch:text-base"
    >
      <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      <span className="font-medium text-foreground">{label}</span>
      {attached ? (
        <span className="text-foreground">Attached</span>
      ) : (
        <>
          <StatusPill size="sm" status="not_done" label="Not attached" className={SMALL_PILL_TOUCH} />
          <span className={state === "missing" ? "text-warn" : "text-muted-foreground"}>
            {message ?? "Required before this section is done."}
          </span>
        </>
      )}
    </div>
  );
}

/** "Spec. (ASTM D6319) ≥ 14.00 MPa" and the verdict, read with the field. */
function SpecHint({ caption, minimum, outcome }: { caption: string; minimum: string; outcome: TensileOutcome }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="tabular-nums">
        {caption} {minimum}
      </span>
      <StatusPill size="sm" status={outcome} className={SMALL_PILL_TOUCH} />
    </span>
  );
}
