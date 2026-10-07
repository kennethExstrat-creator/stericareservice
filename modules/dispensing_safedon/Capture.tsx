"use client";

// Glove Dispensing Inspection capture (BUILD_SPEC 6.1, 8 "Speed"): one size
// at a time (swipe on iPad, arrow keys on desktop). Each box column takes its
// box number from the size's carton list (6.2 rule 7); its defects are
// counted by tapping, never typed. On iPad the counts show one box at a time,
// stepped through with Previous and Next or by tapping the box's column
// number; from 1280 px every box sits side by side, as on the sheet. The per
// box "1/125" and rate, the size total "3 / 625 (0.48%)" and its result
// against the maximum come from calc as you tap (rule 2). A box that is not
// in the carton list, and any other problem calc finds in a box, is listed
// under the box pickers with a link to it: the picker itself only turns red.
// Every write goes through useDataUpdater, starting from the latest data, so
// taps faster than the screen renders all count (docs/CAPTURE_KIT.md).
import { useRef, useState, type RefObject } from "react";
import { PlusIcon } from "lucide-react";
import {
  BoxPicker,
  ColumnSwitcher,
  CounterTable,
  focusIssuePath,
  issuePathProps,
  ModuleSection,
  RequirementList,
  SizeTabs,
  StatusIcon,
  useDataUpdater,
  useIssueFocus,
  type DataChange,
} from "@/components/qc";
import { Button } from "@/components/ui/button";
import { formatRatio, formatRatioDecimal, formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cartonsFor, initialSize, labelFor, type CaptureProps, type ValidationIssue } from "@/modules/_framework";
import { sizeOnTabs, useReportShownSize } from "@/modules/_framework/shown-size";
import type { DispensingSafedonComputed, DispensingSafedonConfig, DispensingSafedonData } from ".";
import { plannedBoxes, safedonHeading } from "./calc";
import { MAX_BOXES_PER_SIZE } from "./config";
import { boxesOf, columnsShown, setSafedonBoxNo, setSafedonCount } from "./edit";
import { formatSizeRate } from "./text";

type Props = CaptureProps<DispensingSafedonData, DispensingSafedonConfig, DispensingSafedonComputed>;
type Update = (change: DataChange<DispensingSafedonData>) => void;

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
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const update = useDataUpdater(data, onChange);
  // Opens on the size chosen in the last module; SizeTabs corrects a size that is not (or no longer) ordered.
  const [size, setSize] = useState(() => initialSize(context, focus));
  // The size on the tabs tags the photos taken now (BUILD_SPEC 8.1), from the moment the section opens.
  useReportShownSize(sizeOnTabs(context.sizes, size), onFocusChange);
  // The box column being counted, per size (the one shown on iPad).
  const [active, setActive] = useState<Record<string, number>>({});
  // Columns asked for with "Add Box", per size, beyond the plan.
  const [requested, setRequested] = useState<Record<string, number>>({});

  useIssueFocus(focusPath, {
    root,
    reveal: (path) => {
      const target = path[1];
      if (path[0] !== "sizes" || typeof target !== "string" || !context.sizes.includes(target)) return;
      setSize(target);
      const column = path[3];
      if (path[2] === "boxes" && typeof column === "number") setActive((current) => ({ ...current, [target]: column }));
    },
  });

  const selectSize = (next: string) => {
    setSize(next);
    onFocusChange?.({ size: next });
  };

  return (
    <div ref={root} className="min-w-0 space-y-4">
      <p className="text-sm text-muted-foreground touch:text-base">
        {safedonHeading(labels, evaluation?.computed.codeLetters ?? [])}
      </p>
      <SizeTabs
        sizes={context.sizes}
        templateSizes={context.templateSizes}
        value={size}
        onValueChange={selectSize}
        results={evaluation?.result.perSize}
        label={`${title}: sizes`}
      >
        {(shown) => (
          <SafedonSizePanel
            size={shown}
            props={{ data, config, title, labels, context, evaluation, readOnly, onFocusChange }}
            update={update}
            active={active[shown] ?? 0}
            onActive={(column) => setActive((current) => ({ ...current, [shown]: column }))}
            requested={requested[shown] ?? 0}
            onRequest={(columns) => setRequested((current) => ({ ...current, [shown]: columns }))}
          />
        )}
      </SizeTabs>
    </div>
  );
}

type PanelProps = {
  size: string;
  props: Pick<Props, "data" | "config" | "title" | "labels" | "context" | "evaluation" | "readOnly" | "onFocusChange">;
  update: Update;
  active: number;
  onActive: (column: number) => void;
  requested: number;
  onRequest: (columns: number) => void;
};

