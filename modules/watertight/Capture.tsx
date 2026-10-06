"use client";

// The watertight test (BUILD_SPEC 6.1; 8 "Speed"): per ordered size the
// gloves tested, offered from the sampling plan, and the holes counted by
// tapping per location in the template's order and wording, with R and L
// sub-columns when the template splits hands. Code letters, limits, totals
// and the accept/reject chips are calc's (6.2 rule 2) and follow every tap.
// A size stays not done until its gloves tested are entered: the
// inspector's word that the size was tested (6.2 rule 5). Every change goes
// through useDataUpdater and starts from the latest data, so a pasted column
// of gloves tested or two taps in one event all land (docs/CAPTURE_KIT.md).
import { useId, useRef, useState } from "react";
import {
  CounterTable,
  EnterGroup,
  findIssue,
  HandToggle,
  handsOf,
  issuePathKey,
  issuePathProps,
  NumberField,
  SideBySideText,
  SizeBlock,
  SizeTabs,
  useDataUpdater,
  useIssueFocus,
  type CounterCell,
  type CounterColumn,
  type CounterRow,
  type HandView,
  type IssuePath,
} from "@/components/qc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { STATUS_LABEL } from "@/lib/design/status";
import { formatSize, formatSizeHand } from "@/lib/format";
import { HANDS, labelFor, samplingFor, type CaptureProps, type Hand } from "@/modules/_framework";
import type { WatertightComputed, WatertightConfig, WatertightData } from ".";
import { aqlCaption, effectiveAql, effectiveLocations } from "./calc";
import { OTHER_LOCATION } from "./config";
import {
  addOneOff,
  fillTested,
  oneOffLabels,
  oneOffRowKey,
  readHoles,
  readOneOff,
  setHoles,
  setOneOff,
  setOtherDescription,
  setTested,
  unlistedCodes,
  type HoleCell,
} from "./edit";

type Props = CaptureProps<WatertightData, WatertightConfig, WatertightComputed>;

