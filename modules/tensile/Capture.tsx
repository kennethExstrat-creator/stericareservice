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
import {
  AttachmentStatus,
  EnterGroup,
  findIssue,
  issueNoticeProps,
  issuePathProps,
  NumberField,
  SizeTabs,
  StatusIcon,
  StatusPill,
  useDataUpdater,
  useIssueFocus,
} from "@/components/qc";
import { fieldIssues, initialSize, labelFor, type CaptureProps } from "@/modules/_framework";
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
  const reportLabel = labelFor(labels, "labReport");
  const reportState = labReportState(context, data.labReport);
  const missing = evaluation?.issues.find((issue) => issue.code === "lab_report_missing");

  return (
    // relative: screen-reader text inside never lays out against the page (docs/DESIGN.md).
    <div ref={root} data-slot="tensile" className="relative space-y-4">
      {/* Required: until it is attached the module is not done, and its not-done link lands here. */}
      <section
        data-slot="lab-report"
        data-state={reportState}
        {...issuePathProps(["labReport"])}
        aria-label={reportLabel}
        className="relative space-y-3"
      >
        <AttachmentStatus label={reportLabel} attached={reportState === "attached"} required />
        {missing && (
          <p
            {...issueNoticeProps(missing.path)}
            className="flex items-start gap-1.5 rounded-sm text-sm text-warn outline-none focus-ring touch:text-base"
          >
            <StatusIcon status="warn" className="mt-0.5 size-4 shrink-0 touch:mt-1" />
            <span>{missing.message}</span>
          </p>
        )}
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

/** "Spec. (ASTM D6319) ≥ 14.00 MPa" and the verdict, read with the field. */
function SpecHint({ caption, minimum, outcome }: { caption: string; minimum: string; outcome: TensileOutcome }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="tabular-nums">
        {caption} {minimum}
      </span>
      <StatusPill size="sm" status={outcome} />
    </span>
  );
}
