"use client";

// Visual inspection (BUILD_SPEC 6.1; 8 "Speed"), one size at a time (Kenneth,
// 26 October 2026): a tab per ordered size and, on it, the size's gloves
// inspected, then a card per defect class the template switches on
// (critical, major, minor), side by side where three fit. A card has calc's
// Accept / Reject for the size, the defects counted by tapping in the
// template's order and wording (a Right and a Left stepper when the template
// splits hands and both show), then the class's total and result. One field
// takes the gloves inspected for every class of the size, the sampling
// plan's n one tap away, and it is never filled in for the inspector: a class
// stays not done until its gloves inspected are entered, the inspector's word
// that the size was inspected (6.2 rule 5). Data entered with a different
// number per class keeps a field in each card. Limits and results are calc's
// (6.2 rule 2); the total and its chip follow every tap. Every change goes
// through useDataUpdater and starts from the latest data, so two taps in one
// event both land (docs/CAPTURE_KIT.md).
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { FlagIcon, PlusIcon, XIcon } from "lucide-react";
import {
  EnterGroup,
  HandToggle,
  handsOf,
  issuePathKey,
  issuePathProps,
  NumberField,
  SizeTabs,
  StatusPill,
  Stepper,
  useDataUpdater,
  useIssueFocus,
  type DataChange,
  type HandView,
  type IssuePath,
} from "@/components/qc";
import { HAND_WORD } from "@/components/qc/hand-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STATUS_LABEL, type Status } from "@/lib/design/status";
import { formatLimitParts, formatSize, formatSizeHand } from "@/lib/format";
import { cn } from "@/lib/utils";
import { HANDS, initialSize, labelFor, samplingFor, type CaptureProps, type Hand, type Labels } from "@/modules/_framework";
import { ShownSizeReport } from "@/modules/_framework/shown-size";
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
  setSizeInspected,
  sharedInspected,
  unlistedCodes,
  type DefectCell,
} from "./edit";
import { DEFECT_CLASSES, type DefectClass } from "./schema";

type Props = CaptureProps<VisualData, VisualConfig, VisualComputed>;

/**
 * The class cards' columns (docs/DESIGN.md, Density): three side by side
 * where they fit, else one under another. A card needs about 15rem with a
 * mouse (three from a 46rem panel: the desktop at 1440 px beside its
 * sidebar) and 19rem on touch (three from 60rem: an iPad in landscape, never
 * in portrait); a row with both hands' steppers needs twice the room for them.
 */
const CARD_COLUMNS = {
  one: "fine:@min-[46rem]:grid-cols-3 touch:@min-[60rem]:grid-cols-3",
  both: "fine:@min-[78rem]:grid-cols-3 touch:@min-[100rem]:grid-cols-3",
} as const;

export default function VisualCapture({
  data,
  config,
  labels,
  context,
  evaluation,
  focusPath,
  readOnly,
  focus,
  onChange,
  onFocusChange,
  defectUsage,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const update = useDataUpdater(data, onChange);
  const sizes = context.sizes;
  // Opens on the size chosen in the last module (CaptureProps.focus), else the first one ordered.
  const [chosen, setChosen] = useState(() => initialSize(context, focus));
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

  if (included.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-not-done-border bg-not-done-tint px-4 py-3 text-sm text-not-done touch:text-base">
        No defect classes are switched on in this template.
      </p>
    );
  }

  const showSize = (next: string) => {
    // A number still being typed is stored for its own size before that size's panel goes: SizeTabs
    // sees to it for a swipe, but a tab tapped on the iPad leaves the focus in the field.
    const typing = root.current?.ownerDocument.activeElement;
    if (typing instanceof HTMLInputElement && root.current?.contains(typing)) typing.blur();
    setChosen(next);
    onFocusChange?.({ size: next });
  };

  return (
    <div ref={root} className="min-w-0">
      <SizeTabs
        sizes={sizes}
        templateSizes={context.templateSizes}
        value={size}
        onValueChange={showSize}
        results={evaluation?.result.perSize}
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
        {/* The size on the tabs tags the photos taken now: it is the only size on screen. */}
        <ShownSizeReport sizes={sizes} onFocusChange={onFocusChange} />
        {/* By size: a form left open, or what was last said, never carries over to the next size. */}
        <SizePanel
          key={size}
          data={data}
          labels={labels}
          context={context}
          evaluation={evaluation}
          readOnly={readOnly}
          onFocusChange={onFocusChange}
          defectUsage={defectUsage}
          update={update}
          classes={classes}
          included={included}
          size={size}
          split={split}
          shownHands={shownHands}
        />
      </SizeTabs>
    </div>
  );
}