function SafedonSizePanel({ size, props, update, active, onActive, requested, onRequest }: PanelProps) {
  const { data, config, title, labels, context, evaluation, readOnly, onFocusChange } = props;
  const boxes = boxesOf(data, size);
  const planned = plannedBoxes(context, config, size);
  const columns = columnsShown(planned, boxes.length, requested);
  // The column counted on iPad: the one asked for, within the columns shown.
  const counted = Math.min(Math.max(active, 0), Math.max(columns - 1, 0));
  const cartons = cartonsFor(context, size);
  const used = boxes.map((box) => box.boxNo);
  // A module whose config or data is broken comes back with no computed values.
  const computed = evaluation?.computed.sizes?.[size];
  const result = evaluation?.result.perSize?.[size];
  const sizeName = formatSize(size, { sizes: context.templateSizes, prefix: true });
  // Inside the picker's sentences: "Box 2336 is not in the carton list for size M."
  const pickerSize = `size ${formatSize(size, { sizes: context.templateSizes })}`;
  const boxLabel = labelFor(labels, "boxNo");
  // calc's problems in this size's boxes, such as a box missing from the carton list (6.2 rule 7).
  const issues = boxIssues(evaluation?.issues ?? [], size);
  const panel = useRef<HTMLDivElement>(null);
  const indices = Array.from({ length: columns }, (_, index) => index);
  const boxNoAt = (index: number) => boxes[index]?.boxNo ?? null;
  // A column without a box number yet shows its place in brackets, never a number that reads as a box.
  const columnLabel = (index: number) => {
    const boxNo = boxNoAt(index);
    return boxNo === null ? `(${index + 1})` : String(boxNo);
  };
  const tag = (index: number, defect?: string) => {
    const boxNo = boxNoAt(index);
    onFocusChange?.({ size, ...(boxNo === null ? {} : { box: boxNo }), ...(defect === undefined ? {} : { defect }) });
  };
  const select = (index: number) => {
    onActive(index);
    tag(index);
  };

  return (
    <div ref={panel} className="min-w-0 space-y-5">
      {planned === 0 && (
        <p className="rounded-lg border border-dashed border-not-done-border bg-not-done-tint px-4 py-3 text-sm text-not-done touch:text-base">
          {result?.summary}
        </p>
      )}

      <ModuleSection
        title={boxLabel}
        actions={
          !readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="border border-dashed border-input"
              disabled={columns >= MAX_BOXES_PER_SIZE}
              onClick={() => {
                onRequest(columns + 1);
                onActive(columns);
              }}
            >
              <PlusIcon aria-hidden />
              Add Box
            </Button>
          )
        }
      >
        <ol
          aria-label={`${boxLabel}, ${sizeName}`}
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7"
        >
          {indices.map((index) => (
            <li
              key={index}
              data-active={index === counted || undefined}
              // A link to anything about this box without a cell of its own (a count under a
              // defect the template does not list) lands here.
              {...issuePathProps(["sizes", size, "boxes", index])}
              className="flex min-w-0 items-center gap-1 rounded-lg border border-border bg-card p-1 data-active:border-primary data-active:bg-brand-50"
            >
              {/* Outset focus ring, as SizeTabs' filled tab: the pressed button is brand-500,
                  where an inset brand-500 ring would vanish. The item's 4 px padding holds it. */}
              <button
                type="button"
                aria-pressed={index === counted}
                aria-label={`Count column ${index + 1}`}
                onClick={() => select(index)}
                className="inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-md px-1 text-sm font-semibold text-muted-foreground tabular-nums outline-none hover:bg-accent focus-ring aria-pressed:bg-primary aria-pressed:text-primary-foreground touch:h-11 touch:min-w-11 touch:text-base"
              >
                {index + 1}
              </button>
              <BoxPicker
                variant="cell"
                className="min-w-0 flex-1"
                label={`${boxLabel}, column ${index + 1}`}
                sizeLabel={pickerSize}
                value={boxNoAt(index)}
                cartons={cartons}
                used={used}
                onValueChange={(boxNo) => {
                  update((current) => setSafedonBoxNo(current, size, index, boxNo));
                  onActive(index);
                  onFocusChange?.({ size, ...(boxNo === null ? {} : { box: boxNo }) });
                }}
                onFocus={() => select(index)}
                issuePath={["sizes", size, "boxes", index, "boxNo"]}
                readOnly={readOnly}
              />
            </li>
          ))}
        </ol>
        <IssueLinks issues={issues} root={panel} />
      </ModuleSection>

      <ModuleSection
        title={labelFor(labels, "counts")}
        actions={
          columns > 1 && (
            <ColumnSwitcher
              count={columns}
              index={counted}
              onIndexChange={select}
              current={`${boxLabel} ${columnLabel(counted)}`}
              previousLabel="Previous box"
              nextLabel="Next box"
            />
          )
        }
      >
        <CounterTable
          caption={`${labelFor(labels, "counts")}, ${sizeName}`}
          rows={config.defects.map((defect) => ({
            key: defect.code,
            label: defect.label,
            ...(defect.hint.trim() === "" ? {} : { hint: defect.hint }),
          }))}
          columns={indices.map((index) => {
            const boxNo = boxNoAt(index);
            return {
              key: String(index),
              label: columnLabel(index),
              name: boxNo === null ? `column ${index + 1}` : `box ${boxNo}`,
            };
          })}
          activeColumn={String(counted)}
          getCount={({ row, column }) => boxes[Number(column)]?.counts[row] ?? 0}
          onCountChange={({ row, column }, count) =>
            update((current) => setSafedonCount(current, size, Number(column), row, count))
          }
          labels={{ rowHeader: boxLabel, total: labelFor(labels, "totalGroup") }}
          summaryRows={[
            {
              key: "perPack",
              label: labelFor(labels, "boxDefects"),
              render: (_, total) => formatRatio(total, config.glovesPerPack),
            },
            {
              key: "rate",
              label: labelFor(labels, "boxRatePct"),
              render: (_, total) => formatRatioDecimal(total, config.glovesPerPack),
            },
          ]}
          onCellFocus={({ column, row }) => {
            onActive(Number(column));
            tag(Number(column), row);
          }}
          cellIssuePath={({ column, row }) => ["sizes", size, "boxes", Number(column), "counts", row]}
          readOnly={readOnly}
        />
      </ModuleSection>

      {result?.status === "not_done" && planned > 0 && (
        <p className="text-sm text-muted-foreground touch:text-base">{result.summary}</p>
      )}

      <RequirementList
        caption={`${title}, ${sizeName}`}
        labels={{
          value: labelFor(labels, "totalGroup"),
          spec: labelFor(labels, "specRow"),
          result: labelFor(labels, "result"),
        }}
        items={[
          {
            key: "rate",
            label: labelFor(labels, "ratePct"),
            value: computed?.ratePct ?? null,
            valueText:
              computed && computed.boxesTested > 0
                ? formatSizeRate(computed.totalDefects, computed.glovesInspected)
                : undefined,
            unit: "%",
            spec: { kind: "max", max: config.maxRatePct },
            status: computed?.result ?? "not_done",
            note: computed
              ? `${labelFor(labels, "boxesTested")}: ${computed.boxesTested} / ${computed.boxesExpected}`
              : undefined,
            issuePath: ["sizes", size],
          },
        ]}
      />
    </div>
  );
}

