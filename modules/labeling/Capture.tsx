"use client";

// Packaging labelling on the capture screen: a tab per ordered size, the
// levels the template inspects side by side from 1280 px. Per level: the
// boxes inspected (one tap records the planned n, then a stepper), the
// cartons they came from (optional, picked from the size's carton list), and
// a counter per check with the live total and the Accept 0 / Reject 1 chip.
import { useRef, useState } from "react";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  BoxPicker,
  CounterTable,
  findIssue,
  issuePathProps,
  ModuleSection,
  SizeTabs,
  Stepper,
  useIssueFocus,
} from "@/components/qc";
import { labelingPlan } from "@/lib/aql";
import { STATUS_LABEL } from "@/lib/design/status";
import { formatSize } from "@/lib/format";
import { cartonsFor, labelFor, type CaptureProps } from "@/modules/_framework";
import type { LabelingComputed, LabelingConfig, LabelingData } from ".";
import { checkLabel, includedLevels, levelFieldLabel, levelLabel } from "./calc";
import type { LabelingCheck, LabelingLevel } from "./config";
import { boxSlots, levelEntry, withBox, withDefectCount, withInspected } from "./edit";

type Props = CaptureProps<LabelingData, LabelingConfig, LabelingComputed>;

/** Most boxes the stepper counts to. */
const MAX_INSPECTED = 999;

export default function Capture(props: Props) {
  const { config, context, evaluation, focusPath, onFocusChange } = props;
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(context.sizes[0] ?? "");
  const levels = includedLevels(config);

  useIssueFocus(focusPath, {
    root,
    reveal: (path) => {
      if (path[0] === "sizes" && typeof path[1] === "string" && context.sizes.includes(path[1])) setSize(path[1]);
    },
  });

  const selectSize = (next: string) => {
    setSize(next);
    onFocusChange?.({ size: next });
  };

  return (
    <div ref={root} className="min-w-0">
      {levels.length === 0 ? (
        <p className="rounded-lg border border-dashed border-info-border bg-info-tint px-4 py-3 text-sm text-info touch:text-base">
          This template inspects no labelling level.
        </p>
      ) : (
        <SizeTabs
          sizes={context.sizes}
          templateSizes={context.templateSizes}
          value={size}
          onValueChange={selectSize}
          results={evaluation?.result.perSize}
        >
          {(current) => (
            <div className="grid min-w-0 gap-x-8 gap-y-6 xl:grid-cols-2">
              {levels.map((level) => (
                <LevelPanel key={level} {...props} size={current} level={level} />
              ))}
            </div>
          )}
        </SizeTabs>
      )}
    </div>
  );
}