/** The most-used defects first (BUILD_SPEC 8), ties in the template's order. It orders rows only. */
function byUsage<T extends { code: string }>(defects: readonly T[], usage: Props["defectUsage"]): T[] {
  return usage ? [...defects].sort((a, b) => (usage[b.code] ?? 0) - (usage[a.code] ?? 0)) : [...defects];
}

type PanelProps = Pick<
  Props,
  "data" | "labels" | "context" | "evaluation" | "readOnly" | "onFocusChange" | "defectUsage"
> & {
  /** The module's one way to change its data (useDataUpdater). */
  update: (change: DataChange<VisualData>) => void;
  classes: VisualComputed["classes"];
  /** The classes the template switches on, in report order. */
  included: readonly DefectClass[];
  /** The size on the tab. */
  size: string;
  split: boolean;
  shownHands: readonly Hand[];
};

/** One size: its gloves inspected, then a card per class. */
function SizePanel({
  data,
  labels,
  context,
  evaluation,
  readOnly,
  onFocusChange,
  defectUsage,
  update,
  classes,
  included,
  size,
  split,
  shownHands,
}: PanelProps) {
  const sizeName = formatSize(size, { sizes: context.templateSizes });
  const planned = samplingFor(context, size).watertightVisual;
  const inspectedLabel = labelFor(labels, "inspected");
  const shared = sharedInspected(data, size, included);
  const pathOf = (cls: DefectClass): IssuePath => ["sizes", size, cls, "inspected"];
  /** calc's messages about the value at `path`: errors show in red under the field, warnings in amber. */
  const messagesAt = (path: IssuePath, level: "error" | "warning") => {
    const key = issuePathKey(path);
    return (evaluation?.issues ?? [])
      .filter((issue) => issue.level === level && issuePathKey(issue.path) === key)
      .map((issue) => issue.message);
  };
  const reportSize = () => onFocusChange?.({ size });

  return (
    // @container: the cards' columns follow the room the panel has (CARD_COLUMNS). Also where an issue
    // about the whole size points: the gloves inspected, the first thing in it.
    <div className="@container min-w-0 space-y-4" {...issuePathProps(["sizes", size])}>
      {shared && (
        <InspectedField
          label={`${inspectedLabel}, Size ${sizeName}`}
          className="w-full max-w-xs"
          value={shared.value}
          planned={planned}
          paths={included.map(pathOf)}
          place={`size ${sizeName}`}
          // Every class's own messages: one number can be too small for one class's AQL and not another's.
          error={[...new Set(included.flatMap((cls) => messagesAt(pathOf(cls), "error")))].join(" ") || null}
          warnings={included.flatMap((cls) => messagesAt(pathOf(cls), "warning"))}
          readOnly={readOnly}
          onValueChange={(inspected) => update((current) => setSizeInspected(current, size, included, inspected))}
          onUsePlanned={(n) => update((current) => fillInspected(current, size, included, n))}
          onFocus={reportSize}
        />
      )}
      {/* One run where each card has its own gloves inspected: Enter goes from one to the next, and a
          pasted column fills them. */}
      <EnterGroup>
        <div
          className={cn("grid items-start gap-3 touch:gap-4", shownHands.length > 1 ? CARD_COLUMNS.both : CARD_COLUMNS.one)}
        >
          {included.map((cls) => (
            <ClassCard
              key={cls}
              cls={cls}
              heading={classes[cls].heading}
              defects={byUsage(classes[cls].defects, defectUsage)}
              data={data}
              labels={labels}
              context={context}
              evaluation={evaluation}
              readOnly={readOnly}
              onFocusChange={onFocusChange}
              update={update}
              size={size}
              split={split}
              shownHands={shownHands}
              field={
                shared ? undefined : (
                  <InspectedField
                    label={
                      // One element: the Label is a flex row, and the class and size must follow the text without a gap.
                      <span>
                        {inspectedLabel}
                        <span className="sr-only">{`, ${classLabel(labels, cls)}, Size ${sizeName}`}</span>
                      </span>
                    }
                    className="min-w-0 flex-1 basis-36"
                    value={data.sizes[size]?.[cls].inspected ?? null}
                    planned={planned}
                    paths={[pathOf(cls)]}
                    place={`${classLabel(labels, cls)}, size ${sizeName}`}
                    error={messagesAt(pathOf(cls), "error")[0] ?? null}
                    warnings={messagesAt(pathOf(cls), "warning")}
                    readOnly={readOnly}
                    onValueChange={(inspected) => update((current) => setInspected(current, size, cls, inspected))}
                    onUsePlanned={(n) => update((current) => fillInspected(current, size, [cls], n))}
                    onFocus={reportSize}
                  />
                )
              }
            />
          ))}
        </div>
      </EnterGroup>
    </div>
  );
}

