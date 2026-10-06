"use client";

// Visual inspection (BUILD_SPEC 6.1; 8 "Speed"): one section per defect class
// the template switches on (critical, major, minor), each with the gloves
// inspected per ordered size, offered from the sampling plan, and the
// defects counted by tapping in the template's order and wording; R and L
// sub-columns when the template splits hands. Code letters, limits, totals
// and the accept/reject chips are calc's (6.2 rule 2) and follow every tap.
// A class stays not done for a size until its gloves inspected are entered:
// the inspector's word that the size was inspected (6.2 rule 5).
import { useRef, useState } from "react";
import {
  CounterTable,
  EnterGroup,
  findIssue,
  HandToggle,
  handsOf,
  issuePathProps,
  ModuleSection,
  NumberField,
  SizeTabs,
  useIssueFocus,
  type CounterCell,
  type CounterColumn,
  type CounterRow,
  type HandView,
  type IssuePath,
} from "@/components/qc";
import { Button } from "@/components/ui/button";
import { STATUS_LABEL } from "@/lib/design/status";
import { formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { HANDS, labelFor, samplingFor, type CaptureProps, type Hand } from "@/modules/_framework";
import type { VisualComputed, VisualConfig, VisualData } from ".";
import { classLabel, effectiveClasses } from "./calc";
import {
  addOneOff,
  fillInspected,
  oneOffLabels,
  oneOffRowKey,
  readCount,
  readOneOff,
  setCount,
  setInspected,
  setOneOff,
  unlistedCodes,
  type DefectCell,
} from "./edit";
import { DEFECT_CLASSES, type DefectClass } from "./schema";

type Props = CaptureProps<VisualData, VisualConfig, VisualComputed>;

export default function VisualCapture({
  data,
  config,
  labels,
  context,
  evaluation,
  focusPath,
  readOnly,
  onChange,
  onFocusChange,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const sizes = context.sizes;
  const [chosen, setChosen] = useState(sizes[0] ?? "");
  const size = sizes.includes(chosen) ? chosen : (sizes[0] ?? "");
  const split = config.handSplit;
  const [view, setView] = useState<HandView>("both");
  const shownHands: Hand[] = split ? handsOf(view) : [];

  useIssueFocus(focusPath, {
    root,
    reveal: (path) => {
      const [first, target, hand] = path;
      if (first !== "sizes" || typeof target !== "string" || !sizes.includes(target)) return;
      setChosen(target);
      if ((hand === "R" || hand === "L") && view !== "both" && view !== hand) setView(hand);
    },
  });

  const classes = effectiveClasses(config, labels, context);
  const included = DEFECT_CLASSES.filter((cls) => classes[cls].include);
  const results = evaluation?.result.perSize;
  const sizeName = (entry: string) => formatSize(entry, { sizes: context.templateSizes });

  if (included.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-not-done-border bg-not-done-tint px-4 py-3 text-sm text-not-done touch:text-base">
        No defect classes are switched on in this template.
      </p>
    );
  }

  return (
    <div ref={root} className="min-w-0">
      <SizeTabs
        sizes={sizes}
        templateSizes={context.templateSizes}
        value={size}
        onValueChange={(next) => {
          setChosen(next);
          onFocusChange?.({ size: next });
        }}
        results={results}
        wide="all"
        actions={
          split ? (
            <HandToggle
              value={view}
              allowBoth
              onValueChange={(next) => {
                setView(next);
                onFocusChange?.(next === "both" ? { size } : { size, hand: next });
              }}
            />
          ) : undefined
        }
      >
        <div className="space-y-6">
          <div className="space-y-2 text-sm text-muted-foreground touch:text-base">
            <p>
              {labelFor(labels, "codeLetter")} {evaluation?.computed.codeLetters ?? "–"}
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {sizes.map((entry) => {
                const planned = samplingFor(context, entry).watertightVisual;
                const missing = included.filter((cls) => (data.sizes[entry]?.[cls].inspected ?? null) === null);
                return (
                  // Also where an issue about the whole size points.
                  <div
                    key={entry}
                    className={cn("relative flex flex-wrap items-center gap-2", entry !== size && "max-xl:hidden")}
                    {...issuePathProps(["sizes", entry])}
                  >
                    {planned !== null && (
                      <span>
                        <span className="max-xl:sr-only">Size {sizeName(entry)}: </span>Sampling plan: {planned}
                      </span>
                    )}
                    {!readOnly && planned !== null && missing.length > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onChange(fillInspected(data, entry, missing, planned))}
                      >
                        Use {planned} for every class
                        <span className="sr-only"> of size {sizeName(entry)}</span>
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {included.map((cls) => (
            <ClassSection
              key={cls}
              cls={cls}
              heading={classes[cls].heading}
              defects={classes[cls].defects}
              data={data}
              labels={labels}
              context={context}
              evaluation={evaluation}
              readOnly={readOnly}
              onChange={onChange}
              onFocusChange={onFocusChange}
              size={size}
              split={split}
              shownHands={shownHands}
            />
          ))}
        </div>
      </SizeTabs>
    </div>
  );
}

type SectionProps = Pick<Props, "data" | "labels" | "context" | "evaluation" | "readOnly" | "onChange" | "onFocusChange"> & {
  cls: DefectClass;
  heading: string;
  defects: VisualComputed["classes"]["major"]["defects"];
  /** The size on the tab: the only column below 1280 px. */
  size: string;
  split: boolean;
  shownHands: Hand[];
};

/** One defect class: its gloves inspected per size, then its defects counted by tapping. */
function ClassSection({
  cls,
  heading,
  defects,
  data,
  labels,
  context,
  evaluation,
  readOnly,
  onChange,
  onFocusChange,
  size,
  split,
  shownHands,
}: SectionProps) {
  const sizes = context.sizes;
  const listed = new Set(defects.map((defect) => defect.code));
  const oneOffs = oneOffLabels(data, sizes, cls, split);
  const oneOffByRow = new Map(oneOffs.map((label) => [oneOffRowKey(label), label]));
  const rows: CounterRow[] = [
    ...defects.map((defect) => ({ key: defect.code, label: defect.label })),
    // Saved under a code the list lacks: calc counts them, so they show, flagged.
    ...unlistedCodes(data, sizes, cls, split, listed).map((code) => ({ key: code, label: code, unmapped: true })),
    ...oneOffs.map((label) => ({ key: oneOffRowKey(label), label, unmapped: true })),
  ];

  const computed = evaluation?.computed.sizes;
  const columns: CounterColumn[] = sizes.map((entry) => {
    const values = computed?.[entry]?.[cls];
    return {
      key: entry,
      label: formatSize(entry, { sizes: context.templateSizes }),
      name: formatSize(entry, { sizes: context.templateSizes, prefix: true }),
      n: data.sizes[entry]?.[cls].inspected ?? null,
      limits:
        values && values.accept !== null && values.reject !== null ? { ac: values.accept, re: values.reject } : null,
      status: values?.result,
    };
  });

  const cellOf = ({ column, hand }: Pick<CounterCell, "column" | "hand">): DefectCell =>
    hand ? { size: column, cls, hand } : { size: column, cls };
  const readCell = (cell: CounterCell) => {
    const label = oneOffByRow.get(cell.row);
    return label === undefined
      ? readCount(data, cellOf(cell), cell.row)
      : (readOneOff(data, cellOf(cell), label)?.entry.count ?? 0);
  };
  const writeCell = (cell: CounterCell, count: number) => {
    const label = oneOffByRow.get(cell.row);
    onChange(
      label === undefined ? setCount(data, cellOf(cell), cell.row, count) : setOneOff(data, cellOf(cell), label, count),
    );
  };
  const cellPath = (cell: CounterCell): IssuePath => {
    const base = ["sizes", cell.column, ...(cell.hand ? [cell.hand] : []), cls];
    const label = oneOffByRow.get(cell.row);
    if (label === undefined) return [...base, "counts", cell.row];
    const found = readOneOff(data, cellOf(cell), label);
    return found ? [...base, "unmapped", found.index] : [...base, "unmapped"];
  };
  const addRow = (label: string) => {
    const cell: DefectCell = split ? { size, cls, hand: shownHands[0] } : { size, cls };
    const next = addOneOff(data, cell, label, defects, sizes, split);
    if (next !== data) onChange(next);
  };
  const errorAt = (path: IssuePath) =>
    findIssue(
      evaluation?.issues.filter((issue) => issue.level === "error"),
      path,
    )?.message ?? null;
  const limitLabel = labelFor(labels, cls === "critical" ? "criticalLimit" : "defectLimit");

  return (
    <ModuleSection title={heading}>
      <EnterGroup className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
        {sizes.map((entry) => {
          const path: IssuePath = ["sizes", entry, cls, "inspected"];
          const planned = samplingFor(context, entry).watertightVisual;
          return (
            <div
              key={entry}
              className={cn("relative min-w-0", entry !== size && "max-xl:hidden")}
              {...issuePathProps(["sizes", entry, cls])}
            >
              <NumberField
                label={
                  <>
                    {labelFor(labels, "inspected")}
                    <span className="sr-only">, {classLabel(labels, cls)}</span>
                    <span className="max-xl:sr-only">, size {formatSize(entry, { sizes: context.templateSizes })}</span>
                  </>
                }
                value={data.sizes[entry]?.[cls].inspected ?? null}
                onValueChange={(inspected) => onChange(setInspected(data, entry, cls, inspected))}
                integer
                min={2}
                placeholder={planned === null ? undefined : String(planned)}
                error={errorAt(path)}
                issuePath={path}
                readOnly={readOnly}
                onFocus={() => onFocusChange?.({ size: entry })}
              />
            </div>
          );
        })}
      </EnterGroup>

      <CounterTable
        caption={heading}
        rows={rows}
        columns={columns}
        activeColumn={size}
        hands={split ? HANDS : undefined}
        visibleHands={split ? shownHands : undefined}
        getCount={readCell}
        onCountChange={writeCell}
        labels={{
          rowHeader: classLabel(labels, cls),
          inspected: labelFor(labels, "inspected"),
          limits: limitLabel,
          total: labelFor(labels, `${cls}Total`),
          result: labelFor(labels, `${cls}Result`),
          accept: STATUS_LABEL.pass,
          reject: STATUS_LABEL.fail,
        }}
        showInspected={false}
        showLimits
        showResult
        onAddRow={readOnly ? undefined : addRow}
        addRowLabel={labelFor(labels, "unmapped")}
        onCellFocus={(cell) =>
          onFocusChange?.({
            size: cell.column,
            ...(cell.hand ? { hand: cell.hand } : {}),
            ...(oneOffByRow.has(cell.row) ? {} : { defect: cell.row }),
          })
        }
        cellIssuePath={cellPath}
        readOnly={readOnly}
      />
    </ModuleSection>
  );
}
