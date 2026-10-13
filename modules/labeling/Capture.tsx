"use client";

// Packaging labelling on the capture screen: a tab per ordered size, the
// levels the template inspects side by side from 1280 px. Per level: the
// boxes inspected (one tap records the planned n, then a stepper), their
// box/carton numbers (optional, typed on the numeric keypad with the size's
// sampled box/carton numbers suggested as they are typed: 6.2 rule 7;
// Kenneth, 13 October 2026), and a counter per check with the live total and
// the Accept 0 / Reject 1 chip. A box/carton number not sampled for the size
// is calc's warning, listed under the fields with a link to its field as the
// other box problems are. Every edit goes through useDataUpdater
// (docs/CAPTURE_KIT.md), built from the latest data, so edits in one event
// never undo each other.
import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { CheckIcon, Trash2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  BoxNumberField,
  CounterTable,
  EntryProblems,
  findIssue,
  focusIssuePath,
  issuePathProps,
  ModuleSection,
  SizeTabs,
  StatusIcon,
  Stepper,
  useDataUpdater,
  useIssueFocus,
  useRefusedEntryStore,
  type DataChange,
  type EntryProblem,
} from "@/components/qc";
import { STATUS_LABEL } from "@/lib/design/status";
import { boxCartonNumber, formatSize } from "@/lib/format";
import { cartonsFor, initialSize, labelFor, type CaptureProps, type Labels } from "@/modules/_framework";
import { sizeOnTabs, useReportShownSize } from "@/modules/_framework/shown-size";
import type { LabelingComputed, LabelingConfig, LabelingData } from ".";
import { checkLabel, includedLevels, levelFieldLabel, levelLabel } from "./calc";
import type { LabelingCheck, LabelingLevel } from "./config";
import { boxFields, levelEntry, withAddedBox, withBox, withDefectCount, withInspected } from "./edit";

type Props = CaptureProps<LabelingData, LabelingConfig, LabelingComputed>;

type LevelPanelProps = Omit<Props, "onChange" | "focusPath"> & {
  /** Applies an edit to the latest data (useDataUpdater). */
  update: (change: DataChange<LabelingData>) => void;
  size: string;
  level: LabelingLevel;
};

/** Most boxes the stepper counts to. */
const MAX_INSPECTED = 999;