/**
 * No. of Sample Inspected, with the sampling plan's n one tap away while it
 * is empty, and a quiet word on where it stands against the plan once filled.
 * Only what was entered shows (no placeholder): an empty field is a class
 * not yet inspected, never one that seems to hold the plan's n.
 */
function InspectedField({
  label,
  value,
  planned,
  paths,
  place,
  error,
  warnings,
  readOnly,
  onValueChange,
  onUsePlanned,
  onFocus,
  className,
}: {
  label: ReactNode;
  value: number | null;
  /** The sampling plan's gloves for watertight and visual; null while it has none. */
  planned: number | null;
  /** The issue paths of the classes it enters: the first is its own, and an issue at any of them lands on it. */
  paths: readonly IssuePath[];
  /** Whose number the Use button enters, for its accessible name: "size S". */
  place: string;
  error: string | null;
  warnings: readonly string[];
  readOnly: boolean;
  onValueChange: (value: number | null) => void;
  onUsePlanned: (planned: number) => void;
  onFocus: () => void;
  /** The field's box, beside the Use button. */
  className?: string;
}) {
  const [own, ...others] = paths;
  const hint =
    value === null || planned === null ? null : value === planned ? "from Sampling Plan" : `Sampling Plan: ${planned}`;
  const field = (
    <NumberField
      label={label}
      value={value}
      onValueChange={onValueChange}
      integer
      min={2}
      hint={hint}
      error={error}
      warning={warnings}
      issuePath={own}
      readOnly={readOnly}
      onFocus={onFocus}
    />
  );
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      <div className={className}>
        {/* A box per other class's path around the field: a link to an issue at any of them focuses it. */}
        {others.reduceRight<ReactNode>((inner, path) => <div {...issuePathProps(path)}>{inner}</div>, field)}
      </div>
      {!readOnly && value === null && planned !== null && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Use ${planned} from the Sampling Plan for ${place}`}
          // Level with the field's box (36 px, 44 px on touch as the button), with 16 px text on touch as every field's.
          className="mb-0.5 touch:mb-0 touch:text-base"
          onClick={() => onUsePlanned(planned)}
        >
          {`Use ${planned}`}
        </Button>
      )}
    </div>
  );
}

type Row = {
  /** Defect code, or a one-off label's row key (oneOffRowKey). */
  key: string;
  /** In the template's wording; a one-off in the inspector's. */
  label: string;
  /** A code the class's list lacks, or a one-off label: flagged for an admin. */
  unmapped?: boolean;
  /** A one-off label, counted in each cell's list of defects not in the list. */
  oneOff?: string;
};

type CardProps = Pick<Props, "data" | "labels" | "context" | "evaluation" | "readOnly" | "onFocusChange"> & {
  cls: DefectClass;
  heading: string;
  defects: VisualComputed["classes"]["major"]["defects"];
  /** The module's one way to change its data (useDataUpdater). */
  update: (change: DataChange<VisualData>) => void;
  /** The size on the tab. */
  size: string;
  split: boolean;
  shownHands: readonly Hand[];
  /** The class's own gloves inspected, where the size's classes hold different numbers. */
  field?: ReactNode;
};

/**
 * One defect class of the size on the tab: its heading and Accept / Reject,
 * a row per defect counted by tapping, then the class's total and result.
 */
function ClassCard({
  cls,
  heading,
  defects,
  data,
  labels,
  context,
  evaluation,
  readOnly,
  onFocusChange,
  update,
  size,
  split,
  shownHands,
  field,
}: CardProps) {
  const headingId = useId();
  const sizes = context.sizes;
  const name = classLabel(labels, cls);
  const listed = new Set(defects.map((defect) => defect.code));
  const rows: Row[] = [
    ...defects.map((defect) => ({ key: defect.code, label: defect.label })),
    // Saved under a code the list lacks: calc counts them, so they show, flagged.
    ...unlistedCodes(data, sizes, cls, split, listed).map((code) => ({ key: code, label: code, unmapped: true })),
    ...oneOffLabels(data, sizes, cls, split).map((label) => ({
      key: oneOffRowKey(label),
      label,
      unmapped: true,
      oneOff: label,
    })),
  ];
  // The total counts every hand recorded, whichever is on screen.
  const recorded: readonly (Hand | undefined)[] = split ? HANDS : [undefined];
  const shown: readonly (Hand | undefined)[] = split ? shownHands : [undefined];
  const cellAt = (at: string, hand: Hand | undefined): DefectCell => (hand ? { size: at, cls, hand } : { size: at, cls });
  const countAt = (row: Row, cell: DefectCell) =>
    row.oneOff === undefined ? readCount(data, cell, row.key) : (readOneOff(data, cell, row.oneOff)?.entry.count ?? 0);
  const pathAt = (row: Row, cell: DefectCell): IssuePath => {
    const base = ["sizes", cell.size, ...(cell.hand ? [cell.hand] : []), cls];
    if (row.oneOff === undefined) return [...base, "counts", row.key];
    const found = readOneOff(data, cell, row.oneOff);
    return found ? [...base, "unmapped", found.index] : [...base, "unmapped"];
  };

  const values = evaluation?.computed.sizes[size]?.[cls] ?? null;
  const limits =
    values && values.accept !== null && values.reject !== null ? { ac: values.accept, re: values.reject } : null;
  const total = rows.reduce(
    (sum, row) => sum + recorded.reduce((count, hand) => count + countAt(row, cellAt(size, hand)), 0),
    0,
  );
  const status = shownResult(total, limits, values?.result);

  // The count last changed and the row last taken off. What is said is worked out from the data rendered
  // after the change, so the verdict spoken is the one on the chip.
  const [touched, setTouched] = useState<{ row: string; hand?: Hand } | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);
  const touchedRow = touched ? rows.find((row) => row.key === touched.row) : undefined;
  const verdict = status === "not_done" ? "" : `, ${STATUS_LABEL[status]}`;
  const announcement =
    removed !== null
      ? `${removed} removed.`
      : touched && touchedRow
        ? `${countAt(touchedRow, cellAt(size, touched.hand))}. ${name}: total ${total}${verdict}.`
        : "";

  /** For photo tags: the size, the hand and the defect in focus; a one-off label has no code to tag. */
  const report = (row: Row, hand: Hand | undefined) =>
    onFocusChange?.({ size, ...(hand ? { hand } : {}), ...(row.oneOff === undefined ? { defect: row.key } : {}) });
  const change = (row: Row, cell: DefectCell, count: number) => {
    update((current) =>
      row.oneOff === undefined ? setCount(current, cell, row.key, count) : setOneOff(current, cell, row.oneOff, count),
    );
    setTouched({ row: row.key, hand: cell.hand });
    setRemoved(null);
    // Counting is being in that cell, however the count changed: a tap, a held button (WebKit may send
    // no click after it), a key.
    report(row, cell.hand);
  };

  const card = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const addRow = (label: string) => {
    // With both hands on screen a one-off goes in on the right hand; either hand then counts it.
    const cell = cellAt(size, split ? (shownHands[0] ?? "R") : undefined);
    // Unchanged (the label is already a row of the class) is no change at all.
    update((current) => addOneOff(current, cell, label, defects, sizes, split));
  };
  // A one-off row comes off only while it counts nothing in any ordered size and hand, so no tapped count goes with it.
  const canRemove = (row: Row) =>
    row.oneOff !== undefined &&
    !readOnly &&
    sizes.every((at) => recorded.every((hand) => countAt(row, cellAt(at, hand)) === 0));
  const remove = (row: Row, index: number) => {
    const label = row.oneOff;
    if (label === undefined) return;
    update((current) => removeOneOff(current, cls, label, sizes, split));
    setTouched(null);
    setRemoved(row.label);
    // Its button goes with it: move the focus now, while the row is still there. To the add button while it
    // shows, else to the row taking its place (the one before, for the last row), else to the card.
    const items = Array.from(list.current?.children ?? []);
    const next = opener.current ?? firstCount(items[index + 1]) ?? firstCount(items[index - 1]);
    if (next) next.focus();
    else focusItself(card.current);
  };

  // The report's line in two halves, so a narrow card wraps it after the slash, never before it.
  const accept = limitWord(labels, cls, "accept");
  const reject = limitWord(labels, cls, "reject");
  const [acceptPart, rejectPart] = formatLimitParts(limits, { accept, reject }) ?? [`${accept} — /`, `${reject} —`];

  return (
    <section
      ref={card}
      aria-labelledby={headingId}
      data-slot="defect-class"
      data-class={cls}
      {...issuePathProps(["sizes", size, cls])}
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="space-y-0.5 border-b border-border bg-slate-50 px-3 py-2.5 touch:px-4 touch:py-3">
        <h3 id={headingId} className="text-base leading-6 font-semibold text-balance text-foreground">
          {heading}
        </h3>
        {/* calc's limits for the size (6.2 rule 2), in the template's words; major and minor wait for n. */}
        <p data-slot="class-limits" className="text-sm text-muted-foreground tabular-nums touch:text-base">
          <span className="whitespace-nowrap">{acceptPart}</span> <span className="whitespace-nowrap">{rejectPart}</span>
        </p>
        {field && <div className="pt-2">{field}</div>}
      </header>

      <ul ref={list} className="divide-y divide-slate-100">
        {rows.map((row, index) => (
          <li
            key={row.key}
            data-slot="defect-row"
            data-unmapped={row.unmapped || undefined}
            data-nonzero={shown.some((hand) => countAt(row, cellAt(size, hand)) > 0) || undefined}
            className={cn(
              "flex items-center gap-x-3 px-3 py-1.5 data-nonzero:bg-brand-50 touch:px-4 touch:py-1",
              // Unmapped: an amber edge beside the flag, for the admin.
              "data-unmapped:shadow-[inset_3px_0_0_var(--color-warn-border)]",
            )}
          >
            <span className="flex min-w-0 flex-1 items-start gap-1.5 text-sm text-foreground touch:text-base">
              {row.unmapped && <FlagIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warn touch:mt-1" />}
              {/* A word too long for the card (a one-off typed as one word) breaks rather than widen it. */}
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {row.label}
                {row.unmapped && <span className="sr-only"> (unmapped label)</span>}
              </span>
              {canRemove(row) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${row.label}`}
                  className="-my-0.5 ml-auto text-muted-foreground"
                  onClick={() => remove(row, index)}
                >
                  <XIcon aria-hidden className="size-4 touch:size-5" />
                </Button>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-3">
              {shown.map((hand) => {
                const cell = cellAt(size, hand);
                return (
                  <span
                    key={hand ?? "size"}
                    className="flex items-center gap-1.5"
                    {...issuePathProps(pathAt(row, cell))}
                    {...pressReport(() => report(row, hand))}
                  >
                    {/* A word, not "L": size L is on the tabs above. The stepper's name says the hand in full. */}
                    {hand && shown.length > 1 && (
                      <span aria-hidden className="text-sm text-muted-foreground touch:text-base">
                        {HAND_WORD[hand]}
                      </span>
                    )}
                    <Stepper
                      label={`${row.label}, ${formatSizeHand(size, hand, { sizes: context.templateSizes })}`}
                      value={countAt(row, cell)}
                      onValueChange={(next) => change(row, cell, next)}
                      disabled={readOnly}
                      // The card says the count with the class's new total and verdict.
                      announce={false}
                    />
                  </span>
                );
              })}
            </span>
          </li>
        ))}
      </ul>

      {!readOnly && (
        <div className="border-t border-slate-100 px-3 py-2 touch:px-4">
          <AddOneOff label={labelFor(labels, "unmapped")} onAdd={addRow} openerRef={opener} />
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-border bg-slate-50 px-3 py-2 touch:px-4 touch:py-2.5">
        <p data-slot="class-total" className="text-sm font-semibold tabular-nums touch:text-base">
          {`Found ${total}`}
          {limits && <span className="font-normal text-muted-foreground">{` of ${limits.ac} allowed`}</span>}
        </p>
        {/* The class's result for the size, never the size's (docs/CAPTURE_KIT.md). */}
        <StatusPill size="sm" status={status} />
      </footer>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}

/**
 * The class's chip as a CounterTable column decides it (docs/CAPTURE_KIT.md):
 * with limits, the total on screen against Ac, so the chip changes with the
 * tap that changes the total while calc is a frame behind; calc's own result
 * where it says the class is not done (it knows what is missing), and
 * without limits.
 */
function shownResult(total: number, limits: { ac: number; re: number } | null, result: Status | undefined): Status {
  if (result === "not_done") return "not_done";
  if (limits) return total <= limits.ac ? "pass" : "fail";
  return result ?? "not_done";
}

/**
 * How a count reports itself for photo tags (BUILD_SPEC 8.1), as a
 * CounterTable cell does: when the focus comes in (the keyboard), and when it
 * is pressed, since Safari and Chrome on the iPad never focus a tapped button.
 */
function pressReport(report: () => void): { onFocus: () => void; onClick: () => void } {
  return { onFocus: report, onClick: report };
}

/** The first count of a card's row: where the focus goes when the row beside it comes off. */
function firstCount(row: Element | undefined): HTMLElement | null {
  return row?.querySelector<HTMLElement>('[role="spinbutton"]') ?? null;
}

/**
 * Focuses the card itself, named by its heading, for a removed row that
 * leaves nothing else to take the focus. Its tabindex lasts until the focus
 * leaves: one kept on the card would let every tap inside it take the focus.
 */
function focusItself(element: HTMLElement | null) {
  if (!element) return;
  element.tabIndex = -1;
  element.addEventListener("blur", () => element.removeAttribute("tabindex"), { once: true });
  element.focus();
}

/** "Defect Not in the List": a button that opens a one-line form for a one-off label, as a CounterTable's does. */
function AddOneOff({
  label,
  onAdd,
  openerRef,
}: {
  label: string;
  onAdd: (label: string) => void;
  /** The button while it shows, for the card to hand the focus to. */
  openerRef: RefObject<HTMLButtonElement | null>;
}) {
  const id = useId();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const opener = useRef<HTMLButtonElement | null>(null);
  const returnFocus = useRef(false);

  // Closing the form unmounts the focused field; hand focus back to its opener.
  useEffect(() => {
    if (adding || !returnFocus.current) return;
    returnFocus.current = false;
    opener.current?.focus();
  }, [adding]);

  const close = () => {
    returnFocus.current = true;
    setDraft("");
    setAdding(false);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    onAdd(value);
    close();
  };

  if (!adding) {
    return (
      <Button
        ref={(node) => {
          opener.current = node;
          openerRef.current = node;
        }}
        type="button"
        variant="ghost"
        size="sm"
        className="border border-dashed border-input text-muted-foreground touch:text-base"
        onClick={() => setAdding(true)}
      >
        <PlusIcon aria-hidden />
        {label}
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Input
        id={id}
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
        placeholder="Describe the defect"
        maxLength={80}
        className="min-w-0 flex-1 basis-40 rounded-full px-3"
      />
      <Button type="submit" size="sm" className="touch:text-base" disabled={!draft.trim()}>
        Add
      </Button>
      <Button type="button" size="sm" variant="ghost" className="touch:text-base" onClick={close}>
        Cancel
      </Button>
    </form>
  );
}

/**
 * A class's word in its limits, where a template words one class's limit
 * apart (STD_EG prints the critical limit "Acc. = 0 / Rej. = 1"): its key
 * class first, as the dictionary keys class wording (`criticalAccept`, like
 * `criticalTotal`), else a dotted key added in the editor (`critical.accept`),
 * else the word every class shares.
 */
function limitWord(labels: Labels, cls: DefectClass, word: "accept" | "reject"): string {
  const own = labels[`${cls}${word === "accept" ? "Accept" : "Reject"}`];
  return own !== undefined && own.trim() !== "" ? own : labelFor(labels, cls, word);
}
