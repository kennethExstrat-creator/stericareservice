"use client";

// Glove Dispensing Inspection capture (BUILD_SPEC 6.1, 8 "Speed"): one size
// at a time (swipe on iPad, arrow keys on desktop). The size's boxes are a
// list, one row per box column of the sheet, 15 rows a page (Kenneth, 12
// October 2026): its No., its box number typed on the numeric keypad (6.2
// rule 7: the inspector's own number, not a carton number), its defects over
// the gloves of the pack, and Delete. Enter goes down the box numbers, the box
// just typed staying the one counted, and a pasted column fills down them.
// Defects are counted by tapping, never typed.
// On iPad the counts show one box at a time: the row chosen (tap it or its
// box number), stepped through with Previous and Next; from 1280 px every box
// sits side by side, as on the sheet. The per box "1/125" and rate, the size
// total "3 / 625 (0.48%)" and its result against the maximum come from calc
// as you tap (rule 2). A box number the field refuses, and any problem calc
// finds in a box, is listed under the box list with a link to it: the cell
// itself only turns red. Every write goes through useDataUpdater, starting
// from the latest data, so taps faster than the screen renders all count
// (docs/CAPTURE_KIT.md).
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, Trash2Icon } from "lucide-react";
import {
  BoxNumberField,
  ColumnSwitcher,
  CounterTable,
  EnterGroup,
  EntryProblems,
  Figure,
  findIssue,
  issuePathProps,
  ModuleSection,
  RequirementList,
  SizeTabs,
  StatusIcon,
  useDataUpdater,
  useIssueFocus,
  useRefusedEntryStore,
  type DataChange,
  type EntryProblem,
  type InvalidEntry,
  type IssuePath,
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
import { formatRatio, formatRatioDecimal, formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { initialSize, labelFor, type CaptureProps, type ValidationIssue } from "@/modules/_framework";
import { sizeOnTabs, useReportShownSize } from "@/modules/_framework/shown-size";
import type { DispensingSafedonComputed, DispensingSafedonConfig, DispensingSafedonData } from ".";
import { plannedBoxes, safedonHeading } from "./calc";
import { MAX_BOXES_PER_SIZE } from "./config";
import {
  activeAfterRemoval,
  boxDefects,
  BOXES_PER_PAGE,
  boxesOf,
  boxPageOf,
  canRemoveBox,
  columnsShown,
  removeSafedonBox,
  setSafedonBoxNo,
  setSafedonCount,
} from "./edit";
import { isBlankSafedonBox } from "./schema";
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
  // The page of each size's box list, from 0: kept here, so an issue link can open the one its box is on.
  const [pages, setPages] = useState<Record<string, number>>({});
  // Box numbers the cells refused ("2 42"), by `size:index`, listed under the box list with a link.
  const [rejected, setRejected] = useState<Record<string, EntryProblem>>({});
  // The issue link being followed, the screen's or one under the box list.
  const [linked, setLinked] = useState<IssuePath | null>(null);

  const reveal = (path: IssuePath) => {
    const target = path[1];
    if (path[0] !== "sizes" || typeof target !== "string" || !context.sizes.includes(target)) return;
    setSize(target);
    const column = path[3];
    if (path[2] === "boxes" && typeof column === "number") {
      setActive((current) => ({ ...current, [target]: column }));
      setPages((current) => ({ ...current, [target]: boxPageOf(column) }));
    }
  };
  // The size, box and page are revealed in the render that hands the link to useIssueFocus, so they
  // are on screen when it looks for the control. While a box on another page of the list is not
  // rendered, the closest marked element is the size's result: a look before the page had turned
  // would land there.
  const follow = (path: IssuePath) => {
    reveal(path);
    setLinked(path);
  };
  // The screen's link, followed as it arrives (React's "adjusting state when a prop changes"). Its
  // array as it is: a landing after a reload (revealOnlyPath) still only reveals.
  const [screenLink, setScreenLink] = useState<IssuePath | null>(null);
  if (focusPath !== screenLink) {
    setScreenLink(focusPath);
    if (focusPath) follow(focusPath);
  }
  useIssueFocus(linked, { root, reveal });

  const selectSize = (next: string) => {
    setSize(next);
    onFocusChange?.({ size: next });
  };

  const onRejected = (key: string, problem: EntryProblem | null) =>
    setRejected((current) => {
      const next = { ...current };
      if (problem) next[key] = problem;
      else delete next[key];
      return next;
    });

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
            page={pages[shown] ?? 0}
            onPage={(page) => setPages((current) => ({ ...current, [shown]: page }))}
            // A new array for every click, so the same link twice still works.
            onIssue={(path) => follow([...path])}
            rejected={Object.values(rejected)}
            onRejected={onRejected}
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
  /** The box list's page, from 0 (Capture keeps it, so an issue link can turn it). */
  page: number;
  onPage: (page: number) => void;
  /** Follows a link under the box list: its box's page turns before the focus moves. */
  onIssue: (path: IssuePath) => void;
  /** Box numbers the cells refused, every size's (keys `size:index`). */
  rejected: readonly EntryProblem[];
  onRejected: (key: string, problem: EntryProblem | null) => void;
};

/** A box with defects counted, waiting for its Delete to be confirmed. */
type PendingRemoval = { index: number; name: string; counted: number };

// The box list's heading cells, padded as their columns' contents are.
const HEAD = "px-3 py-2 text-left font-medium whitespace-nowrap";

/** A press that leaves the focus where it is, as the carton list's Delete. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

function SafedonSizePanel({
  size,
  props,
  update,
  active,
  onActive,
  requested,
  onRequest,
  page,
  onPage,
  onIssue,
  rejected,
  onRejected,
}: PanelProps) {
  const { data, config, title, labels, context, evaluation, readOnly, onFocusChange } = props;
  const uid = useId();
  const boxes = boxesOf(data, size);
  const planned = plannedBoxes(context, config, size);
  const columns = columnsShown(planned, boxes.length, requested);
  // The column counted on iPad: the one asked for, within the columns shown.
  const counted = Math.min(Math.max(active, 0), Math.max(columns - 1, 0));
  const codes = config.defects.map((defect) => defect.code);
  // A module whose config or data is broken comes back with no computed values.
  const computed = evaluation?.computed.sizes?.[size];
  const result = evaluation?.result.perSize?.[size];
  const sizeName = formatSize(size, { sizes: context.templateSizes, prefix: true });
  const boxLabel = labelFor(labels, "boxNo");
  // calc's problems in this size's boxes, such as a count under a defect the template does not list.
  const issues = boxIssues(evaluation?.issues ?? [], size);
  const addButton = useRef<HTMLButtonElement>(null);
  const indices = Array.from({ length: columns }, (_, index) => index);
  // The list's page, the last one when rows have gone since it was turned.
  const pageCount = Math.max(1, Math.ceil(columns / BOXES_PER_PAGE));
  const shownPage = Math.min(Math.max(page, 0), pageCount - 1);
  const first = shownPage * BOXES_PER_PAGE;
  const rows = indices.slice(first, first + BOXES_PER_PAGE);
  const boxNoAt = (index: number) => boxes[index]?.boxNo ?? null;
  const boxFieldId = (index: number) => `${uid}-box-${index}`;
  // Enter walking down the box numbers moves the focus, never the box counted: the box just typed
  // stays chosen, so its defects are tapped into its own column. Set for the frame of the key press.
  const walking = useRef(false);
  const onListKeyDownCapture = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    walking.current = true;
    requestAnimationFrame(() => {
      walking.current = false;
    });
  };
  // A refused box number is listed while its cell stays empty, in list order.
  const problems = rejected
    .filter((problem) => {
      const [owner, index] = problem.key.split(":");
      return owner === size && boxNoAt(Number(index)) === null;
    })
    .sort((a, b) => Number(a.key.split(":")[1]) - Number(b.key.split(":")[1]));
  const reject = (index: number, entry: InvalidEntry | null) => {
    const key = `${size}:${index}`;
    onRejected(key, entry ? { key, label: `${boxLabel}, No. ${index + 1}`, entry, inputId: boxFieldId(index) } : null);
  };
  // The screen's refused entries, by issue path: a Delete moves the boxes below it up, so theirs go.
  const refusedStore = useRefusedEntryStore();
  // A column without a box number yet shows its place in brackets, never a number that reads as a box.
  const columnLabel = (index: number) => {
    const boxNo = boxNoAt(index);
    return boxNo === null ? `(${index + 1})` : String(boxNo);
  };
  /** A row as Delete and its dialog name it: "Box 313", or "No. 14" while it has no box number. */
  const rowName = (index: number) => {
    const boxNo = boxNoAt(index);
    return boxNo === null ? `No. ${index + 1}` : `Box ${boxNo}`;
  };
  const tag = (index: number, defect?: string) => {
    const boxNo = boxNoAt(index);
    onFocusChange?.({ size, ...(boxNo === null ? {} : { box: boxNo }), ...(defect === undefined ? {} : { defect }) });
  };
  const select = (index: number) => {
    onActive(index);
    tag(index);
  };

  // A polite live region; a repeat alternates a trailing no-break space, so it is said again.
  const [spoken, setSpoken] = useState("");
  const announce = (text: string) => setSpoken((current) => (current === text ? `${text}\u00a0` : text));
  // Kept while the dialog closes, so its words stay put as it fades.
  const [pending, setPending] = useState<PendingRemoval | null>(null);
  const [confirming, setConfirming] = useState(false);
  // A row deleted from the keyboard, until the list without it is on screen.
  const refocus = useRef<number | null>(null);

  const removeId = (index: number) => `${uid}-remove-${index}`;
  /** The focus after a deletion: the Delete now in the same row, else the one above, else Add Box. */
  const focusAfterRemoval = (index: number) => {
    const target = document.getElementById(removeId(index)) ?? document.getElementById(removeId(index - 1)) ?? addButton.current;
    target?.focus();
  };
  useLayoutEffect(() => {
    const index = refocus.current;
    if (index === null) return;
    refocus.current = null;
    focusAfterRemoval(index);
  });

  /**
   * Deletes box column `index`: the boxes below move up and renumber, and
   * the counts' columns with them. The list never drops below the plan, so
   * the plan's blank row comes back at the end. The box chosen stays chosen.
   */
  const removeBox = (index: number) => {
    const name = rowName(index);
    const after = activeAfterRemoval(counted, index, Math.max(planned, columns - 1));
    // The box at that place once the column is gone tags new photos: never a box deleted.
    const moved = index < boxes.length && after >= index ? 1 : 0;
    const boxNo = boxes[after + moved]?.boxNo ?? null;
    for (let row = index; row < columns; row += 1) {
      refusedStore?.set(["sizes", size, "boxes", row, "boxNo"], null);
      reject(row, null);
    }
    update((current) => removeSafedonBox(current, size, index));
    onRequest(columns - 1);
    onActive(after);
    onFocusChange?.({ size, ...(boxNo === null ? {} : { box: boxNo }) });
    announce(`${name} removed.`);
  };

  /** A row's Delete: at once, as a carton number, unless the box has defects counted. */
  const askRemove = (index: number, button: HTMLButtonElement) => {
    const box = boxes[index];
    // Every count stored, a code the template no longer lists included: all go with the box.
    const stored = box ? boxDefects(box, Object.keys(box.counts)) : 0;
    if (stored > 0) {
      setPending({ index, name: rowName(index), counted: stored });
      setConfirming(true);
      return;
    }
    // Rows are keyed by place: the Delete keeps the focus where its row still offers one.
    if (button.ownerDocument.activeElement === button) refocus.current = index;
    removeBox(index);
  };

  /**
   * Adds a row and puts the focus in its box number, ready to type. The row is
   * rendered within the press (flushSync), so the focus moves inside it and
   * the iPad's keypad comes up.
   */
  const addBox = () => {
    const index = columns;
    flushSync(() => {
      onRequest(columns + 1);
      onActive(index);
      onPage(boxPageOf(index));
    });
    document.getElementById(boxFieldId(index))?.focus();
    announce(`No. ${index + 1} added.`);
  };

  return (
    <div className="min-w-0 space-y-5">
      {planned === 0 && (
        <p className="rounded-lg border border-dashed border-not-done-border bg-not-done-tint px-4 py-3 text-sm text-not-done touch:text-base">
          {result?.summary}
        </p>
      )}

      <ModuleSection title={boxLabel}>
        {columns > 0 && (
          // An EnterGroup: Enter walks down the box numbers, a pasted column fills down them.
          <EnterGroup onKeyDownCapture={onListKeyDownCapture} className="overflow-hidden rounded-lg bg-card ring-1 ring-border">
            <table className="w-full text-sm tabular-nums touch:text-base">
              <caption className="sr-only">{`${boxLabel}, ${sizeName}`}</caption>
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th scope="col" className={cn(HEAD, "w-16")}>
                    No.
                  </th>
                  {/* Right-aligned, 10 px in, as the typed box number is (its cell has no padding of its own). */}
                  <th scope="col" className={cn(HEAD, "w-36 px-2.5 text-right touch:w-40")}>
                    {boxLabel}
                  </th>
                  {/* Beside the box number, not across the card from it (Kenneth, 12 October 2026: no empty gaps). */}
                  <th scope="col" className={cn(HEAD, "w-52 touch:w-60")}>
                    {labelFor(labels, "boxDefects")}
                  </th>
                  {/* The rest of the width: Delete at the row's end; an empty spacer when read-only. */}
                  <th scope="col" className={cn(HEAD, "text-right")} aria-hidden={readOnly || undefined}>
                    {!readOnly && <span className="sr-only">Delete</span>}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((index) => {
                  const box = boxes[index];
                  const filled = box !== undefined && !isBlankSafedonBox(box);
                  return (
                    <tr
                      key={index}
                      // A link to anything about this box without a cell of its own (a count under a
                      // defect the template does not list) lands on its No.
                      {...issuePathProps(["sizes", size, "boxes", index])}
                      // Colours only, never a size: a row chosen as the finger lands moves nothing under it.
                      data-active={index === counted || undefined}
                      // On click, never on pointerdown: a scroll or a swipe never chooses. Only a click
                      // inside the row itself counts, never one React bubbles up from a portal.
                      onClick={(event) => {
                        if (event.currentTarget.contains(event.target as Node)) select(index);
                      }}
                      className="group/row cursor-pointer border-t border-border data-active:bg-brand-50"
                    >
                      <td className="px-2 py-0.5 group-last/row:pb-1 group-data-active/row:shadow-[inset_3px_0_0_var(--color-brand-500)]">
                        {/* Chooses its row through the row's click. Out of the Tab order: the keyboard
                            chooses a row by focusing its box number; an issue link lands here. Outset focus
                            ring, as SizeTabs' filled tab: the pressed button is brand-500, where an inset
                            brand-500 ring would vanish. The cell's 8 px side padding holds it inside the
                            frame, and the last row's 4 px below it: the frame clips (its round corners). */}
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-pressed={index === counted}
                          aria-label={`Count Column ${index + 1}`}
                          className="inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-md px-1 text-sm font-semibold text-muted-foreground tabular-nums outline-none hover:bg-accent focus-ring aria-pressed:bg-primary aria-pressed:text-primary-foreground touch:h-11 touch:min-w-11 touch:text-base"
                        >
                          {index + 1}
                        </button>
                      </td>
                      <td className="p-0">
                        <BoxNumberField
                          id={boxFieldId(index)}
                          variant="cell"
                          group="boxNo"
                          label={`${boxLabel}, No. ${index + 1}`}
                          value={boxNoAt(index)}
                          onValueChange={(boxNo) => {
                            update((current) => setSafedonBoxNo(current, size, index, boxNo));
                            onActive(index);
                            onFocusChange?.({ size, ...(boxNo === null ? {} : { box: boxNo }) });
                          }}
                          onInvalidChange={(entry) => reject(index, entry)}
                          error={findIssue(issues, ["sizes", size, "boxes", index, "boxNo"])?.message}
                          onFocus={() => {
                            if (!walking.current) select(index);
                          }}
                          issuePath={["sizes", size, "boxes", index, "boxNo"]}
                          readOnly={readOnly}
                        />
                      </td>
                      {/* The same total as the box's column in the counts: the template's defects only. */}
                      <td className="px-3 whitespace-nowrap">
                        {filled ? formatRatio(boxDefects(box, codes), config.glovesPerPack) : <Figure value={null} />}
                      </td>
                      <td className="px-2 py-0.5 text-right">
                        {!readOnly && canRemoveBox(index, boxes, planned) && (
                          <Button
                            id={removeId(index)}
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            data-remove=""
                            title="Delete"
                            aria-label={`Delete ${rowName(index)}`}
                            onMouseDown={keepFocus}
                            onClick={(event) => {
                              // Deleting a row never chooses it.
                              event.stopPropagation();
                              // A double click's second click would delete the box moved up into this row.
                              if (event.detail > 1) return;
                              askRemove(index, event.currentTarget);
                            }}
                            className="text-destructive hover:bg-fail-tint hover:text-destructive"
                          >
                            <Trash2Icon aria-hidden />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </EnterGroup>
        )}
        {(!readOnly || pageCount > 1) && (
          <div className="relative flex flex-wrap items-center justify-between gap-2">
            {!readOnly && (
              <Button
                ref={addButton}
                type="button"
                variant="ghost"
                size="sm"
                className="border border-dashed border-input"
                disabled={columns >= MAX_BOXES_PER_SIZE}
                onClick={addBox}
              >
                <PlusIcon aria-hidden />
                Add Box
              </Button>
            )}
            {/* Only the list's own controls turn its page: Previous and Next Box and the counts never
                do, so nothing jumps under the finger while boxes are counted. */}
            {pageCount > 1 && (
              <nav
                aria-label={`${boxLabel}, ${sizeName}: pages`}
                className="ml-auto flex flex-wrap items-center gap-2 text-sm text-muted-foreground touch:text-base"
              >
                <p className="tabular-nums">
                  {first + 1}–{first + rows.length} of {columns}
                </p>
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title="Previous Page"
                    aria-label="Previous Page"
                    disabled={shownPage === 0}
                    onClick={() => onPage(shownPage - 1)}
                  >
                    <ChevronLeftIcon aria-hidden />
                  </Button>
                  {Array.from({ length: pageCount }, (_, number) => (
                    <Button
                      key={number}
                      type="button"
                      variant={number === shownPage ? "secondary" : "ghost"}
                      size="icon-sm"
                      aria-label={`Page ${number + 1}`}
                      aria-current={number === shownPage ? "page" : undefined}
                      onClick={() => onPage(number)}
                      className="tabular-nums"
                    >
                      {number + 1}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title="Next Page"
                    aria-label="Next Page"
                    disabled={shownPage === pageCount - 1}
                    onClick={() => onPage(shownPage + 1)}
                  >
                    <ChevronRightIcon aria-hidden />
                  </Button>
                </div>
              </nav>
            )}
            {!readOnly && (
              <span className="sr-only" aria-live="polite">
                {spoken}
              </span>
            )}
          </div>
        )}
        <EntryProblems problems={problems} />
        <IssueLinks issues={issues} onIssue={onIssue} />
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
              previousLabel="Previous Box"
              nextLabel="Next Box"
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
              name: boxNo === null ? `Column ${index + 1}` : `Box ${boxNo}`,
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

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        {pending && (
          <AlertDialogContent
            // A swipe on the dialog never turns the size behind it.
            data-no-swipe=""
            onCloseAutoFocus={(event) => {
              // Opened from code: Radix has no trigger to go back to. Cancelled, this finds the same Delete.
              event.preventDefault();
              focusAfterRemoval(pending.index);
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {pending.name}?</AlertDialogTitle>
              <AlertDialogDescription className="text-base fine:text-sm">
                {pending.counted === 1
                  ? "Its 1 counted defect is deleted with it."
                  : `Its ${pending.counted} counted defects are deleted with it.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
              <AlertDialogAction
                type="button"
                variant="destructive"
                // Once only: a second press while the dialog fades would delete the box moved up.
                onClick={() => confirming && removeBox(pending.index)}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  );
}

/** calc's issues about a size's boxes (`["sizes", size, "boxes", ...]`), in column order. */
function boxIssues(issues: readonly ValidationIssue[], size: string): ValidationIssue[] {
  return issues.filter((issue) => issue.path[0] === "sizes" && issue.path[1] === size && issue.path[2] === "boxes");
}

/**
 * calc's problems in the boxes, each with a link to its box (BUILD_SPEC 6.2),
 * listed as the carton list and labelling list their own: a cell only turns
 * red, and its message is read to screen readers alone. The size's Passed or
 * Failed stays calc's. A link turns the box list to its box's page and
 * chooses the box before the focus moves.
 */
function IssueLinks({ issues, onIssue }: { issues: readonly ValidationIssue[]; onIssue: (path: IssuePath) => void }) {
  if (issues.length === 0) return null;
  return (
    <ul data-slot="box-issues" className="space-y-1">
      {issues.map((issue) => (
        <li key={`${issue.code}-${issue.path.join("/")}`}>
          <button
            type="button"
            onClick={() => onIssue(issue.path)}
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