/** A press that leaves the focus where it is, as the carton list's Delete. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

export default function Capture({ onChange, focusPath, ...props }: Props) {
  const { data, config, context, evaluation, onFocusChange } = props;
  const update = useDataUpdater(data, onChange);
  const root = useRef<HTMLDivElement>(null);
  // Opens on the size chosen in the last module; SizeTabs corrects a size that is not (or no longer) ordered.
  const [size, setSize] = useState(() => initialSize(context, props.focus));
  const levels = includedLevels(config);
  // The size on the tabs tags the photos taken now (BUILD_SPEC 8.1), from the moment the section opens.
  useReportShownSize(levels.length === 0 ? null : sizeOnTabs(context.sizes, size), onFocusChange);

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
  const where = `${name}, ${formatSize(size, { sizes: context.templateSizes, prefix: true })}`;
  const path = ["sizes", size, level];
  const issues = evaluation?.issues ?? [];
  const inspectedIssue = findIssue(issues, [...path, "inspected"]);
  // Every box problem calc finds (a number entered twice at the carton level, more numbers than boxes inspected,
  // a number not sampled for the size) is listed under the fields, each a link to its field.
  const boxIssues = issues.filter(
    (issue) =>
      issue.path.length >= 4 &&
      path.every((segment, index) => issue.path[index] === segment) &&
      issue.path[3] === "boxNos",
  );
  const fields = boxFields(entry, levelConfig.n, readOnly);
  // The size's sampled box/carton numbers, suggested in each field, and the level's numbers, marked where used.
  const cartons = cartonsFor(context, size);
  const boxLabel = labelFor(labels, "boxNos");
  const boxList = useRef<HTMLDivElement>(null);
  const inspectedLabel = labelFor(labels, "inspected");
  const countRow = useRef<HTMLDivElement>(null);
  // The size whose Record button had keyboard focus: the stepper that replaces the button takes it over.
  const focusStepper = useRef<string | null>(null);
  const fieldId = (index: number) => `labeling-${level}-${size}-box-${index}`;
  /** calc's problem with one field's number: a warning (a number not sampled) turns it amber, an error red. */
  const fieldMessages = (index: number) => {
    const issue = findIssue(issues, [...path, "boxNos", index]);
    return {
      error: issue?.level === "error" ? issue.message : null,
      warning: issue?.level === "warning" ? issue.message : null,
    };
  };
  // The screen's refused entries, by issue path: a Delete moves the boxes after it, so their entries go.
  const refusedStore = useRefusedEntryStore();
  // A box/carton number field to focus once the list has rendered: the next empty one after Enter, or the
  // field in a deleted box's place.
  const focusField = useRef<{ size: string; index: number } | null>(null);
  // Box/carton numbers the fields refused, by `size:index`, listed under the fields with a link. A refusal in a
  // field that holds a box leaves the box as it was, listed until that field is typed in again.
  const [refused, setRefused] = useState<Readonly<Record<string, EntryProblem>>>({});
  const problems = Object.values(refused)
    .filter((problem) => problem.key.startsWith(`${size}:`))
    .sort((a, b) => Number(a.key.split(":")[1]) - Number(b.key.split(":")[1]));
  const setRefusal = (index: number, problem: Omit<EntryProblem, "key"> | null) =>
    setRefused((current) => {
      const key = `${size}:${index}`;
      if (problem === null && !(key in current)) return current;
      const next = { ...current };
      if (problem) next[key] = { ...problem, key };
      else delete next[key];
      return next;
    });

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

  useLayoutEffect(() => {
    const pending = focusField.current;
    if (pending === null || pending.size !== size) return;
    const field = document.getElementById(fieldId(pending.index));
    if (!field) return;
    focusField.current = null;
    field.focus();
  });

  /** Asks for a field's focus after the next render; given up a frame later if that field never comes. */
  const focusAfterRender = (index: number) => {
    focusField.current = { size, index };
    requestAnimationFrame(() => {
      if (focusField.current?.size === size && focusField.current.index === index) focusField.current = null;
    });
  };

  /** Deletes a box: the boxes after it move up a place. A Delete with the keyboard focus hands it to the field now there. */
  const removeBox = (index: number, button: HTMLButtonElement) => {
    if (button.ownerDocument.activeElement === button) focusAfterRender(index);
    // The refused entries were by place, which has moved: they go.
    setRefused((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${size}:`))));
    for (let at = index; at < fields.length; at += 1) refusedStore?.set([...path, "boxNos", at], null);
    update((current) => withBox(current, size, level, index, null));
  };

  return (
    // @container: the count row measures the frame its counter table does.
    <ModuleSection title={name} issuePath={path} className="@container xl:border-t-0 xl:pt-0">
      <div className="space-y-1.5">
        <div
          ref={countRow}
          // The label over the counter table's label column and the count over its one count column
          // (CounterTable's VALUE_WIDTH.one: narrower in a frame under 28rem), side by side.
          className="grid grid-cols-[minmax(0,1fr)_11rem] items-center touch:grid-cols-[minmax(0,1fr)_13rem] @max-md:grid-cols-[minmax(0,1fr)_8rem]"
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

      {fields.length > 0 && (
        <div ref={boxList} className="space-y-1.5" {...issuePathProps([...path, "boxNos"])}>
          <span className="block text-sm font-medium text-foreground touch:text-base">{boxLabel}</span>
          <div className="flex flex-wrap items-start gap-2">
            {fields.map((box, index) => (
              <div
                // By size and place: the field a box was typed in stays, with the focus, and a refused
                // entry never shows in another size's field.
                key={`${size}:${index}`}
                className="flex items-center gap-0.5"
                onKeyDown={(event) => {
                  // Enter in the empty field: the next empty field, once the box is in, takes the focus.
                  if (box === null && event.key === "Enter" && !event.shiftKey) focusAfterRender(index + 1);
                }}
                // Typing in a box's field again lets go of the reason listed for its last refusal: the box
                // never changed, so retyping it (or anything valid) leaves nothing to list. The empty
                // field's refusal is the field's own text, and goes with it.
                onInput={() => {
                  if (box !== null) setRefusal(index, null);
                }}
              >
                <BoxNumberField
                  id={fieldId(index)}
                  hideLabel
                  // Its own message would wrap in this narrow field: refused entries and calc's problems are
                  // listed full width below, and the text stays for screen readers.
                  className="w-28 space-y-0 [&_p]:sr-only touch:w-32"
                  group={`${level}-boxNos`}
                  label={`${boxLabel}, No. ${index + 1}, ${where}`}
                  value={box}
                  cartons={cartons}
                  used={entry.boxNos}
                  {...fieldMessages(index)}
                  onValueChange={(next) => {
                    if (box === null) {
                      if (next !== null) update((current) => withAddedBox(current, size, level, next));
                      return;
                    }
                    // Cleared or refused, a box stays as it was: Delete takes it off.
                    if (next === null) return;
                    setRefusal(index, null);
                    update((current) => withBox(current, size, level, index, next));
                  }}
                  onInvalidChange={(invalid) => {
                    if (invalid) setRefusal(index, { label: `${boxLabel}, No. ${index + 1}`, entry: invalid, inputId: fieldId(index) });
                    // A box's own refusal stays listed until its field is typed in again; the empty field's goes with its text.
                    else if (box === null) setRefusal(index, null);
                  }}
                  onFocus={() => onFocusChange?.(box === null ? { size, level } : { size, level, box })}
                  issuePath={[...path, "boxNos", index]}
                  readOnly={readOnly}
                />
                {box !== null && !readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title="Delete"
                    aria-label={`Delete ${boxCartonNumber(box)}, ${where}`}
                    onMouseDown={keepFocus}
                    onClick={(event) => removeBox(index, event.currentTarget)}
                    className="text-destructive hover:bg-fail-tint hover:text-destructive"
                  >
                    <Trash2Icon aria-hidden />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <EntryProblems problems={problems} />
          {boxIssues.length > 0 && (
            <ul data-slot="box-issues" className="space-y-1">
              {boxIssues.map((issue) => (
                <li key={`${issue.code}:${issue.path.join("/")}`}>
                  {/* A link to the field the problem is about, as the dispensing checks list their own; one
                      about the numbers as a whole lands on the first field. Looked for from the list's parent,
                      so the list's own mark counts. */}
                  <button
                    type="button"
                    onClick={() => {
                      const root = boxList.current?.parentElement;
                      if (root) focusIssuePath(root, issue.path);
                    }}
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
          )}
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
          limitAccept: limitWord(labels, level, "accept"),
          limitReject: limitWord(labels, level, "reject"),
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

/**
 * A level's word in its limit row, where a template words one level's limit
 * apart: its key level first, as the dictionary keys level wording
 * (`innerAccept`, like `innerResult`), else a dotted key added in the editor
 * (`inner.accept`), else the word both levels share (docs/CAPTURE_KIT.md).
 */
function limitWord(labels: Labels, level: LabelingLevel, word: "accept" | "reject"): string {
  const own = labels[`${level}${word === "accept" ? "Accept" : "Reject"}`];
  return own !== undefined && own.trim() !== "" ? own : labelFor(labels, level, word);
}
