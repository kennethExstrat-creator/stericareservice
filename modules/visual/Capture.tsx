"use client";

// Visual inspection (BUILD_SPEC 6.1; 8 "Speed"): one section per defect class
// the template switches on (critical, major, minor), each with the gloves
// inspected per ordered size, offered from the sampling plan, and the
// defects counted by tapping in the template's order and wording; R and L
// sub-columns when the template splits hands. Code letters, limits, totals
// and the accept/reject chips are calc's (6.2 rule 2) and follow every tap.
// A class stays not done for a size until its gloves inspected are entered:
// the inspector's word that the size was inspected (6.2 rule 5). Every
// change goes through useDataUpdater and starts from the latest data, so a
// pasted column or two taps in one event all land (docs/CAPTURE_KIT.md).
import { useRef, useState } from "react";
import {
  CounterTable,
  EnterGroup,
  HandToggle,
  handsOf,
  issuePathKey,
  issuePathProps,
  ModuleSection,
  NumberField,
  SideBySideText,
  SizeBlock,
  SizeTabs,
  useDataUpdater,
  useIssueFocus,
  type CounterCell,
  type CounterColumn,
  type CounterRow,
  type DataChange,
  type HandView,
  type IssuePath,
} from "@/components/qc";
import { Button } from "@/components/ui/button";
import { STATUS_LABEL } from "@/lib/design/status";
import { formatSize } from "@/lib/format";
import { HANDS, labelFor, samplingFor, type CaptureProps, type Hand, type Labels } from "@/modules/_framework";
import type { VisualComputed, VisualConfig, VisualData } from ".";
import { classLabel, effectiveClasses } from "./calc";
import {
  addOneOff,
  fillInspected,
  oneOffLabels,
  oneOffRowKey,
  readCount,
  readOneOff,
  removeOneOff,
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
  defectUsage,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const update = useDataUpdater(data, onChange);
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
      // size_not_ordered and size_duplicate point at sizes that are not on screen: stay put.
      if (first !== "sizes" || typeof target !== "string" || !sizes.includes(target)) return;
      setChosen(target);
      if (hand === "R" || hand === "L") setView((current) => (current === "both" ? current : hand));
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
        {/* One run: Enter goes from one class's gloves inspected to the next, and a pasted column fills them. */}
        <EnterGroup className="space-y-6">
          <div className="space-y-2 text-sm text-muted-foreground touch:text-base">
            <p>
              {labelFor(labels, "codeLetter")} {evaluation?.computed.codeLetters ?? "–"}
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {sizes.map((entry) => {
                const planned = samplingFor(context, entry).watertightVisual;
                const missing = included.some((cls) => (data.sizes[entry]?.[cls].inspected ?? null) === null);
                return (
                  // Also where an issue about the whole size points.
                  <SizeBlock
                    key={entry}
                    size={entry}
                    className="relative flex flex-wrap items-center gap-2"
                    {...issuePathProps(["sizes", entry])}
                  >
                    {planned !== null && (
                      <span>
                        <SideBySideText>Size {sizeName(entry)}: </SideBySideText>Sampling plan: {planned}
                      </span>
                    )}
                    {!readOnly && planned !== null && missing && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="touch:text-base"
                        onClick={() => update((current) => fillInspected(current, entry, included, planned))}
                      >
                        Use {planned} for every class
                        <span className="sr-only"> of size {sizeName(entry)}</span>
                      </Button>
                    )}
                  </SizeBlock>
                );
              })}
            </div>
          </div>

          {included.map((cls) => (
            <ClassSection
              key={cls}
              cls={cls}
              heading={classes[cls].heading}
              defects={byUsage(classes[cls].defects, defectUsage)}
              data={data}
              labels={labels}
              context={context}
              evaluation={evaluation}
              readOnly={readOnly}
              update={update}
              onFocusChange={onFocusChange}
              size={size}
              split={split}
              shownHands={shownHands}
            />
          ))}
        </EnterGroup>
      </SizeTabs>
    </div>
  );
}