function LevelPanel({
  data,
  config,
  title,
  labels,
  context,
  evaluation,
  readOnly,
  onChange,
  onFocusChange,
  size,
  level,
}: Props & { size: string; level: LabelingLevel }) {
  const levelConfig = config.levels[level];
  const entry = levelEntry(data, size, level);
  const computed = evaluation?.computed.sizes?.[size]?.[level];
  const name = levelLabel(labels, level);
  const sizeText = `size ${formatSize(size, { sizes: context.templateSizes })}`;
  const where = `${name}, ${sizeText}`;
  const path = ["sizes", size, level];
  const issues = evaluation?.issues ?? [];
  const inspectedIssue = findIssue(issues, [...path, "inspected"]);
  // A box missing from the carton list shows on its own picker; the others under the row.
  const boxIssues = issues.filter(
    (issue) =>
      issue.code !== "box_not_in_carton_list" &&
      issue.path.length >= 4 &&
      path.every((segment, index) => issue.path[index] === segment) &&
      issue.path[3] === "boxNos",
  );
  const cartons = cartonsFor(context, size);
  const showNextBox = !readOnly && entry.boxNos.length < boxSlots(entry, levelConfig.n);
  const boxLabel = labelFor(labels, "boxNos");
  const inspectedLabel = labelFor(labels, "inspected");

  return (
    <ModuleSection title={name} issuePath={path} className="xl:border-t-0 xl:pt-0">
      <div className="space-y-1.5">
        <div
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
          onFocus={() => onFocusChange?.({ size })}
          {...issuePathProps([...path, "inspected"])}
        >
          <div className="min-w-0">
            <span className="block text-sm font-medium text-foreground touch:text-base">{inspectedLabel}</span>
            <span className="block text-sm text-muted-foreground">Plan {levelConfig.n}</span>
          </div>
          {readOnly ? (
            <span className="text-base font-semibold tabular-nums">{entry.inspected ?? "—"}</span>
          ) : entry.inspected === null ? (
            <Button
              type="button"
              variant="outline"
              aria-label={`Record ${levelConfig.n} ${levelConfig.n === 1 ? "box" : "boxes"} inspected: ${where}`}
              onClick={() => onChange(withInspected(data, size, level, levelConfig.n))}
            >
              <CheckIcon aria-hidden />
              Record {levelConfig.n}
            </Button>
          ) : (
            <Stepper
              label={`${inspectedLabel}, ${where}`}
              value={entry.inspected}
              min={0}
              max={MAX_INSPECTED}
              onValueChange={(next) => onChange(withInspected(data, size, level, next))}
            />
          )}
        </div>
        {inspectedIssue && <p className="text-sm text-warn touch:text-base">{inspectedIssue.message}</p>}
      </div>

      {(entry.boxNos.length > 0 || showNextBox) && (
        <div className="space-y-1.5" {...issuePathProps([...path, "boxNos"])}>
          <span className="block text-sm font-medium text-foreground touch:text-base">{boxLabel}</span>
          <div className="flex flex-wrap items-start gap-2">
            {entry.boxNos.map((box, index) => (
              <BoxPicker
                key={index}
                className="w-32"
                value={box}
                cartons={cartons}
                used={entry.boxNos}
                label={`${boxLabel} ${index + 1}, ${where}`}
                sizeLabel={sizeText}
                onValueChange={(next) => onChange(withBox(data, size, level, index, next))}
                onFocus={() => onFocusChange?.({ size, box })}
                issuePath={[...path, "boxNos", index]}
                readOnly={readOnly}
              />
            ))}
            {showNextBox && (
              <BoxPicker
                key={`next-${entry.boxNos.length}`}
                className="w-32"
                value={null}
                cartons={cartons}
                used={entry.boxNos}
                label={`${boxLabel} ${entry.boxNos.length + 1}, ${where}`}
                sizeLabel={sizeText}
                onValueChange={(next) => {
                  if (next !== null) onChange(withBox(data, size, level, entry.boxNos.length, next));
                }}
                onFocus={() => onFocusChange?.({ size })}
              />
            )}
          </div>
          {boxIssues.map((issue) => (
            <p key={`${issue.code}:${issue.path.join("/")}`} className="text-sm text-fail touch:text-base">
              {issue.message}
            </p>
          ))}
        </div>
      )}

      <CounterTable
        caption={`${title}: ${where}`}
        // Its one column, so the table clips instead of scrolling sideways and the swipe turns the size.
        activeColumn={size}
        rows={levelConfig.checks.map((check) => ({ key: check.code, label: checkLabel(labels, level, check) }))}
        columns={[
          {
            key: size,
            label: formatSize(size, { sizes: context.templateSizes }),
            name: where,
            limits: computed ? { ac: computed.accept, re: computed.reject } : labelingPlan(),
            status: computed?.result,
          },
        ]}
        getCount={({ row }) => entry.defects[row as LabelingCheck]}
        onCountChange={({ row }, count) => onChange(withDefectCount(data, size, level, row as LabelingCheck, count))}
        labels={{
          rowHeader: labelFor(labels, "defects"),
          limits: labelFor(labels, "defectLimit"),
          total: labelFor(labels, "total"),
          result: levelFieldLabel(labels, level, "result"),
          accept: STATUS_LABEL.pass,
          reject: STATUS_LABEL.fail,
        }}
        onCellFocus={({ row }) => onFocusChange?.({ size, defect: row })}
        cellIssuePath={({ row }) => [...path, "defects", row]}
        readOnly={readOnly}
      />
    </ModuleSection>
  );
}
