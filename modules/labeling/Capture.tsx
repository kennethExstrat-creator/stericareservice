"use client";

// Packaging labelling on the capture screen: a tab per ordered size, the
// levels the template inspects side by side from 1280 px. Per level: the
// boxes inspected (one tap records the planned n, then a stepper), the
// cartons they came from (optional, picked from the size's carton list), and
// a counter per check with the live total and the Accept 0 / Reject 1 chip.
// Every edit goes through useDataUpdater (docs/CAPTURE_KIT.md), built from
// the latest data, so edits in one event never undo each other.
import { useLayoutEffect, useRef, useState } from "react";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  BoxPicker,
  CounterTable,
  findIssue,
  issuePathProps,
  ModuleSection,
  SizeTabs,
  Stepper,
  useDataUpdater,
  useIssueFocus,
  type DataChange,
} from "@/components/qc";
import { STATUS_LABEL } from "@/lib/design/status";
import { formatSize } from "@/lib/format";
import { cartonsFor, initialSize, labelFor, type CaptureProps } from "@/modules/_framework";
import type { LabelingComputed, LabelingConfig, LabelingData } from ".";
import { checkLabel, includedLevels, levelFieldLabel, levelLabel } from "./calc";
import type { LabelingCheck, LabelingLevel } from "./config";
import { boxPickers, levelEntry, withAddedBox, withBox, withDefectCount, withInspected } from "./edit";

type Props = CaptureProps<LabelingData, LabelingConfig, LabelingComputed>;

type LevelPanelProps = Omit<Props, "onChange" | "focusPath"> & {
  /** Applies an edit to the latest data (useDataUpdater). */
  update: (change: DataChange<LabelingData>) => void;
  size: string;
  level: LabelingLevel;
};

/** Most boxes the stepper counts to. */
const MAX_INSPECTED = 999;