export default function WatertightCapture({
  data,
  config,
  title,
  labels,
  context,
  evaluation,
  focusPath,
  readOnly,
  onChange,
  onFocusChange,
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

  const locations = effectiveLocations(config, labels);
  const listed = new Set(locations.map((location) => location.code));
  const oneOffs = oneOffLabels(data, sizes, split);
  const oneOffByRow = new Map(oneOffs.map((label) => [oneOffRowKey(label), label]));
  const rows: CounterRow[] = [
    ...locations.map((location) => ({ key: location.code, label: location.label })),
    // Saved under a code the list lacks: calc counts them, so they show, flagged.
    ...unlistedCodes(data, sizes, split, listed).map((code) => ({ key: code, label: code, unmapped: true })),
    ...oneOffs.map((label) => ({ key: oneOffRowKey(label), label, unmapped: true })),
  ];

  const computed = evaluation?.computed.sizes;
  const results = evaluation?.result.perSize;
  const columns: CounterColumn[] = sizes.map((entry) => {
    const values = computed?.[entry];
    return {
      key: entry,
      label: formatSize(entry, { sizes: context.templateSizes }),
      name: formatSize(entry, { sizes: context.templateSizes, prefix: true }),
      n: data.sizes[entry]?.tested ?? null,
      limits:
        values && values.accept !== null && values.reject !== null ? { ac: values.accept, re: values.reject } : null,
      // One table per size: the size's result is the table's (docs/CAPTURE_KIT.md).
      status: results?.[entry]?.status,
    };
  });

  const cellOf = ({ column, hand }: Pick<CounterCell, "column" | "hand">): HoleCell =>
    hand ? { size: column, hand } : { size: column };
  const readCell = (cell: CounterCell) => {
    const label = oneOffByRow.get(cell.row);
    return label === undefined
      ? readHoles(data, cellOf(cell), cell.row)
      : (readOneOff(data, cellOf(cell), label)?.entry.count ?? 0);
  };
  const writeCell = (cell: CounterCell, count: number) => {
    const label = oneOffByRow.get(cell.row);
    update((current) =>
      label === undefined
        ? setHoles(current, cellOf(cell), cell.row, count)
        : setOneOff(current, cellOf(cell), label, count),
    );
  };
  const cellPath = (cell: CounterCell): IssuePath => {
    const base = ["sizes", cell.column, ...(cell.hand ? [cell.hand] : [])];
    const label = oneOffByRow.get(cell.row);
    if (label === undefined) return [...base, "holes", cell.row];
    const found = readOneOff(data, cellOf(cell), label);
    return found ? [...base, "unmapped", found.index] : [...base, "unmapped"];
  };
  const addRow = (label: string) => {
    const cell: HoleCell = split ? { size, hand: shownHands[0] } : { size };
    // Unchanged (the label is already a row) is no change at all.
    update((current) => addOneOff(current, cell, label, locations, sizes, split));
  };
  /** calc's messages about the value at `path`: errors show in red under the field, warnings in amber. */
  const messagesAt = (path: IssuePath, level: "error" | "warning") => {
    const key = issuePathKey(path);
    return (evaluation?.issues ?? [])
      .filter((issue) => issue.level === level && issuePathKey(issue.path) === key)
      .map((issue) => issue.message);
  };

  const codeLetters = evaluation?.computed.codeLetters;
  const other = locations.find((location) => location.code === OTHER_LOCATION);

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
        <div className="space-y-4">
          <EnterGroup className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
            {sizes.map((entry) => (
              <TestedField
                key={entry}
                label={labelFor(labels, "tested")}
                sizeName={formatSize(entry, { sizes: context.templateSizes })}
                path={["sizes", entry]}
                tested={data.sizes[entry]?.tested ?? null}
                planned={samplingFor(context, entry).watertightVisual}
                error={messagesAt(["sizes", entry, "tested"], "error")[0] ?? null}
                warnings={messagesAt(["sizes", entry, "tested"], "warning")}
                size={entry}
                readOnly={readOnly}
                onTestedChange={(tested) => update((current) => setTested(current, entry, tested))}
                onUsePlanned={(planned) => update((current) => fillTested(current, entry, planned))}
                onFocus={() => onFocusChange?.({ size: entry })}
              />
            ))}
          </EnterGroup>

          <p className="text-sm text-muted-foreground touch:text-base">
            {labelFor(labels, "codeLetter")} {codeLetters ?? "–"} · AQL {aqlCaption(effectiveAql(config, context))}
          </p>

          <CounterTable
            caption={evaluation?.computed.heading ?? title}
            rows={rows}
            columns={columns}
            activeColumn={size}
            hands={split ? HANDS : undefined}
            visibleHands={split ? shownHands : undefined}
            getCount={readCell}
            onCountChange={writeCell}
            labels={{
              rowHeader: labelFor(labels, "holes"),
              inspected: labelFor(labels, "tested"),
              limits: labelFor(labels, "defectLimit"),
              limitAccept: labelFor(labels, "accept"),
              limitReject: labelFor(labels, "reject"),
              total: labelFor(labels, "totalDefects"),
              result: labelFor(labels, "result"),
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

          {other &&
            sizes.flatMap((entry) =>
              (split ? shownHands : [undefined]).map((hand) => {
                const record = hand ? data.sizes[entry]?.[hand] : data.sizes[entry];
                const count = record?.holes[OTHER_LOCATION] ?? 0;
                const text = record?.otherDescription ?? "";
                if (count === 0 && text === "") return null;
                const path = ["sizes", entry, ...(hand ? [hand] : []), "otherDescription"];
                const cell: HoleCell = hand ? { size: entry, hand } : { size: entry };
                return (
                  <OtherField
                    key={`${entry}:${hand ?? ""}`}
                    label={labelFor(labels, "otherDescription")}
                    where={formatSizeHand(entry, hand, { sizes: context.templateSizes })}
                    path={path}
                    value={text}
                    note={findIssue(evaluation?.issues, path)?.message ?? null}
                    size={entry}
                    readOnly={readOnly}
                    onValueChange={(next) => update((current) => setOtherDescription(current, cell, next))}
                    onFocus={() =>
                      onFocusChange?.({ size: entry, ...(hand ? { hand } : {}), defect: OTHER_LOCATION })
                    }
                  />
                );
              }),
            )}
        </div>
      </SizeTabs>
    </div>
  );
}

/**
 * No. of sample tested for one size, with the sampling plan's n one tap away.
 * The field shows only what was entered (no placeholder): an empty field is a
 * size not yet tested, never one that seems to hold the plan's n.
 */
function TestedField({
  label,
  sizeName,
  path,
  tested,
  planned,
  error,
  warnings,
  size,
  readOnly,
  onTestedChange,
  onUsePlanned,
  onFocus,
}: {
  label: string;
  sizeName: string;
  path: IssuePath;
  tested: number | null;
  planned: number | null;
  error: string | null;
  /** E.g. a sample too small for the AQL: why the size stays not done. */
  warnings: readonly string[];
  /** Shown for the size on the tabs; every size's only where the sizes sit side by side. */
  size: string;
  readOnly: boolean;
  onTestedChange: (tested: number | null) => void;
  onUsePlanned: (planned: number) => void;
  onFocus: () => void;
}) {
  return (
    <SizeBlock size={size} className="relative min-w-0 space-y-2" {...issuePathProps(path)}>
      <NumberField
        label={
          // One element: the Label is a flex row, and ", size XS" must follow the text without a gap.
          <span>
            {label}
            <SideBySideText>, size {sizeName}</SideBySideText>
          </span>
        }
        value={tested}
        onValueChange={onTestedChange}
        integer
        min={2}
        error={error}
        warning={warnings}
        issuePath={[...path, "tested"]}
        readOnly={readOnly}
        onFocus={onFocus}
      />
      {planned !== null && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground touch:text-base">
          <span>Sampling plan: {planned}</span>
          {!readOnly && tested === null && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="touch:text-base"
              onClick={() => onUsePlanned(planned)}
            >
              Use {planned}
              <span className="sr-only"> for size {sizeName}</span>
            </Button>
          )}
        </div>
      )}
    </SizeBlock>
  );
}

/** Where the holes counted under "Other :" were, for one size (and hand). */
function OtherField({
  label,
  where,
  path,
  value,
  note,
  size,
  readOnly,
  onValueChange,
  onFocus,
}: {
  label: string;
  where: string;
  path: IssuePath;
  value: string;
  note: string | null;
  /** Shown for the size on the tabs; every size's only where the sizes sit side by side. */
  size: string;
  readOnly: boolean;
  onValueChange: (value: string) => void;
  onFocus: () => void;
}) {
  const id = useId();
  return (
    <SizeBlock size={size} className="relative max-w-xl space-y-1.5" {...issuePathProps(path)}>
      <Label htmlFor={id} className="leading-snug touch:text-base">
        {label} <span className="font-normal text-muted-foreground">({where})</span>
      </Label>
      <Input
        id={id}
        value={value}
        maxLength={200}
        readOnly={readOnly}
        onChange={(event) => onValueChange(event.target.value)}
        onFocus={onFocus}
        aria-describedby={note ? `${id}-note` : undefined}
      />
      {note && (
        <p id={`${id}-note`} className="text-sm text-warn touch:text-base">
          {note}
        </p>
      )}
    </SizeBlock>
  );
}