/** calc's issues about a size's boxes (`["sizes", size, "boxes", ...]`), in column order. */
function boxIssues(issues: readonly ValidationIssue[], size: string): ValidationIssue[] {
  return issues.filter((issue) => issue.path[0] === "sizes" && issue.path[1] === size && issue.path[2] === "boxes");
}

/**
 * calc's problems in the boxes, each with a link to its box (BUILD_SPEC 6.2),
 * listed as the carton grid and labelling list their own: a picker only turns
 * red, and its message is read to screen readers alone. The size's Passed or
 * Failed stays calc's: a box missing from the carton list blocks submit, it
 * does not change the rate.
 */
function IssueLinks({ issues, root }: { issues: readonly ValidationIssue[]; root: RefObject<HTMLElement | null> }) {
  if (issues.length === 0) return null;
  return (
    <ul data-slot="box-issues" className="space-y-1">
      {issues.map((issue) => (
        <li key={`${issue.code}-${issue.path.join("/")}`}>
          <button
            type="button"
            onClick={() => root.current && focusIssuePath(root.current, issue.path)}
            className={cn(
              "flex w-full items-start gap-1.5 rounded-sm text-left text-sm focus-ring-inset touch:min-h-11 touch:text-base",
              issue.level === "error" ? "text-fail" : "text-warn",
            )}
          >
            <StatusIcon status={issue.level === "error" ? "fail" : "warn"} className="mt-0.5 size-4 shrink-0" />
            <span>{issue.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