export default function Capture({ onChange, focusPath, ...props }: Props) {
  const { data, config, context, evaluation, onFocusChange } = props;
  const update = useDataUpdater(data, onChange);
  const root = useRef<HTMLDivElement>(null);
  // Opens on the size chosen in the last module; SizeTabs corrects a size that is not (or no longer) ordered.
  const [size, setSize] = useState(() => initialSize(context, props.focus));
  const levels = includedLevels(config);

  useIssueFocus(focusPath, {
    root,
    reveal: (path) => {
      // size_not_ordered and size_duplicate point at sizes that are not on screen: stay put.
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
          {(shown) => (
            <div className="grid min-w-0 gap-x-8 gap-y-6 xl:grid-cols-2">
              {levels.map((level) => (
                <LevelPanel key={level} {...props} update={update} size={shown} level={level} />
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
  onFocusChange,
  update,
  size,
  level,
}: LevelPanelProps) {
  const levelConfig = config.levels[level];
  const entry = levelEntry(data, size, level);
  const computed = evaluation?.computed.sizes?.[size]?.[level];
  const name = levelLabel(labels, level);
  const sizeText = `size ${formatSize(size, { sizes: context.templateSizes })}`;
  const where = `${name}, ${sizeText}`;
  const path = ["sizes", size, level];
  const issues = evaluation?.issues ?? [];
  const inspectedIssue = findIssue(issues, [...path, "inspected"]);
  // Every box problem, a box missing from the carton list included, is listed under the pickers.
  const boxIssues = issues.filter(
    (issue) =>
      issue.path.length >= 4 &&
      path.every((segment, index) => issue.path[index] === segment) &&
      issue.path[3] === "boxNos",
  );
  const cartons = cartonsFor(context, size);
  const pickers = boxPickers(entry, levelConfig.n, readOnly);
  const boxLabel = labelFor(labels, "boxNos");
  const inspectedLabel = labelFor(labels, "inspected");
  const countRow = useRef<HTMLDivElement>(null);
  // The size whose Record button had keyboard focus: the stepper that replaces the button takes it over.
  const focusStepper = useRef<string | null>(null);

  useLayoutEffect(() => {
    const pending = focusStepper.current;
    if (pending === null) return;
    if (pending !== size) {
      focusStepper.current = null;
      return;
    }
    if (entry.inspected === null) return;
    focusStepper.current = null;
    countRow.current?.querySelector<HTMLElement>('[role="spinbutton"]')?.focus();
  });

  return (
    <ModuleSection title={name} issuePath={path} className="xl:border-t-0 xl:pt-0">
      <div className="space-y-1.5">
        <div
          ref={countRow}
          // The label over the counter table's label column and the count over its count column, side by side.
          className="grid grid-cols-[minmax(0,16rem)_8rem] items-center touch:grid-cols-[minmax(0,16rem)_10rem]"
          onFocus={() => onFocusChange?.({ size, level })}
          {...issuePathProps([...path, "inspected"])}
        >
          <div className="min-w-0 pr-3">
            <span className="block text-sm font-medium text-foreground touch:text-base">{inspectedLabel}</span>
            <span className="block text-sm text-muted-foreground touch:text-base">Plan {levelConfig.n}</span>
          </div>
          <div className="flex justify-center">
            {readOnly ? (
              <span className="text-base font-semibold tabular-nums">{entry.inspected ?? "—"}</span>
            ) : entry.inspected === null ? (
              <Button
                type="button"
                variant="outline"
                aria-label={`Record ${levelConfig.n} ${levelConfig.n === 1 ? "box" : "boxes"} inspected: ${where}`}
                onClick={(event) => {
                  if (event.currentTarget === document.activeElement) focusStepper.current = size;
                  update((current) => withInspected(current, size, level, levelConfig.n));
                }}
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
                onValueChange={(next) => update((current) => withInspected(current, size, level, next))}
              />
            )}
          </div>
        </div>
        {inspectedIssue && (
          <p className={cn("text-sm touch:text-base", inspectedIssue.level === "error" ? "text-fail" : "text-warn")}>
            {inspectedIssue.message}
          </p>
        )}
      </div>

      {pickers.length > 0 && (
        <div className="space-y-1.5" {...issuePathProps([...path, "boxNos"])}>
          <span className="block text-sm font-medium text-foreground touch:text-base">{boxLabel}</span>
          <div className="flex flex-wrap items-start gap-2">
            {pickers.map((box, index) => (
              <BoxPicker
                // By position, so the picker a box was picked in or cleared from stays and gets the focus back.
                key={index}
                // Its own error text would wrap in this narrow column: the problems are listed
                // full width below, and the text stays for screen readers.
                className="relative w-32 space-y-0 [&>p]:sr-only"
                value={box}
                cartons={cartons}
                used={entry.boxNos}
                label={`${boxLabel} ${index + 1}, ${where}`}
                sizeLabel={sizeText}
                onValueChange={(next) => {
                  if (box !== null) update((current) => withBox(current, size, level, index, next));
                  else if (next !== null) update((current) => withAddedBox(current, size, level, next));
                }}
                onFocus={() => onFocusChange?.(box === null ? { size, level } : { size, level, box })}
                issuePath={box === null ? undefined : [...path, "boxNos", index]}
                readOnly={readOnly}
              />
            ))}
          </div>
          {boxIssues.map((issue) => (
            <p
              key={`${issue.code}:${issue.path.join("/")}`}
              className={cn("text-sm touch:text-base", issue.level === "error" ? "text-fail" : "text-warn")}
            >
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
            // Calc's Ac / Re (lib/aql's labelling plan) and its result for this level: the table's own.
            limits: computed ? { ac: computed.accept, re: computed.reject } : null,
            status: computed?.result,
          },
        ]}
        getCount={({ row }) => entry.defects[row as LabelingCheck]}
        onCountChange={({ row }, count) =>
          update((current) => withDefectCount(current, size, level, row as LabelingCheck, count))
        }
        labels={{
          rowHeader: labelFor(labels, "defects"),
          limits: labelFor(labels, "defectLimit"),
          // The limit row in the template's words: "Accept 0 / Reject 1".
          limitAccept: labelFor(labels, level, "accept"),
          limitReject: labelFor(labels, level, "reject"),
          total: labelFor(labels, "total"),
          result: levelFieldLabel(labels, level, "result"),
          // The words the disposition row prints: Passed / Failed.
          accept: STATUS_LABEL.pass,
          reject: STATUS_LABEL.fail,
        }}
        onCellFocus={({ row }) => onFocusChange?.({ size, level, defect: row })}
        cellIssuePath={({ row }) => [...path, "defects", row]}
        readOnly={readOnly}
      />
    </ModuleSection>
  );
}
