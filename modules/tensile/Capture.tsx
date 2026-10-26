"use client";

// Physical properties capture (BUILD_SPEC 6.1, 8 "Speed"): per size the lab
// report's two averages in NumberFields (decimal keypad; Enter moves on, and
// across sizes on desktop; a pasted block of averages fills the fields in
// reading order), each with its spec and live verdict; sizes as SizeTabs on
// iPad (swipe, arrow keys) and side by side on desktop; and the lab reports,
// at least one of which this module requires, in one line: each file
// Steri-AI linked from Source Documents, "Size S · name", with Preview and
// Unlink, or what Steri-AI found (the framework's LabReports, BUILD_SPEC
// 8.1; no picker, Kenneth, 12 October 2026; one report per size, 26 October
// 2026). Wording is the template's (6.2 rule 11); verdicts are computed,
// never typed. Every write goes through useDataUpdater, from the latest
// data, so a pasted block lands whole in one change (docs/CAPTURE_KIT.md).
import { useId, useRef, useState } from "react";
import { EnterGroup, findIssue, NumberField, SizeTabs, StatusPill, useDataUpdater, useIssueFocus } from "@/components/qc";
import { fieldIssues, initialSize, labelFor, type CaptureProps } from "@/modules/_framework";
import { LabReports } from "@/modules/_framework/lab-reports";
import { useReportShownSize } from "@/modules/_framework/shown-size";
import { formatMinimum, judgeAverage, MEASURE_RULES, specCaption, type TensileOutcome } from "./calc";
import { TENSILE_MEASURES } from "./config";
import { withAverage, withoutLabReport } from "./edit";
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

  // The size chosen tags the photos taken now (BUILD_SPEC 8.1), on the desktop too, where the
  // sizes sit side by side and the one chosen is the one whose value was last in focus.
  useReportShownSize(size, onFocusChange);

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
      {/* Required: until one is attached the module is not done, and its not-done link lands on this line.
          calc's warning sits under it for each kept file that is gone. */}
      <LabReports
        moduleKey="tensile"
        label={labelFor(labels, "labReport")}
        reports={data.labReports}
        context={context}
        required
        warnings={(evaluation?.issues ?? []).filter((issue) => issue.code === "lab_report_missing").map((issue) => issue.message)}
        readOnly={readOnly}
        onRemoved={(fileId) => update((current) => withoutLabReport(current, fileId))}
      />
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
