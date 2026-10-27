"use client";

// The Sampling Plan body (BUILD_SPEC 6.1, 8 "Speed"): one table with a
// column per ordered size (Kenneth, 26 October 2026: design B, "Sizes as
// Columns", "just give the total column more width"). Each label once down
// the left: the order quantity and the lot in gloves, read-only; the
// template's counts under their headings (rows.ts), each a whole-number cell
// on the numeric keypad; then each size's result. A Total column, wider than
// a size's, sums every row while more than one size is ordered. No
// inspection level on the card and no warning for a sample below its plan
// (Kenneth, 26 October 2026: "remove the level of inspection, the warning is
// not needed").
//
// The table is a CSS grid written size by size, so the cells keep the run
// they had as one panel per size: Enter moves down the size's column and on
// to the top of the next, and a pasted row or column fills the counts after
// the cell pasted into (EnterGroup, as before). Where the sizes do not fit,
// the grid scrolls sideways in its own box with the labels pinned at the
// left, never the page. Each cell is named with its count and size ("Case,
// Size M"), so the labels down the left are for the eye only. A warning or an
// error marks its cell, and every issue is listed under the table, naming
// its size.
//
// Auto Calculate Sampling, top right of the card (Kenneth, 26 October 2026),
// fills each size's cases from the order (auto-cases.ts) and, since 27
// October 2026, its # of Gloves from its lot's code letter (auto-gloves.ts):
// one of three ways the plan comes in, beside typing it and Steri-AI reading
// a photo of the written table on Source Documents. Counts already typed are
// replaced only after a yes. It says "Sampling Plan Calculation Completed",
// with a line under it for a size whose lot size it lacked.
//
// Sampling Settings, the button beside it (Kenneth, 27 October 2026: "put a
// setting beside the auto calculation sampling, that is to set general
// inspection level"), opens a dialog: the inspection level for this
// inspection (General I, II, III; Special S-1 to S-4), a line saying where
// the level comes from (set for this inspection, the template's, the
// client's, else I) with Use Default to go back to it, and one switch for
// whether Auto Calculate Sampling rounds each size's cases up to the nearest
// 5 or 10 ("72 round to 75, 78 round to 80, not either 5 or 10"). Save
// writes both through the data updater; no count in the table changes with
// them. Read-only, the dialog only shows them. View Code Letter Table and
// View Table II-A open ISO 2859-1 Tables 1 and 2-A over it, from lib/aql, at
// the level picked, each size marked; Back to Settings returns.
//
// Sampling Quantity (Kenneth, 27 October 2026): # of Case, Inner Box Taken
// per Case, Total # of Inner Box, then Gloves Taken per Inner Box, Total
// Gloves Taken, Put Back and # of Gloves Sample. While a size's inner boxes per case are entered, its
// total is worked out from its cases (withCount): read-only on grey, the sum
// at its left ("16 × 1"); empty, the total is typed. The gloves per inner box,
// taken in all and put back are calc's, read-only on grey. The Total column sums
// neither the inner boxes per case nor the gloves per inner box.
//
// Each test row (watertight and visual, dimension, the physical test,
// packaging and dispensing) has a switch at its left (Kenneth, 26 October
// 2026): switched off, the row is greyed, never hidden, its cells take no
// typing and nothing in it is asked for. No template shows a row of gloves
// for weight any more (shownColumns).
import { CalculatorIcon, Settings2Icon, TableIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";
import {
  EnterGroup,
  EntryProblems,
  Figure,
  NumberField,
  StatusIcon,
  StatusPill,
  useDataUpdater,
  useIssueFocus,
  type EntryProblem,
} from "@/components/qc";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  formatAql,
  formatCount,
  INSPECTION_LEVELS,
  InspectionLevelSchema,
  TABLE_2A_AQLS,
  type InspectionLevel,
  type Table2ACell,
} from "@/lib/aql";
import { formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { labelFor, lotSizeGloves, moduleShortTitle, type AqlSettings, type CaptureProps } from "@/modules/_framework";
import { ModuleHeaderActions } from "@/modules/_framework/header-actions";
import { useReportShownSize } from "@/modules/_framework/shown-size";
import { autoSampleCases } from "./auto-cases";
import { autoCalculateNotice, autoSampleGloves, type AutoGloves } from "./auto-gloves";
import { defaultInspectionLevel, resolveInspectionLevel, type SamplingPlanComputed, type SourcedLevel } from "./calc";
import {
  AQL_CHECK_NAMES,
  aqlColumnsInUse,
  codeLetterRows,
  lotRange,
  masterTableRows,
  plansInUse,
  sizeCodeLetters,
  type SizeCodeLetter,
  type SizeLot,
} from "./code-letters";
import { showsInnerUnitsPerCase, type SamplingPlanConfig } from "./config";
import { AUTO_INNER_UNITS_PER_CASE, innerUnitsFromCases } from "./inner-boxes";
import { countGroups, type CountRow, type WorkedRow } from "./rows";
import {
  isRowSwitch,
  rowsOff,
  samplingSettings,
  withAutoSampling,
  withCount,
  withRowOff,
  withSamplingSettings,
  type RowSwitch,
  type SamplingPlanData,
  type SamplingSettings,
  type SamplingSize,
} from "./schema";
import { GENERAL_LEVELS, levelSourceText, SPECIAL_LEVELS } from "./settings";

/** The rows of the grid, top to bottom. */
type Line =
  | { kind: "head" }
  | { kind: "fact"; key: "orderQty" | "lotSizeGloves" }
  | { kind: "note"; key: string; text: string }
  | { kind: "heading"; key: string; text: string | null }
  | { kind: "count"; row: CountRow }
  | { kind: "worked"; row: WorkedRow }
  | { kind: "result" };

/** A count's column in a size's row of data. */
type Count = keyof SamplingSize;

const NO_GLOVES: AutoGloves = { gloves: {}, unknownLot: [] };

// The labels' column at its narrowest is the box's scroll padding: a cell
// brought into view never sits under the pinned labels.
const LABEL_MIN_REM = 10;
const SIZE_MIN_REM = 6;
const TOTAL_MIN_REM = 10;

const CELL = "flex min-w-0 items-center border-b border-border text-sm touch:text-base";
const LABEL_CELL = "sticky left-0 z-10 bg-card px-3 py-1.5 text-left touch:py-2";
const VALUE_CELL = "justify-end border-l border-border px-2.5 py-1.5 text-right tabular-nums touch:py-2";

export default function Capture({
  data,
  config,
  labels,
  context,
  evaluation,
  focusPath,
  readOnly,
  onChange,
  onFocusChange,
}: CaptureProps<SamplingPlanData, SamplingPlanConfig, SamplingPlanComputed>) {
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const sizes = context.sizes;
  // Every size is on screen at once: only a single ordered size is on screen
  // alone and tags the photos taken now (BUILD_SPEC 8.1); a focused cell
  // reports its own size.
  useReportShownSize(sizes.length === 1 ? sizes[0] : null, onFocusChange);
  const [rejected, setRejected] = useState<Readonly<Record<string, RejectedEntry>>>({});
  // Every write starts from the latest data, so a pasted run of counts keeps every value (docs/CAPTURE_KIT.md).
  const update = useDataUpdater(data, onChange);

  useIssueFocus(focusPath, {
    root,
    // Every size is on screen; where the grid scrolls sideways, the size's column comes into the box.
    reveal: (path) => {
      const size = path[0] === "sizes" ? path[1] : undefined;
      const box = scroller.current;
      if (typeof size !== "string" || !box) return;
      const head = Array.from(box.querySelectorAll<HTMLElement>("[data-size-head]")).find(
        (cell) => cell.dataset.sizeHead === size,
      );
      if (!head) return;
      const pinned = box.querySelector<HTMLElement>("[data-label-head]")?.offsetWidth ?? 0;
      const left = head.offsetLeft - pinned;
      const right = head.offsetLeft + head.offsetWidth - box.clientWidth;
      if (box.scrollLeft > left) box.scrollLeft = left;
      else if (box.scrollLeft < right) box.scrollLeft = right;
    },
  });

  const label = (key: string) => labelFor(labels, key);
  // "Size M", as the cells and the problem list word it; "M" over its column.
  const sizeName = (size: string) => formatSize(size, { sizes: context.templateSizes, prefix: true });
  const sizeHead = (size: string) => formatSize(size, { sizes: context.templateSizes });
  const computed = evaluation?.computed;
  const groups = countGroups(config, label);
  const countRows = groups.flatMap((group) => group.rows.filter((row): row is CountRow => row.kind === "count"));
  const perCaseShown = showsInnerUnitsPerCase(config);
  // The issues of the cells on screen, size by size: the screen lists the module's own (not done) elsewhere.
  const cells = new Set(sizes.flatMap((size) => countRows.map((row) => cellKey(size, row.column))));
  const issues = (evaluation?.issues ?? []).filter(
    (issue) => issue.path.length === 3 && issue.path[0] === "sizes" && cells.has(cellKey(String(issue.path[1]), String(issue.path[2]))),
  );

  const setCount = (size: string, column: Count, value: number | null) => update((current) => withCount(current, size, column, value));
  const off = rowsOff(data);
  const setRowOff = (column: RowSwitch, switchedOff: boolean) => update((current) => withRowOff(current, column, switchedOff));

  // Sampling Settings: the inspection's own level and rounding, the level it has without one of its own.
  const settings = samplingSettings(data);
  const fallback = defaultInspectionLevel(data, config, context);
  const saveSettings = (next: SamplingSettings) => {
    if (withSamplingSettings(data, next) === data) return;
    update((current) => withSamplingSettings(current, next));
    toast.success("Sampling settings saved.");
  };
  const lot = (size: string) => computed?.sizes?.[size]?.lotSizeGloves ?? lotSizeGloves(context, size);
  const lots: SizeLot[] = sizes.map((size) => ({ size, lot: lot(size) }));

  // Auto Calculate Sampling, where the template has a Case row: null until every size has its order quantity. It
  // fills # of Gloves too, where the template has the row: the sample size of each size's lot's code letter at the
  // inspection level in force (auto-gloves.ts), and 1 inner box per case where a size has none and the template shows
  // that row, so the total inner boxes, the gloves per inner box and the put back follow.
  const hasCases = countRows.some((row) => row.column === "cases");
  const hasGloves = countRows.some((row) => row.column === "gloves");
  const autoCases = hasCases
    ? autoSampleCases(sizes, (size) => context.order[size]?.qtyCases ?? null, settings.roundCases)
    : null;
  const autoGloves = hasGloves ? autoSampleGloves(lots, resolveInspectionLevel(data, config, context).level) : NO_GLOVES;
  const replacesEntered =
    autoCases !== null &&
    sizes.some((size) => {
      const row = data.sizes[size];
      const total =
        perCaseShown && (row?.innerUnitsPerCase ?? null) === null
          ? (innerUnitsFromCases(autoCases[size] ?? null, AUTO_INNER_UNITS_PER_CASE) ?? undefined)
          : undefined;
      return (
        wouldReplace(row?.cases ?? null, autoCases[size]) ||
        wouldReplace(row?.gloves ?? null, autoGloves.gloves[size]) ||
        wouldReplace(row?.innerUnits ?? null, total)
      );
    });
  const applyAutoCases = (cases: Readonly<Record<string, number>>) => {
    update((current) =>
      withAutoSampling(current, sizes, cases, autoGloves.gloves, perCaseShown ? AUTO_INNER_UNITS_PER_CASE : null),
    );
    const notice = autoCalculateNotice({
      unknownLot: autoGloves.unknownLot,
      sizeName: sizeHead,
      glovesLabel: label("gloves"),
      orderPage: moduleShortTitle(context, "order_lots"),
    });
    toast.success(notice.title, notice.description === null ? undefined : { description: notice.description });
  };
  const headerActions = (
    <ModuleHeaderActions>
      {hasCases && !readOnly && sizes.length > 0 && (
        <AutoCalculateButton cases={autoCases} roundUp={settings.roundCases} replaces={replacesEntered} onApply={applyAutoCases} />
      )}
      <SamplingSettingsButton
        saved={settings}
        fallback={fallback}
        autoCalculate={hasCases}
        lots={lots}
        aql={context.aql}
        sizeName={sizeHead}
        label={label}
        readOnly={readOnly}
        onSave={saveSettings}
      />
    </ModuleHeaderActions>
  );

  // Names the cell with its size: every size is on screen at once. The link
  // to a cell in the problem list repeats it, so it reads "# of Case, Size M".
  const cellName = (size: string, column: Count) => `${label(column)}, ${sizeName(size)}`;

  const setRejectedEntry = (size: string, column: Count, entry: EntryProblem["entry"] | null) =>
    setRejected((current) => {
      const id = fieldId(size, column);
      const next = { ...current };
      delete next[id];
      if (entry !== null) next[id] = { key: id, label: cellName(size, column), entry, inputId: id, size, column };
      return next;
    });
  // Text that was not stored, listed with a link while its cell is still empty.
  const problems = Object.values(rejected).filter(
    (problem) => sizes.includes(problem.size) && (data.sizes[problem.size]?.[problem.column] ?? null) === null,
  );

  if (sizes.length === 0) {
    return (
      <div ref={root} className="space-y-3">
        {headerActions}
        <p className="text-sm text-muted-foreground touch:text-base">No sizes ordered yet. Add them to the order table first.</p>
      </div>
    );
  }

  // A lot is the order's cases × the gloves per case: without the packing configuration's, every lot waits on it,
  // which a quiet line under the row says (Kenneth, 27 October 2026, of a bare "Lot Size (Gloves) —").
  const lotNote =
    context.packing.glovesPerCase === null
      ? `Needs the ${moduleShortTitle(context, "packing_config")} on the ${moduleShortTitle(context, "order_lots")} page`
      : null;
  const noteLines: Line[] = lotNote === null ? [] : [{ kind: "note", key: "lot-size-note", text: lotNote }];
  const lines: Line[] = [
    { kind: "head" },
    { kind: "fact", key: "orderQty" },
    { kind: "fact", key: "lotSizeGloves" },
    ...noteLines,
    ...groups.flatMap((group, index): Line[] => [
      { kind: "heading", key: `group-${index}`, text: group.heading },
      ...group.rows.map((row): Line => (row.kind === "count" ? { kind: "count", row } : { kind: "worked", row })),
    ]),
    { kind: "result" },
  ];
  const lastRow = lines.length;
  const showTotal = sizes.length > 1;
  const totalColumn = sizes.length + 2;
  const gridStyle: CSSProperties = {
    // The Total column grows faster than a size's, so it is always the wider (Kenneth, 26 October 2026).
    gridTemplateColumns: [
      `minmax(${LABEL_MIN_REM}rem, 16rem)`,
      `repeat(${sizes.length}, minmax(${SIZE_MIN_REM}rem, 1fr))`,
      showTotal ? `minmax(${TOTAL_MIN_REM}rem, 1.4fr)` : null,
    ]
      .filter(Boolean)
      .join(" "),
    minWidth: `${LABEL_MIN_REM + sizes.length * SIZE_MIN_REM + (showTotal ? TOTAL_MIN_REM : 0)}rem`,
  };
  const at = (row: number, column: number | string): CSSProperties => ({ gridRow: row, gridColumn: column });
  const edge = (row: number) => row === lastRow && "border-b-0";

  const order = (size: string) => context.order[size]?.qtyCases ?? null;
  const factValue = (key: "orderQty" | "lotSizeGloves", size: string) => (key === "orderQty" ? order(size) : lot(size));
  const factTotal = (key: "orderQty" | "lotSizeGloves") => sumOf(sizes.map((size) => factValue(key, size)));
  // Why a lot shows a dash, for the pointer's hover and screen readers: the line under the row is for the eye.
  const factNote = (key: "orderQty" | "lotSizeGloves", value: number | null) =>
    key === "lotSizeGloves" && value === null ? lotNote : null;
  const totalsLabel = label("totals").replace(/:\s*$/, "");

  const labelCells = lines.map((line, index): ReactNode => {
    const row = index + 1;
    switch (line.kind) {
      case "head":
        return (
          <div
            key="head"
            data-label-head=""
            style={at(row, 1)}
            className={cn(CELL, LABEL_CELL, "bg-slate-50 font-semibold text-muted-foreground")}
          >
            {label("gloveSize")}
          </div>
        );
      case "fact":
        return (
          <div key={line.key} style={at(row, 1)} className={cn(CELL, LABEL_CELL, "text-muted-foreground")}>
            {label(line.key)}
          </div>
        );
      case "note":
        // Across the whole grid, quiet; its words stay at the left while the sizes scroll.
        return (
          <div
            key={line.key}
            data-slot={line.key}
            style={at(row, "1 / -1")}
            className="border-b border-border px-3 py-1 text-xs text-muted-foreground touch:py-1.5 touch:text-sm"
          >
            <span className="sticky left-3">{line.text}</span>
          </div>
        );
      case "heading":
        // Across the whole grid; its words stay at the left while the sizes scroll.
        return (
          <div
            key={line.key}
            data-slot="count-heading"
            style={at(row, "1 / -1")}
            className={cn(
              "border-b border-border bg-slate-100 text-sm font-semibold text-slate-700 touch:text-base",
              line.text === null ? "h-1.5" : "px-3 py-1.5 touch:py-2",
            )}
          >
            {line.text !== null && <span className="sticky left-3">{line.text}</span>}
          </div>
        );
      case "count":
        // A test row's label holds its switch, a control: it is drawn with the switches, not in this hidden layer.
        if (isRowSwitch(line.row.column)) return null;
        return (
          <div
            key={line.row.column}
            style={at(row, 1)}
            title={line.row.shown === line.row.label ? undefined : line.row.label}
            className={cn(CELL, LABEL_CELL, "text-foreground", edge(row))}
          >
            {line.row.shown}
          </div>
        );
      case "worked":
        return (
          <div
            key={line.row.key}
            style={at(row, 1)}
            className={cn(CELL, LABEL_CELL, "text-foreground", byProduct(line.row) && "italic", edge(row))}
          >
            {line.row.label}
          </div>
        );
      case "result":
        return (
          <div key="result" style={at(row, 1)} className={cn(CELL, LABEL_CELL, "text-muted-foreground", edge(row))}>
            Result
          </div>
        );
    }
  });

  const sizeCells = (size: string, column: number) =>
    lines.map((line, index): ReactNode => {
      const row = index + 1;
      switch (line.kind) {
        case "head":
          return (
            <div
              key="head"
              aria-hidden
              data-size-head={size}
              data-size={size}
              style={at(row, column)}
              className={cn(CELL, VALUE_CELL, "bg-slate-50 text-base font-semibold text-foreground touch:text-lg")}
            >
              {sizeHead(size)}
            </div>
          );
        case "fact": {
          const value = factValue(line.key, size);
          const note = factNote(line.key, value);
          return (
            <div
              key={line.key}
              style={at(row, column)}
              title={note ?? undefined}
              className={cn(CELL, VALUE_CELL, "text-muted-foreground")}
            >
              <span className="sr-only">{label(line.key)}: </span>
              <Figure value={value} grouping />
              {note && <span className="sr-only">{` ${note}.`}</span>}
            </div>
          );
        }
        case "note":
        case "heading":
          return null;
        case "count": {
          const { column: count } = line.row;
          const path = ["sizes", size, count] as const;
          const own = issues.filter((issue) => samePath(issue.path, path));
          const rowOff = isRowSwitch(count) && off.has(count);
          const stored = data.sizes[size];
          // While the size's inner boxes per case are entered, its total is worked out from its cases (withCount).
          const perCase = stored?.innerUnitsPerCase ?? null;
          const workedOut = count === "innerUnits" && perCaseShown && perCase !== null;
          const cases = stored?.cases ?? null;
          return (
            <div
              key={count}
              data-row-off={rowOff || undefined}
              data-worked-out={workedOut || undefined}
              style={at(row, column)}
              title={workedOut ? `${label("cases")} × ${label("innerUnitsPerCase")}` : undefined}
              className={cn(
                CELL,
                "relative border-l border-border p-0",
                rowOff && "bg-slate-50 opacity-50",
                workedOut && "bg-slate-50",
                edge(row),
              )}
            >
              {workedOut && cases !== null && (
                <span
                  aria-hidden
                  data-slot="worked-out"
                  className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs whitespace-nowrap text-muted-foreground touch:text-sm"
                >
                  {`${formatCount(cases)} × ${formatCount(perCase)}`}
                </span>
              )}
              <NumberField
                variant="cell"
                id={fieldId(size, count)}
                label={cellName(size, count)}
                value={stored?.[count] ?? null}
                onValueChange={(value) => setCount(size, count, value)}
                integer
                // At least one inner box from each case sampled (Kenneth, 27 October 2026).
                min={count === "innerUnitsPerCase" ? 1 : 0}
                error={own.find((issue) => issue.level === "error")?.message ?? null}
                warning={own.filter((issue) => issue.level === "warning").map((issue) => issue.message)}
                issuePath={path}
                onFocus={() => onFocusChange?.({ size })}
                onInvalidChange={(entry) => setRejectedEntry(size, count, entry)}
                readOnly={readOnly || rowOff || workedOut}
                className="w-full"
              />
            </div>
          );
        }
        case "worked":
          // Calc's, never typed (6.2 rule 2): read-only on grey, a dash while the gloves or the inner boxes are missing.
          return (
            <div
              key={line.row.key}
              data-worked={line.row.key}
              style={at(row, column)}
              className={cn(CELL, VALUE_CELL, "bg-slate-50 text-foreground", byProduct(line.row) && "italic", edge(row))}
            >
              <span className="sr-only">{line.row.label}: </span>
              <Figure value={computed?.sizes?.[size]?.[line.row.key] ?? null} grouping />
            </div>
          );
        case "result": {
          const result = evaluation?.result.perSize?.[size];
          return (
            <div key="result" style={at(row, column)} className={cn(CELL, VALUE_CELL, edge(row))}>
              {result && (
                <>
                  {/* Complete with nothing to pass or fail: the tick, "Done", as the step's own (Kenneth, 26 October 2026). */}
                  <StatusPill
                    size="sm"
                    status={result.status === "info" ? "pass" : result.status}
                    label={result.status === "info" ? "Done" : undefined}
                  />
                  {/* The size's few words ("Not started."): the issues under the grid say the rest. */}
                  {result.summary && <span className="sr-only">{result.summary}</span>}
                </>
              )}
            </div>
          );
        }
      }
    });

  const totalCells = lines.map((line, index): ReactNode => {
    const row = index + 1;
    const cell = cn(CELL, VALUE_CELL, "bg-slate-50 font-semibold text-foreground", edge(row));
    switch (line.kind) {
      case "head":
        return (
          <div key="head" aria-hidden style={at(row, totalColumn)} className={cell}>
            {totalsLabel}
          </div>
        );
      case "fact": {
        const total = factTotal(line.key);
        const note = factNote(line.key, total);
        return (
          <div key={line.key} style={at(row, totalColumn)} title={note ?? undefined} className={cell}>
            <span className="sr-only">{label(line.key)}: </span>
            <Figure value={total} grouping />
            {note && <span className="sr-only">{` ${note}.`}</span>}
          </div>
        );
      }
      case "note":
      case "heading":
        return null;
      case "count":
        // Inner boxes per case add up to nothing: no total.
        if (line.row.column === "innerUnitsPerCase") {
          return <div key={line.row.column} aria-hidden data-no-total="" style={at(row, totalColumn)} className={cell} />;
        }
        return (
          <div
            key={line.row.column}
            style={at(row, totalColumn)}
            className={cn(cell, isRowSwitch(line.row.column) && off.has(line.row.column) && "opacity-50")}
          >
            <span className="sr-only">{line.row.label}: </span>
            <Figure value={computed?.totals?.[line.row.column] ?? null} grouping />
          </div>
        );
      case "worked":
        // The gloves taken and put back add up; the gloves per inner box do not.
        if (line.row.key === "glovesPerInnerBox") {
          return <div key={line.row.key} aria-hidden data-no-total="" style={at(row, totalColumn)} className={cell} />;
        }
        return (
          <div key={line.row.key} style={at(row, totalColumn)} className={cn(cell, byProduct(line.row) && "italic")}>
            <span className="sr-only">{line.row.label}: </span>
            <Figure value={computed?.totals?.[line.row.key] ?? null} grouping />
          </div>
        );
      case "result":
        return <div key="result" aria-hidden style={at(row, totalColumn)} className={cell} />;
    }
  });

  // Each test row's label with its switch, in the label column: a layer of their own, reachable, as the cells are.
  const switchCells = lines.map((line, index): ReactNode => {
    if (line.kind !== "count" || !isRowSwitch(line.row.column)) return null;
    const column = line.row.column;
    const rowOff = off.has(column);
    const row = index + 1;
    return (
      <div
        key={column}
        data-slot="row-switch"
        data-row-off={rowOff || undefined}
        style={at(row, 1)}
        title={line.row.shown === line.row.label ? undefined : line.row.label}
        className={cn(CELL, LABEL_CELL, "gap-2.5", rowOff ? "bg-slate-50 text-muted-foreground" : "text-foreground", edge(row))}
      >
        <Switch
          size="sm"
          checked={!rowOff}
          onCheckedChange={(on) => setRowOff(column, !on)}
          disabled={readOnly}
          aria-label={`${line.row.label}: counted`}
        />
        <span aria-hidden className={cn("min-w-0", rowOff && "line-through decoration-slate-400")}>
          {line.row.shown}
        </span>
      </div>
    );
  });

  return (
    <div ref={root} className="space-y-3">
      {headerActions}
      <EnterGroup>
        <div data-slot="sampling-table" className="overflow-hidden rounded-lg border border-border bg-card">
          <div ref={scroller} className="relative overflow-x-auto overscroll-x-contain scroll-pl-40">
            <div className="grid" style={gridStyle}>
              {/* For the eye: every cell names its count and size itself. */}
              <div aria-hidden className="contents">
                {labelCells}
              </div>
              {/* The test rows' switches, with their labels. */}
              <div role="group" aria-label="Tests counted" className="contents">
                {switchCells}
              </div>
              {/* Size by size, top to bottom: the cells' run for Enter and a paste. */}
              {sizes.map((size, index) => (
                <div key={size} role="group" aria-label={sizeName(size)} data-size-column={size} className="contents">
                  {sizeCells(size, index + 2)}
                </div>
              ))}
              {showTotal && (
                <div role="group" aria-label={totalsLabel} className="contents">
                  {totalCells}
                </div>
              )}
            </div>
          </div>
        </div>
      </EnterGroup>
      {issues.length > 0 && (
        <ul data-slot="sampling-issues" className="space-y-2">
          {issues.map((issue) => (
            <li
              key={`${issue.code}-${issue.message}`}
              className={cn(
                "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm touch:text-base",
                issue.level === "error" ? "border-fail-border bg-fail-tint text-fail" : "border-warn-border bg-warn-tint text-warn",
              )}
            >
              <StatusIcon status={issue.level === "error" ? "fail" : "warn"} className="mt-0.5 size-4 shrink-0" />
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
      <EntryProblems problems={problems} />
    </div>
  );
}

type RejectedEntry = EntryProblem & { size: string; column: Count };

/**
 * Auto Calculate Sampling. Disabled until every size has its order quantity;
 * asks first when it would change cases or gloves already typed (`replaces`).
 */
function AutoCalculateButton({
  cases,
  roundUp,
  replaces,
  onApply,
}: {
  cases: Readonly<Record<string, number>> | null;
  /** Sampling Settings round the cases up to the nearest 5 or 10. */
  roundUp: boolean;
  replaces: boolean;
  onApply: (cases: Readonly<Record<string, number>>) => void;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={cases === null}
        title={
          cases === null
            ? "Enter every size's order quantity first."
            : `Each size's cases: the square root of the order's cases, shared by the size's cases, rounded up${roundUp ? " to the nearest 5 or 10" : ""}. Its gloves: the sample size of its lot's code letter at the inspection level.`
        }
        onClick={() => {
          if (cases === null) return;
          if (replaces) setAsking(true);
          else onApply(cases);
        }}
      >
        <CalculatorIcon aria-hidden />
        Auto Calculate Sampling
      </Button>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the Counts Entered?</AlertDialogTitle>
            <AlertDialogDescription>
              Auto Calculate Sampling fills each size&apos;s cases from the order quantities and its gloves from the lot
              size, in place of the counts already entered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => cases !== null && onApply(cases)}>Replace Counts</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** A level picked: the brand fill, as a custom field's choices have it (field-control.tsx). */
const PICKED = "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-brand-600";

type SettingsProps = {
  /** The settings the inspection keeps. */
  saved: SamplingSettings;
  /** The level the inspection has without one of its own, which Use Default goes back to. */
  fallback: SourcedLevel;
  /** Auto Calculate Sampling is offered (the template counts cases): its rounding and its note go with it. */
  autoCalculate: boolean;
  /** Each ordered size's lot in gloves, for the tables. */
  lots: readonly SizeLot[];
  /** The AQLs the inspection's checks apply, for Table II-A. */
  aql: AqlSettings;
  /** "M", as a size's column is headed. */
  sizeName: (size: string) => string;
  label: (key: string) => string;
  readOnly: boolean;
  onSave: (settings: SamplingSettings) => void;
};

/**
 * Sampling Settings: an icon button the height of Auto Calculate Sampling,
 * 44 px on any touchscreen, and the dialog it opens. Its drafts start again
 * from what is saved at each opening: the dialog holds its content only
 * while it is open.
 */
function SamplingSettingsButton({ onSave, ...props }: SettingsProps) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="icon-sm" aria-label="Sampling Settings" title="Sampling Settings">
          <Settings2Icon aria-hidden />
        </Button>
      </DialogTrigger>
      {/* Header and buttons stay put; only the settings scroll when the screen is short (iPad landscape). */}
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <SamplingSettingsForm
          {...props}
          onSave={(settings) => {
            onSave(settings);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The level for this inspection, the general levels first and the special
 * ones under Special, with where it comes from; the rounding of Auto
 * Calculate Sampling, its multiple picked only while it is switched on.
 * Nothing is written until Save; Use Default puts the level back to the
 * default in the draft. Read-only, both are shown as saved.
 */
function SamplingSettingsForm({ saved, fallback, autoCalculate, lots, aql, sizeName, label, readOnly, onSave }: SettingsProps) {
  const ids = useId();
  // Drafts until Save: the level picked for the inspection (null: the default), and the rounding.
  const [level, setLevel] = useState<InspectionLevel | null>(saved.inspectionLevel);
  const [rounding, setRounding] = useState(saved.roundCases);
  // The level in force once saved, which the tables show.
  const shown = level ?? fallback.level;
  const pick = (next: string) => {
    // A tap on the level already on answers "": the choice stays.
    const parsed = InspectionLevelSchema.safeParse(next);
    if (parsed.success) setLevel(parsed.data);
  };
  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (!readOnly) onSave({ inspectionLevel: level, roundCases: rounding });
      }}
    >
      <DialogHeader className="border-b border-border px-6 pt-6 pb-5">
        <DialogTitle className="pr-8 text-lg font-bold">Sampling Settings</DialogTitle>
        <DialogDescription>
          {readOnly
            ? "This inspection is read-only: its settings are shown as saved."
            : "For this inspection only. The counts already in the table stay as they are."}
        </DialogDescription>
      </DialogHeader>
      <div className="relative flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
        <section aria-labelledby={`${ids}-level`} className="space-y-3">
          <h3 id={`${ids}-level`} className="text-sm font-semibold text-foreground touch:text-base">
            General Inspection Level
          </h3>
          {readOnly ? (
            <p data-slot="level-shown" className="text-lg font-bold text-foreground">
              {shown}
            </p>
          ) : (
            <>
              <LevelChoice levels={GENERAL_LEVELS} value={shown} onPick={pick} aria-labelledby={`${ids}-level`} />
              <div className="space-y-1.5">
                <p aria-hidden className="text-sm text-muted-foreground touch:text-base">
                  Special
                </p>
                <LevelChoice levels={SPECIAL_LEVELS} value={shown} onPick={pick} aria-label="Special Inspection Level" />
              </div>
            </>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p data-slot="level-source" className="text-sm text-muted-foreground touch:text-base">
              {levelSourceText(level, fallback)}
            </p>
            {!readOnly && level !== null && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setLevel(null)}>
                Use Default
              </Button>
            )}
          </div>
          {autoCalculate && (
            <p className="text-sm text-muted-foreground touch:text-base">Auto Calculate uses this level for # of Gloves Sample.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <CodeLetterTableDialog level={shown} lots={lots} sizeName={sizeName} label={label} />
            <MasterTableDialog level={shown} letters={sizeCodeLetters(lots, shown)} aql={aql} sizeName={sizeName} />
          </div>
        </section>
        {autoCalculate && (
          <section aria-labelledby={`${ids}-rounding`} className="space-y-3 border-t border-border pt-5">
            {readOnly ? (
              <>
                <h3 id={`${ids}-rounding`} className="text-sm font-semibold text-foreground touch:text-base">
                  Round Up Cases to the Nearest 5 or 10
                </h3>
                <p data-slot="rounding-shown" className="text-base font-bold text-foreground">
                  {saved.roundCases ? "On" : "Off"}
                </p>
              </>
            ) : (
              <>
                <div className="flex min-h-8 items-center gap-3 touch:min-h-11">
                  <Switch
                    id={`${ids}-round`}
                    checked={rounding}
                    onCheckedChange={setRounding}
                    aria-describedby={`${ids}-round-note`}
                  />
                  {/* Wrapped, so not the switch's sibling: Label fades beside a disabled peer. */}
                  <span className="min-w-0">
                    <Label id={`${ids}-rounding`} htmlFor={`${ids}-round`} className="leading-snug font-semibold touch:text-base">
                      Round Up Cases to the Nearest 5 or 10
                    </Label>
                  </span>
                </div>
                <p id={`${ids}-round-note`} className="text-sm text-muted-foreground touch:text-base">
                  e.g. 72 → 75, 78 → 80. Applies the next time Auto Calculate Sampling runs.
                </p>
              </>
            )}
          </section>
        )}
      </div>
      <DialogFooter className="border-t border-border px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {readOnly ? (
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Close
            </Button>
          </DialogClose>
        ) : (
          <>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit">Save</Button>
          </>
        )}
      </DialogFooter>
    </form>
  );
}

/** One group of levels as a segmented control; with a level of the other group picked, none of it is on. */
function LevelChoice({
  levels,
  value,
  onPick,
  ...name
}: {
  levels: readonly InspectionLevel[];
  value: InspectionLevel;
  onPick: (next: string) => void;
} & ({ "aria-label": string } | { "aria-labelledby": string })) {
  return (
    <ToggleGroup type="single" variant="outline" spacing={0} value={levels.includes(value) ? value : ""} onValueChange={onPick} {...name}>
      {levels.map((level) => (
        <ToggleGroupItem key={level} value={level} className={cn("min-w-12 px-4 touch:min-w-14", PICKED)}>
          {level}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** The ISO tables' header and body cells: compact with a mouse, the iPad's 16 px text on touch. */
const TABLE_HEAD = "border-b border-border bg-slate-50 px-2.5 py-2 font-semibold text-muted-foreground";
const TABLE_CELL = "border-t border-border px-2.5 py-1.5 touch:py-2";

/**
 * ISO 2859-1 Table 1 (ANSI/ASQ Z1.4 Table I) over the settings: the level
 * picked highlighted, each size named in the row its lot falls in, and below
 * it each size's lot, code letter and sample size at that level. The dialog
 * scrolls inside itself (an iPad in portrait), the table sideways in its box
 * where it does not fit.
 */
function CodeLetterTableDialog({
  level,
  lots,
  sizeName,
  label,
}: {
  level: InspectionLevel;
  lots: readonly SizeLot[];
  sizeName: (size: string) => string;
  label: (key: string) => string;
}) {
  const rows = codeLetterRows(lots);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <TableIcon aria-hidden />
          View Code Letter Table
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-6 pt-6 pb-5">
          <DialogTitle className="pr-8 text-lg font-bold">Code Letter Table</DialogTitle>
          <DialogDescription>
            {`ISO 2859-1 Table 1 (ANSI/ASQ Z1.4 Table I), sample size code letters. Level ${level} is highlighted, and each size is named in the row of its lot.`}
          </DialogDescription>
        </DialogHeader>
        <div
          role="region"
          aria-label="Code Letter Table"
          tabIndex={0}
          data-slot="code-letter-scroller"
          className="relative min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-6 py-5 outline-none focus-ring-inset"
        >
          <div className="relative overflow-x-auto rounded-lg border border-border">
            <table data-slot="code-letter-table" className="w-full min-w-[34rem] border-collapse text-sm tabular-nums touch:text-base">
              <thead>
                <tr>
                  <th rowSpan={2} scope="col" className={cn(TABLE_HEAD, "text-left")}>
                    Lot Size
                  </th>
                  <th colSpan={SPECIAL_LEVELS.length} scope="colgroup" className={cn(TABLE_HEAD, "border-l text-center")}>
                    Special Inspection Levels
                  </th>
                  <th colSpan={GENERAL_LEVELS.length} scope="colgroup" className={cn(TABLE_HEAD, "border-l text-center")}>
                    General Inspection Levels
                  </th>
                  <th rowSpan={2} scope="col" className={cn(TABLE_HEAD, "border-l text-left")}>
                    Sizes
                  </th>
                </tr>
                <tr>
                  {INSPECTION_LEVELS.map((entry) => (
                    <th
                      key={entry}
                      scope="col"
                      data-level={entry}
                      data-chosen={entry === level || undefined}
                      className={cn(TABLE_HEAD, "border-l text-center", entry === level && "bg-secondary text-secondary-foreground")}
                    >
                      {entry}
                      {entry === level && <span className="sr-only"> (Chosen)</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const marked = row.sizes.length > 0;
                  return (
                    <tr key={row.from} data-sizes={marked ? row.sizes.join(" ") : undefined} className={marked ? "bg-slate-100" : undefined}>
                      <th scope="row" className={cn(TABLE_CELL, "text-left font-normal whitespace-nowrap")}>
                        {lotRange(row.from, row.to)}
                      </th>
                      {INSPECTION_LEVELS.map((entry) => (
                        <td
                          key={entry}
                          data-chosen={entry === level || undefined}
                          className={cn(
                            TABLE_CELL,
                            "border-l text-center",
                            entry === level &&
                              (marked ? "bg-primary font-bold text-primary-foreground" : "bg-accent font-semibold text-accent-foreground"),
                          )}
                        >
                          {row.letters[entry]}
                        </td>
                      ))}
                      <td className={cn(TABLE_CELL, "border-l font-semibold")}>{row.sizes.map(sizeName).join(", ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <SizeCodeLetterTable level={level} letters={sizeCodeLetters(lots, level)} sizeName={sizeName} label={label} />
        </div>
        <DialogFooter className="border-t border-border px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Back to Settings
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Each size's lot, the lot's code letter and that letter's sample size at the level, under Table 1. */
function SizeCodeLetterTable({
  level,
  letters,
  sizeName,
  label,
}: {
  level: InspectionLevel;
  letters: readonly SizeCodeLetter[];
  sizeName: (size: string) => string;
  label: (key: string) => string;
}) {
  const ids = useId();
  return (
    <section aria-labelledby={`${ids}-heading`} className="space-y-2">
      <h3 id={`${ids}-heading`} className="text-sm font-semibold text-foreground touch:text-base">
        {`Each Size at Level ${level}`}
      </h3>
      {letters.length === 0 ? (
        <p className="text-sm text-muted-foreground touch:text-base">No sizes ordered yet.</p>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-border">
          <table data-slot="size-code-letters" className="w-full min-w-[26rem] border-collapse text-sm tabular-nums touch:text-base">
            <thead>
              <tr>
                <th scope="col" className={cn(TABLE_HEAD, "text-left")}>
                  {label("gloveSize")}
                </th>
                <th scope="col" className={cn(TABLE_HEAD, "border-l text-right")}>
                  {label("lotSizeGloves")}
                </th>
                <th scope="col" className={cn(TABLE_HEAD, "border-l text-center")}>
                  {label("codeLetter")}
                </th>
                <th scope="col" className={cn(TABLE_HEAD, "border-l text-right")}>
                  Sample Size
                </th>
              </tr>
            </thead>
            <tbody>
              {letters.map((entry) => (
                <tr key={entry.size} data-size={entry.size}>
                  <th scope="row" className={cn(TABLE_CELL, "text-left font-semibold")}>
                    {sizeName(entry.size)}
                  </th>
                  <td className={cn(TABLE_CELL, "border-l text-right")}>
                    <Figure value={entry.lot} grouping />
                  </td>
                  <td className={cn(TABLE_CELL, "border-l text-center font-semibold")}>
                    {entry.codeLetter ?? <Figure value={null} />}
                  </td>
                  <td className={cn(TABLE_CELL, "border-l text-right")}>
                    <Figure value={entry.sampleSize} grouping />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {letters.some((entry) => entry.lot === null) && (
        <p className="text-sm text-muted-foreground touch:text-base">
          A size&apos;s lot is known once its order quantity and the gloves per case are entered.
        </p>
      )}
    </section>
  );
}

/**
 * ISO 2859-1 Table 2-A (ANSI/ASQ Z1.4 Table II-A) over the settings, as
 * lib/aql holds it, arrows and all: the code letters the sizes' lots take at
 * the level picked, named with the sizes, the AQL columns the inspection
 * applies, the plans where they meet, and where an arrow among those leads.
 */
function MasterTableDialog({
  level,
  letters,
  aql,
  sizeName,
}: {
  level: InspectionLevel;
  letters: readonly SizeCodeLetter[];
  aql: AqlSettings;
  sizeName: (size: string) => string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <TableIcon aria-hidden />
          View Table II-A
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <MasterTableView level={level} letters={letters} aql={aql} sizeName={sizeName} />
      </DialogContent>
    </Dialog>
  );
}

/** Table 2-A's pinned columns, the code letter's (left-24) and the sample size's, and each AQL's, in rem. */
const LETTER_REM = 6;
const SAMPLE_REM = 5;
const AQL_REM = 5;

const MASTER_HEAD = "border-r border-b border-border bg-slate-50 px-3 py-2 font-semibold text-muted-foreground";
const MASTER_CELL = "border-r border-b border-border px-3 py-2";

/**
 * Table 2-A in a box of its own that scrolls both ways inside the dialog,
 * its header rows and its two first columns pinned. It opens on the plans in
 * use: the first marked row and AQL column come into view past the pinned
 * cells.
 */
function MasterTableView({
  level,
  letters,
  aql,
  sizeName,
}: {
  level: InspectionLevel;
  letters: readonly SizeCodeLetter[];
  aql: AqlSettings;
  sizeName: (size: string) => string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const rows = masterTableRows(letters);
  const columns = aqlColumnsInUse(aql);
  // The plans an arrow leads to from where a size's code letter meets an AQL in use.
  const ledTo = new Set(
    plansInUse(letters, columns)
      .filter(({ plan }) => plan.arrow !== null)
      .map(({ plan, aql: column }) => `${plan.usedLetter} ${column}`),
  );
  useEffect(() => {
    const scroller = box.current;
    if (!scroller) return;
    const pinned = scroller.querySelector<HTMLElement>("[data-pinned-end]");
    const column = scroller.querySelector<HTMLElement>("th[data-aql-in-use]");
    const head = scroller.querySelector<HTMLElement>("thead");
    const row = scroller.querySelector<HTMLElement>("tr[data-sizes]");
    if (pinned && column) scroller.scrollLeft = Math.max(0, column.offsetLeft - (pinned.offsetLeft + pinned.offsetWidth) - column.offsetWidth);
    if (head && row) scroller.scrollTop = Math.max(0, row.offsetTop - head.offsetHeight - row.offsetHeight);
  }, []);
  return (
    <>
      <DialogHeader className="border-b border-border px-6 pt-6 pb-5">
        <DialogTitle className="pr-8 text-lg font-bold">Table II-A</DialogTitle>
        <DialogDescription>
          ISO 2859-1 Table 2-A (ANSI/ASQ Z1.4 Table II-A), single sampling plans for normal inspection (master table): Accept and
          Reject for each code letter and AQL.
        </DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-5">
        <div className="space-y-1 text-sm text-muted-foreground touch:text-base">
          <p>
            {`Level ${level}: each size is named beside its code letter, and the AQLs this inspection applies are highlighted. Where they meet is the size's plan; an arrow means the first plan below (↓) or above (↑) in its column, outlined where a size's plan leads.`}
          </p>
          {aql.critical === 0 && <p>Critical defects (AQL 0) are Accept 0, Reject 1 at any code letter.</p>}
          {letters.some((entry) => entry.codeLetter === null) && <p>A size is named once its lot is known.</p>}
        </div>
        <div
          ref={box}
          role="region"
          aria-label="Table II-A"
          tabIndex={0}
          data-slot="master-table-scroller"
          className="relative min-h-0 flex-1 overflow-auto overscroll-contain rounded-lg border border-border outline-none focus-ring-inset"
        >
          <table
            data-slot="master-table"
            className="table-fixed border-separate border-spacing-0 text-sm tabular-nums touch:text-base"
            style={{ width: `${LETTER_REM + SAMPLE_REM + TABLE_2A_AQLS.length * AQL_REM}rem` }}
          >
            <colgroup>
              <col style={{ width: `${LETTER_REM}rem` }} />
              <col style={{ width: `${SAMPLE_REM}rem` }} />
              {TABLE_2A_AQLS.map((column) => (
                <col key={column} style={{ width: `${AQL_REM}rem` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2} scope="col" className={cn(MASTER_HEAD, "sticky top-0 left-0 z-30 text-left")}>
                  Code Letter
                </th>
                <th rowSpan={2} scope="col" data-pinned-end="" className={cn(MASTER_HEAD, "sticky top-0 left-24 z-30 text-right")}>
                  Sample Size
                </th>
                {/* One row tall (h-9, h-11 on touch): the AQLs' row sticks right under it (top-9, top-11). */}
                <th colSpan={TABLE_2A_AQLS.length} scope="colgroup" className={cn(MASTER_HEAD, "sticky top-0 z-20 h-9 text-left touch:h-11")}>
                  <span className="sticky left-[11.75rem]">AQL (Accept / Reject)</span>
                </th>
              </tr>
              <tr>
                {TABLE_2A_AQLS.map((column) => {
                  const inUse = columns.find((entry) => entry.aql === column);
                  return (
                    <th
                      key={column}
                      scope="col"
                      data-aql={column}
                      data-aql-in-use={inUse ? "" : undefined}
                      className={cn(
                        MASTER_HEAD,
                        "sticky top-9 z-20 text-center touch:top-11",
                        inUse && "bg-secondary text-secondary-foreground",
                      )}
                    >
                      {formatAql(column)}
                      {inUse && (
                        <span className="block text-xs font-medium">
                          {inUse.checks.map((check) => AQL_CHECK_NAMES[check]).join(", ")}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const marked = row.sizes.length > 0;
                const ground = marked ? "bg-slate-100" : "bg-card";
                return (
                  <tr key={row.letter} data-letter={row.letter} data-sizes={marked ? row.sizes.join(" ") : undefined}>
                    <th scope="row" className={cn(MASTER_CELL, "sticky left-0 z-10 text-left", ground)}>
                      <span className="font-bold text-foreground">{row.letter}</span>
                      {marked && (
                        <span className="block text-xs font-semibold text-brand-700">{row.sizes.map(sizeName).join(", ")}</span>
                      )}
                    </th>
                    <td className={cn(MASTER_CELL, "sticky left-24 z-10 text-right", ground)}>{formatCount(row.sampleSize)}</td>
                    {row.cells.map((cell, index) => {
                      const column = TABLE_2A_AQLS[index];
                      const inUse = columns.some((entry) => entry.aql === column);
                      const meets = marked && inUse;
                      const leads = !meets && ledTo.has(`${row.letter} ${column}`);
                      return (
                        <td
                          key={column}
                          data-aql={column}
                          data-meets={meets || undefined}
                          data-leads={leads || undefined}
                          className={cn(
                            MASTER_CELL,
                            "relative text-center whitespace-nowrap",
                            meets
                              ? "bg-primary font-bold text-primary-foreground"
                              : leads
                                ? "bg-secondary font-bold text-secondary-foreground outline-2 -outline-offset-2 outline-primary"
                                : inUse
                                  ? "bg-accent text-accent-foreground"
                                  : ground,
                          )}
                        >
                          <PlanCell cell={cell} />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <DialogFooter className="border-t border-border px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Back to Settings
          </Button>
        </DialogClose>
      </DialogFooter>
    </>
  );
}

/** A Table 2-A cell as the standard prints it: Accept / Reject, or its arrow, read out in words. */
function PlanCell({ cell }: { cell: Table2ACell }) {
  if (typeof cell !== "string") return <>{`${cell[0]} / ${cell[1]}`}</>;
  return (
    <>
      <span aria-hidden>{cell}</span>
      <span className="sr-only">{cell === "↓" ? "The first plan below" : "The first plan above"}</span>
    </>
  );
}

/** A cell's key in a set: a size and a count. */
function cellKey(size: string, column: string): string {
  return JSON.stringify([size, column]);
}

/** The input's id: sizes such as "7.0" are fine in an id, never in a selector built from it. */
function fieldId(size: string, column: Count): string {
  return `sampling-plan-${size}-${column}`;
}

/** Auto Calculate Sampling would change a count already entered: one it works out, and not to the same number. */
/**
 * A worked row that only follows from the others, set in italics: Total Gloves
 * Taken (Kenneth, 27 October 2026: "italic total gloves taken because thats
 * not the important data").
 */
function byProduct(row: WorkedRow): boolean {
  return row.key === "totalGlovesTaken";
}

function wouldReplace(entered: number | null, next: number | undefined): boolean {
  return entered !== null && next !== undefined && entered !== next;
}

function samePath(path: readonly (string | number)[], target: readonly (string | number)[]): boolean {
  return path.length === target.length && path.every((segment, index) => segment === target[index]);
}

function sumOf(values: readonly (number | null)[]): number | null {
  const entered = values.filter((value): value is number => value !== null);
  return entered.length === 0 ? null : entered.reduce((sum, value) => sum + value, 0);
}