/** The most-used defects first (BUILD_SPEC 8), ties in the template's order. It orders rows only. */
function byUsage<T extends { code: string }>(defects: readonly T[], usage: Props["defectUsage"]): T[] {
  return usage ? [...defects].sort((a, b) => (usage[b.code] ?? 0) - (usage[a.code] ?? 0)) : [...defects];
}

type SectionProps = Pick<Props, "data" | "labels" | "context" | "evaluation" | "readOnly" | "onFocusChange"> & {
  cls: DefectClass;
  heading: string;
  defects: VisualComputed["classes"]["major"]["defects"];
  /** The module's one way to change its data (useDataUpdater). */
  update: (change: DataChange<VisualData>) => void;
  /** The size on the tab. */
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
  update,
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
    ...oneOffs.map((label) => ({ key: oneOffRowKey(label), label, unmapped: true, removable: true })),
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
      // The class's result for the size, never the size's (docs/CAPTURE_KIT.md).
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
    update((current) =>
      label === undefined
        ? setCount(current, cellOf(cell), cell.row, count)
        : setOneOff(current, cellOf(cell), label, count),
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
    // Unchanged (the label is already a row of the class) is no change at all.
    update((current) => addOneOff(current, cell, label, defects, sizes, split));
  };
  const removeRow = (key: string) => {
    const label = oneOffByRow.get(key);
    if (label !== undefined) update((current) => removeOneOff(current, cls, label, sizes, split));
  };
  /** calc's messages about the value at `path`: errors show in red under the field, warnings in amber. */
  const messagesAt = (path: IssuePath, level: "error" | "warning") => {
    const key = issuePathKey(path);
    return (evaluation?.issues ?? [])
      .filter((issue) => issue.level === level && issuePathKey(issue.path) === key)
      .map((issue) => issue.message);
  };
  const limitLabel = labelFor(labels, cls === "critical" ? "criticalLimit" : "defectLimit");

  return (
    <ModuleSection title={heading}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
        {sizes.map((entry) => {
          const path: IssuePath = ["sizes", entry, cls, "inspected"];
          const warnings = messagesAt(path, "warning");
          return (
            <SizeBlock key={entry} size={entry} className="relative min-w-0" {...issuePathProps(["sizes", entry, cls])}>
              {/* Only what was entered, no placeholder: an empty field is a class not yet inspected. */}
              <NumberField
                label={
                  // One element: the Label is a flex row, and ", size XS" must follow the text without a gap.
                  <span>
                    {labelFor(labels, "inspected")}
                    <span className="sr-only">, {classLabel(labels, cls)}</span>
                    <SideBySideText>, size {formatSize(entry, { sizes: context.templateSizes })}</SideBySideText>
                  </span>
                }
                value={data.sizes[entry]?.[cls].inspected ?? null}
                onValueChange={(inspected) => update((current) => setInspected(current, entry, cls, inspected))}
                integer
                min={2}
                error={messagesAt(path, "error")[0] ?? null}
                warning={warnings}
                issuePath={path}
                readOnly={readOnly}
                onFocus={() => onFocusChange?.({ size: entry })}
              />
            </SizeBlock>
          );
        })}
      </div>

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
          limitAccept: limitWord(labels, cls, "accept"),
          limitReject: limitWord(labels, cls, "reject"),
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
        onRemoveRow={readOnly ? undefined : removeRow}
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

/**
 * A class's word in its limit row, where a template words one class's limit
 * apart (STD_EG prints the critical row "Acc. = 0 / Rej. = 1"): its key class
 * first, as the dictionary keys class wording (`criticalAccept`, like
 * `criticalTotal`), else a dotted key added in the editor (`critical.accept`),
 * else the word every class shares.
 */
function limitWord(labels: Labels, cls: DefectClass, word: "accept" | "reject"): string {
  const own = labels[`${cls}${word === "accept" ? "Accept" : "Reject"}`];
  return own !== undefined && own.trim() !== "" ? own : labelFor(labels, cls, word);
}
