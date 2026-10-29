"use client";

// Glove Packing Check capture (BUILD_SPEC 6.1, 8 "Speed"): one size at a time
// (swipe on iPad, arrow keys on desktop), one row per dispenser box. The
// box/carton number, the layering and the dispensing % are typed on the
// numeric keypad, Enter going down the column and a pasted column filling
// down it; the box/carton number suggests the size's sampled box/carton
// numbers as it is typed (6.2 rule 7; Kenneth, 13 October 2026), those in
// other rows marked. The stickiness code is picked from the template's codes.
// Averages and Passed / Failed come from calc as you type, read-only (rule
// 2). Wording comes from the template (rule 11). An entry a cell refuses, and
// any problem calc finds in a row (a box/carton number not sampled for the
// size is a warning), is listed under the table with a link to its cell: the
// cell itself only turns red or amber. Every write goes through
// useDataUpdater, starting from the latest data: a pasted column reaches the
// screen as one change with every value (docs/CAPTURE_KIT.md). Under the
// boxes, each size's aged sample has a section of its own (Kenneth, 26
// October 2026): one row of the same values with no box/carton number, its
// own Passed / Failed once judged, never one of the boxes. Every size needs
// one (27 October 2026): Not Done while empty, read-only too, with calc's
// warning under it once the boxes are complete. "Aged Sample?" heads each
// size's section, one answer for the step (Kenneth, 30 October 2026): No
// hides the row, the sizes complete on their boxes, and values saved in it
// are kept, not counted.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { ChevronDownIcon, PlusIcon } from "lucide-react";
import {
  BoxNumberField,
  EnterGroup,
  EntryProblems,
  findIssue,
  focusIssuePath,
  issuePathProps,
  ModuleSection,
  PercentField,
  RequirementList,
  SizeTabs,
  StatusIcon,
  StatusPill,
  useDataUpdater,
  useIssueFocus,
  type DataChange,
  type EntryProblem,
  type InvalidEntry,
} from "@/components/qc";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatSize, formatSpec } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  cartonsFor,
  initialSize,
  labelFor,
  type CaptureProps,
  type Labels,
  type ValidationIssue,
} from "@/modules/_framework";
import { sizeOnTabs, useReportShownSize } from "@/modules/_framework/shown-size";
import type { DispensingPackingComputed, DispensingPackingConfig, DispensingPackingData } from ".";
import { AVERAGE_DECIMALS, boxesLineOf, packingHeading, plannedBoxes, type AgedSampleComputed } from "./calc";
import { MAX_BOXES_PER_SIZE } from "./config";
import {
  agedSampleAnswerOf,
  agedSampleOf,
  boxesOf,
  rowsShown,
  setAgedSampleAnswer,
  updateAgedSample,
  updatePackingBox,
} from "./edit";
import {
  AGED_SAMPLE_ANSWERS,
  emptyPackingBox,
  isBlankAgedSample,
  type AgedSampleAnswer,
  type PackingAgedSample,
  type PackingBox,
} from "./schema";
import { plainLabel } from "./text";

type Props = CaptureProps<DispensingPackingData, DispensingPackingConfig, DispensingPackingComputed>;
type Update = (change: DataChange<DispensingPackingData>) => void;
type PercentKey = "layeringPct" | "dispensingPct";
/** The typed cells of a row: the box/carton number and the two percentages. */
type TypedKey = "boxNo" | PercentKey;
type Rejected = (field: PercentKey, entry: InvalidEntry | null, problem: Pick<EntryProblem, "label" | "inputId">) => void;

/** The aged sample's part of a refused entry's key ("M:agedSample:layeringPct"); a box's is its field ("M:boxNo:3"). */
const AGED = "agedSample";

// A heading on one line, padded as its cells' contents are (px-2.5), so it lines up with them.
const HEAD =
  "border-b border-border bg-slate-50 px-2.5 py-2 text-left align-bottom font-semibold whitespace-nowrap text-foreground";
const CELL = "border-b border-l border-border p-0 align-middle";
// The aged sample's one row sits in its frame: no rule under it, none left of its first cell.
const AGED_CELL = "border-l border-border p-0 align-middle first:border-l-0";

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
  // Rows asked for with "Add Box", per size, beyond the plan.
  const [requested, setRequested] = useState<Record<string, number>>({});
  // Entries the cells refused ("2 42"), listed under the table with a link.
  const [rejected, setRejected] = useState<Record<string, EntryProblem>>({});

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
        {packingHeading(labels, config, evaluation?.computed.codeLetters ?? [])}
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
          <PackingSizePanel
            size={shown}
            props={{ data, config, title, labels, context, evaluation, readOnly, onFocusChange }}
            update={update}
            requested={requested[shown] ?? 0}
            onRequest={(rows) => setRequested((current) => ({ ...current, [shown]: rows }))}
            rejected={Object.values(rejected)}
            onRejected={onRejected}
          />
        )}
      </SizeTabs>
      <StickinessLegend labels={labels} config={config} />
    </div>
  );
}

type PanelProps = {
  size: string;
  props: Pick<Props, "data" | "config" | "title" | "labels" | "context" | "evaluation" | "readOnly" | "onFocusChange">;
  update: Update;
  requested: number;
  onRequest: (rows: number) => void;
  rejected: readonly EntryProblem[];
  onRejected: (key: string, problem: EntryProblem | null) => void;
};

function PackingSizePanel({ size, props, update, requested, onRequest, rejected, onRejected }: PanelProps) {
  const { data, config, title, labels, context, evaluation, readOnly, onFocusChange } = props;
  const boxes = boxesOf(data, size);
  const planned = plannedBoxes(context, config, size);
  const rows = rowsShown(planned, boxes.length, requested);
  // A module whose config or data is broken comes back with no computed values.
  const computed = evaluation?.computed.sizes?.[size];
  const result = evaluation?.result.perSize?.[size];
  const sizeName = formatSize(size, { sizes: context.templateSizes, prefix: true });
  const issues = evaluation?.issues ?? [];
  // calc's problems in this size's rows, such as a stickiness code the template does not have.
  const rowIssues = boxIssues(issues, size);
  const keyOf = (field: TypedKey, index: number) => `${size}:${field}:${index}`;
  // The size's sampled box/carton numbers, suggested in each row, and every row's number, marked where used.
  const cartons = cartonsFor(context, size);
  const used = boxes.map((box) => box.boxNo);
  const panel = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLTableSectionElement>(null);
  const headHeight = useHeadHeight(head);
  const passing = config.stickinessCodes.filter((entry) => entry.pass).map((entry) => entry.code);
  const aged = agedSampleOf(data, size);
  const agedKeyOf = (field: PercentKey) => `${size}:${AGED}:${field}`;
  // A refused entry is listed while its cell stays empty: a box's under the table, the aged sample's under its own.
  const problems = rejected.filter((problem) => {
    const [owner, field, index] = problem.key.split(":");
    const box = boxes[Number(index)];
    return owner === size && field !== AGED && (box?.[field as TypedKey] ?? null) === null;
  });
  const agedProblems = rejected.filter((problem) => {
    const [owner, part, field] = problem.key.split(":");
    return owner === size && part === AGED && (aged[field as PercentKey] ?? null) === null;
  });
  // The boxes' line of calc's summary, while the boxes are not done (whatever a failed aged sample makes the
  // size); the aged sample shows its own state. Without computed values, while the size is not done.
  const boxesNotDone = computed ? computed.layeringResult === "not_done" : result?.status === "not_done";
  const boxesLine = boxesLineOf(result?.summary ?? "");

  return (
    <div ref={panel} className="min-w-0 space-y-4">
      {planned === 0 && (
        <p className="rounded-lg border border-dashed border-not-done-border bg-not-done-tint px-4 py-3 text-sm text-not-done touch:text-base">
          {boxesLine}
        </p>
      )}
      <EnterGroup className="relative overflow-clip rounded-lg border border-border bg-card">
        <table
          // The heading row's height, measured, for the scroll margin below it.
          style={headHeight === null ? undefined : ({ "--packing-head": `${headHeight}px` } as CSSProperties)}
          className="w-full border-separate border-spacing-0 text-sm touch:text-base"
        >
          <caption className="sr-only">{`${title}, ${sizeName}`}</caption>
          {/* The item and the box as wide as their contents. The two percentages and the
              stickiness code an equal share of the table, never narrower than their headings on
              one line (table auto layout); the notes what is left, about a third to two fifths. */}
          <colgroup>
            <col className="w-12 touch:w-14" />
            <col className="w-[6.5rem] touch:w-28" />
            <col className="w-[15%]" />
            <col className="w-[15%]" />
            <col className="w-[15%]" />
            <col />
          </colgroup>
          {/* The column headings stay below the size bar while the 13 rows scroll
              (the frame clips rather than scrolls, so sticky still works); a
              cell reached with Enter or Shift+Enter (or Tab) scrolls clear of
              both, by the bar's and the heading row's measured heights. */}
          <thead ref={head} className="sticky top-[calc(var(--capture-sticky-top,0px)_+_var(--size-tabs-bar,0px))] z-[4]">
            <tr>
              <th scope="col" className={cn(HEAD, "text-center")}>
                {labelFor(labels, "itemColumn")}
              </th>
              {/* Right-aligned, as the typed box/carton number below it and the percentages beside it. */}
              <th scope="col" className={cn(HEAD, "border-l text-right")}>
                {labelFor(labels, "boxNo")}
              </th>
              <th scope="col" className={cn(HEAD, "border-l text-right")}>
                {labelFor(labels, "layeringPct")}
              </th>
              <th scope="col" className={cn(HEAD, "border-l text-right")}>
                {labelFor(labels, "dispensingPct")}
              </th>
              <th scope="col" className={cn(HEAD, "border-l")}>
                {labelFor(labels, "stickiness")}
              </th>
              <th scope="col" className={cn(HEAD, "border-l")}>
                {labelFor(labels, "note")}
              </th>
            </tr>
          </thead>
          <tbody className="[&_:is(input,select,button)]:scroll-mt-[calc(var(--size-tabs-bar,0px)_+_var(--packing-head,3rem))]">
            {Array.from({ length: rows }, (_, index) => (
              <PackingRow
                key={index}
                size={size}
                index={index}
                box={boxes[index] ?? emptyPackingBox()}
                cartons={cartons}
                used={used}
                labels={labels}
                config={config}
                issues={issues}
                readOnly={readOnly}
                onPatch={(patch) => update((current) => updatePackingBox(current, size, index, patch))}
                onFocusBox={(box) => onFocusChange?.({ size, ...(box === null ? {} : { box }) })}
                onRejected={(field, entry, problem) =>
                  onRejected(keyOf(field, index), entry ? { ...problem, key: keyOf(field, index), entry } : null)
                }
              />
            ))}
          </tbody>
        </table>
      </EnterGroup>

      <EntryProblems problems={problems} />
      <IssueLinks issues={rowIssues} root={panel} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        {boxesNotDone && planned > 0 ? <p className="text-sm text-muted-foreground touch:text-base">{boxesLine}</p> : <span />}
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="border border-dashed border-input"
            disabled={rows >= MAX_BOXES_PER_SIZE}
            onClick={() => onRequest(rows + 1)}
          >
            <PlusIcon aria-hidden />
            Add Box
          </Button>
        )}
      </div>

      <RequirementList
        caption={`${title}, ${sizeName}`}
        labels={{ value: labelFor(labels, "layeringAverage"), result: labelFor(labels, "layeringResult") }}
        items={[
          {
            key: "layering",
            label: labelFor(labels, "layeringPct"),
            value: computed?.layeringAverage ?? null,
            unit: "%",
            decimals: AVERAGE_DECIMALS,
            spec: { kind: "min", min: config.minLayeringPct },
            specText: formatSpec({ kind: "min", min: config.minLayeringPct }, { unit: "%" }),
            status: computed?.layeringResult ?? "not_done",
          },
          {
            key: "dispensing",
            label: labelFor(labels, "dispensingPct"),
            value: computed?.dispensingAverage ?? null,
            unit: "%",
            decimals: AVERAGE_DECIMALS,
            spec: { kind: "min", min: config.minDispensingPct },
            specText: formatSpec({ kind: "min", min: config.minDispensingPct }, { unit: "%" }),
            status: computed?.dispensingResult ?? "not_done",
          },
          {
            key: "stickiness",
            label: labelFor(labels, "stickiness"),
            value: null,
            valueText: computed?.stickinessSummary ?? "—",
            specText: passing.join(", "),
            status: computed?.stickinessResult ?? "not_done",
          },
        ]}
      />

      {/* Every size needs its aged sample unless "Aged Sample?" is No: an empty one shows, read-only too, as what
          keeps the size not done. */}
      <AgedSampleSection
        size={size}
        sizeName={sizeName}
        answer={agedSampleAnswerOf(data)}
        onAnswer={(answer) => update((current) => setAgedSampleAnswer(current, answer))}
        sample={aged}
        computed={computed?.agedSample ?? null}
        judged={computed !== undefined}
        labels={labels}
        config={config}
        passing={passing}
        issues={issues}
        problems={agedProblems}
        root={panel}
        readOnly={readOnly}
        onPatch={(patch) => update((current) => updateAgedSample(current, size, patch))}
        onFocus={() => onFocusChange?.({ size })}
        onRejected={(field, entry, problem) =>
          onRejected(agedKeyOf(field), entry ? { ...problem, key: agedKeyOf(field), entry } : null)
        }
      />
    </div>
  );
}

type AgedSampleProps = {
  size: string;
  /** "Size M", as the size's tables are named. */
  sizeName: string;
  /** The step's answer to "Aged Sample?", the same in every size; null while unanswered. */
  answer: AgedSampleAnswer | null;
  onAnswer: (answer: AgedSampleAnswer | null) => void;
  sample: PackingAgedSample;
  /** calc's checks of it; null while nothing is in it (or the engine could not compute the module). */
  computed: AgedSampleComputed | null;
  /** calc judged the size: an aged sample with nothing in it is then Not Done. */
  judged: boolean;
  labels: Labels;
  config: DispensingPackingConfig;
  /** The stickiness codes that pass, for the spec. */
  passing: readonly string[];
  issues: readonly ValidationIssue[];
  problems: readonly EntryProblem[];
  root: RefObject<HTMLElement | null>;
  readOnly: boolean;
  onPatch: (patch: Partial<PackingAgedSample>) => void;
  onFocus: () => void;
  onRejected: Rejected;
};

/**
 * The size's aged sample (Kenneth, 26 October 2026: "give aged sample a
 * special section"): the box table's values in one row, with no box/carton
 * number, then its own Passed / Failed against the same minimums and codes
 * once anything is entered, from calc. calc keeps it out of the boxes'
 * count and averages. Not Done while nothing is in it: every size needs one
 * (27 October 2026). Its refused entries and calc's problems in it (a value
 * still missing, or the whole sample once the boxes are complete, is a
 * warning) are listed under its row. "Aged Sample?" sits beside its heading
 * (Kenneth, 30 October 2026): answered No, the section says there is none,
 * with no row and no status, and that values saved in it are kept but not
 * counted.
 */
function AgedSampleSection({
  size,
  sizeName,
  answer,
  onAnswer,
  sample,
  computed,
  judged,
  labels,
  config,
  passing,
  issues,
  problems,
  root,
  readOnly,
  onPatch,
  onFocus,
  onRejected,
}: AgedSampleProps) {
  const title = labelFor(labels, "agedSample");
  const path = (field: keyof PackingAgedSample) => ["sizes", size, AGED, field];
  const inputId = (field: PercentKey) => `dispensing-packing-${size}-${AGED}-${field}`;
  // A cell turns red for calc's error only: the warning for a value still missing is listed below.
  const errorAt = (field: keyof PackingAgedSample) => {
    const issue = findIssue(issues, path(field));
    return issue?.level === "error" ? issue.message : undefined;
  };
  const percent = (field: PercentKey) => (
    <PercentField
      variant="cell"
      id={inputId(field)}
      label={`${labelFor(labels, field)}, ${title}`}
      value={sample[field]}
      onValueChange={(value) => onPatch(field === "layeringPct" ? { layeringPct: value } : { dispensingPct: value })}
      onInvalidChange={(entry) => onRejected(field, entry, { label: `${title}, ${labelFor(labels, field)}`, inputId: inputId(field) })}
      error={errorAt(field)}
      issuePath={path(field)}
      onFocus={onFocus}
      readOnly={readOnly}
    />
  );

  const question = (
    <AgedSampleQuestion question={`${title}?`} answer={answer} readOnly={readOnly} onAnswer={onAnswer} onFocus={onFocus} />
  );

  if (answer === "no") {
    return (
      <ModuleSection
        title={title}
        description={
          <>
            <p>{`No ${title} for any size.`}</p>
            {!isBlankAgedSample(sample) && <p>Values entered are kept, not counted.</p>}
          </>
        }
        actions={question}
        issuePath={["sizes", size, AGED]}
      />
    );
  }

  return (
    <ModuleSection
      title={title}
      description="Judged on its own: not counted with the boxes or in their averages."
      actions={question}
      status={computed?.result ?? (judged ? "not_done" : undefined)}
      issuePath={["sizes", size, AGED]}
    >
      <EnterGroup className="relative overflow-clip rounded-lg border border-border bg-card">
        <table className="w-full border-separate border-spacing-0 text-sm touch:text-base">
          <caption className="sr-only">{`${title}, ${sizeName}`}</caption>
          {/* The two percentages and the code a fifth each, the notes what is left, as in the box table. */}
          <colgroup>
            <col className="w-1/5" />
            <col className="w-1/5" />
            <col className="w-1/5" />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={cn(HEAD, "text-right")}>
                {labelFor(labels, "layeringPct")}
              </th>
              <th scope="col" className={cn(HEAD, "border-l text-right")}>
                {labelFor(labels, "dispensingPct")}
              </th>
              <th scope="col" className={cn(HEAD, "border-l")}>
                {labelFor(labels, "stickiness")}
              </th>
              <th scope="col" className={cn(HEAD, "border-l")}>
                {labelFor(labels, "note")}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={AGED_CELL}>{percent("layeringPct")}</td>
              <td className={AGED_CELL}>{percent("dispensingPct")}</td>
              <td className={AGED_CELL}>
                <StickinessCell
                  value={sample.stickiness}
                  config={config}
                  label={`${labelFor(labels, "stickiness")}, ${title}`}
                  error={errorAt("stickiness")}
                  issuePath={path("stickiness")}
                  readOnly={readOnly}
                  onFocus={onFocus}
                  onValueChange={(stickiness) => onPatch({ stickiness })}
                />
              </td>
              <td className={AGED_CELL}>
                <NoteCell
                  value={sample.note}
                  label={`${labelFor(labels, "note")}, ${title}`}
                  issuePath={path("note")}
                  readOnly={readOnly}
                  onFocus={onFocus}
                  onValueChange={(note) => onPatch({ note })}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </EnterGroup>

      <EntryProblems problems={problems} />
      <IssueLinks issues={agedSampleIssues(issues, size)} root={root} />

      {computed && (
        <RequirementList
          caption={`${title}, ${sizeName}`}
          labels={{ result: labelFor(labels, "layeringResult") }}
          items={[
            {
              key: "layering",
              label: labelFor(labels, "layeringPct"),
              value: sample.layeringPct,
              unit: "%",
              decimals: AVERAGE_DECIMALS,
              spec: { kind: "min", min: config.minLayeringPct },
              specText: formatSpec({ kind: "min", min: config.minLayeringPct }, { unit: "%" }),
              status: computed.layeringResult,
            },
            {
              key: "dispensing",
              label: labelFor(labels, "dispensingPct"),
              value: sample.dispensingPct,
              unit: "%",
              decimals: AVERAGE_DECIMALS,
              spec: { kind: "min", min: config.minDispensingPct },
              specText: formatSpec({ kind: "min", min: config.minDispensingPct }, { unit: "%" }),
              status: computed.dispensingResult,
            },
            {
              key: "stickiness",
              label: labelFor(labels, "stickiness"),
              value: null,
              valueText: sample.stickiness ?? "—",
              specText: passing.join(", "),
              status: computed.stickinessResult,
            },
          ]}
        />
      )}
    </ModuleSection>
  );
}

const ANSWER_WORDS: Readonly<Record<AgedSampleAnswer, string>> = { yes: "Yes", no: "No" };
const isAnswer = (value: string): value is AgedSampleAnswer => (AGED_SAMPLE_ANSWERS as readonly string[]).includes(value);

type QuestionProps = {
  /** "Aged Sample?", in the template's wording. */
  question: string;
  answer: AgedSampleAnswer | null;
  readOnly: boolean;
  onAnswer: (answer: AgedSampleAnswer | null) => void;
  onFocus: () => void;
};

/**
 * "Aged Sample?" with Yes and No, as a plain form asks yes or no: neither
 * chosen while unanswered, and the answer chosen again clears it. One answer
 * for the step, so every size's section shows the same.
 */
function AgedSampleQuestion({ question, answer, readOnly, onAnswer, onFocus }: QuestionProps) {
  return (
    <div className="flex items-center gap-2" {...issuePathProps(["hasAgedSample"])}>
      {/* The group is named by the same words: read out once. */}
      <span aria-hidden className="text-sm font-medium text-foreground touch:text-base">
        {question}
      </span>
      <ToggleGroup
        type="single"
        variant="outline"
        spacing={0}
        value={answer ?? ""}
        onValueChange={(next) => onAnswer(isAnswer(next) ? next : null)}
        disabled={readOnly}
        aria-label={question}
        onFocus={onFocus}
      >
        {AGED_SAMPLE_ANSWERS.map((value) => (
          <ToggleGroupItem
            key={value}
            value={value}
            className="min-w-16 px-4 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-brand-600"
          >
            {ANSWER_WORDS[value]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

type RowProps = {
  size: string;
  index: number;
  box: PackingBox;
  /** The size's sampled box/carton numbers: the box/carton number's suggestions. */
  cartons: readonly number[];
  /** Every row's box/carton number in the size. */
  used: readonly (number | null)[];
  labels: Labels;
  config: DispensingPackingConfig;
  issues: readonly ValidationIssue[];
  readOnly: boolean;
  onPatch: (patch: Partial<PackingBox>) => void;
  onFocusBox: (box: number | null) => void;
  onRejected: (field: TypedKey, entry: InvalidEntry | null, problem: Pick<EntryProblem, "label" | "inputId">) => void;
};

function PackingRow({
  size,
  index,
  box,
  cartons,
  used,
  labels,
  config,
  issues,
  readOnly,
  onPatch,
  onFocusBox,
  onRejected,
}: RowProps) {
  const item = `${labelFor(labels, "itemColumn")} ${index + 1}`;
  const path = (field: keyof PackingBox) => ["sizes", size, "boxes", index, field];
  // A box/carton number not sampled for the size is a warning (amber), anything else about it an error.
  const boxIssue = findIssue(issues, path("boxNo"));
  const inputId = (field: TypedKey) => `dispensing-packing-${size}-${field}-${index}`;
  const focus = () => onFocusBox(box.boxNo);
  const percent = (field: PercentKey) => (
    <PercentField
      variant="cell"
      group={field}
      id={inputId(field)}
      label={`${labelFor(labels, field)}, ${item}`}
      value={box[field]}
      onValueChange={(value) => onPatch(field === "layeringPct" ? { layeringPct: value } : { dispensingPct: value })}
      onInvalidChange={(entry) =>
        onRejected(field, entry, { label: `${item}, ${labelFor(labels, field)}`, inputId: inputId(field) })
      }
      error={findIssue(issues, path(field))?.message}
      issuePath={path(field)}
      onFocus={focus}
      readOnly={readOnly}
    />
  );

  return (
    <tr {...issuePathProps(["sizes", size, "boxes", index])} className="group/row">
      <th
        scope="row"
        className="border-b border-border px-2 text-center font-normal text-muted-foreground tabular-nums group-has-[:focus-visible]/row:bg-brand-50"
      >
        {index + 1}
      </th>
      <td className={CELL}>
        <BoxNumberField
          variant="cell"
          group="boxNo"
          id={inputId("boxNo")}
          label={`${labelFor(labels, "boxNo")}, ${item}`}
          value={box.boxNo}
          cartons={cartons}
          used={used}
          onValueChange={(boxNo) => {
            onPatch({ boxNo });
            onFocusBox(boxNo);
          }}
          onInvalidChange={(entry) =>
            onRejected("boxNo", entry, { label: `${item}, ${labelFor(labels, "boxNo")}`, inputId: inputId("boxNo") })
          }
          error={boxIssue?.level === "error" ? boxIssue.message : null}
          warning={boxIssue?.level === "warning" ? boxIssue.message : null}
          issuePath={path("boxNo")}
          onFocus={focus}
          readOnly={readOnly}
        />
      </td>
      <td className={CELL}>{percent("layeringPct")}</td>
      <td className={CELL}>{percent("dispensingPct")}</td>
      <td className={CELL}>
        <StickinessCell
          value={box.stickiness}
          config={config}
          label={`${labelFor(labels, "stickiness")}, ${item}`}
          error={findIssue(issues, path("stickiness"))?.message}
          issuePath={path("stickiness")}
          readOnly={readOnly}
          onFocus={focus}
          onValueChange={(stickiness) => onPatch({ stickiness })}
        />
      </td>
      <td className={CELL}>
        <NoteCell
          value={box.note}
          label={`${labelFor(labels, "note")}, ${item}`}
          issuePath={path("note")}
          readOnly={readOnly}
          onFocus={focus}
          onValueChange={(note) => onPatch({ note })}
        />
      </td>
    </tr>
  );
}

type StickinessCellProps = {
  value: string | null;
  config: DispensingPackingConfig;
  label: string;
  error: string | undefined;
  issuePath: readonly (string | number)[];
  readOnly: boolean;
  onFocus: () => void;
  onValueChange: (value: string | null) => void;
};

/**
 * One of the template's codes, from a native select: the iPad's own picker,
 * typeahead on desktop. It reads as a picker: a chevron, and "Pick" while
 * empty ("—" is the screen's mark for no value).
 */
function StickinessCell({ value, config, label, error, issuePath, readOnly, onFocus, onValueChange }: StickinessCellProps) {
  const code = config.stickinessCodes.find((entry) => entry.code === value);
  const failing = code !== undefined && !code.pass;
  const unknown = value !== null && code === undefined;
  if (readOnly) {
    return (
      <span
        {...issuePathProps(issuePath)}
        data-fail={failing || unknown || undefined}
        className="relative block px-2.5 font-semibold data-fail:text-fail"
      >
        <span className="sr-only">{label}: </span>
        {value ?? "—"}
        {error && <span className="sr-only">. {error}</span>}
      </span>
    );
  }
  return (
    <span className="relative block" {...issuePathProps(issuePath)}>
      <select
        aria-label={label}
        aria-invalid={unknown || undefined}
        title={error ?? code?.label}
        value={value ?? ""}
        onFocus={onFocus}
        onChange={(event) => onValueChange(event.target.value === "" ? null : event.target.value)}
        data-empty={value === null || undefined}
        data-fail={failing || undefined}
        className={cn(
          // pr-8 keeps the code clear of the chevron.
          "block h-8 w-full cursor-pointer appearance-none rounded-none bg-transparent pr-8 pl-2.5 font-semibold outline-none focus-ring-inset touch:h-11",
          "hover:bg-accent data-empty:font-normal data-empty:text-muted-foreground",
          "data-fail:bg-fail-tint data-fail:text-fail aria-invalid:bg-fail-tint aria-invalid:text-fail",
          // Where the browser styles the open list, its options stay plain whatever the cell shows.
          "*:text-foreground",
        )}
      >
        {/* Empty, it asks for a pick; with a code, this option clears it. */}
        <option value="">{value === null ? "Pick" : "—"}</option>
        {config.stickinessCodes.map((entry) => (
          <option key={entry.code} value={entry.code}>
            {entry.code}
          </option>
        ))}
        {unknown && <option value={value}>{value}</option>}
      </select>
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      {error && <span className="sr-only">{error}</span>}
    </span>
  );
}

type NoteCellProps = {
  value: string | null;
  label: string;
  issuePath: readonly (string | number)[];
  readOnly: boolean;
  onFocus: () => void;
  onValueChange: (value: string | null) => void;
};

/** Free text, saved when the cell is left rather than on every key. */
function NoteCell({ value, label, issuePath, readOnly, onFocus, onValueChange }: NoteCellProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const next = draft.trim() === "" ? null : draft;
    if (next !== value) onValueChange(next);
    setDraft(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      setDraft(null);
    }
  };
  if (readOnly) {
    return (
      <span {...issuePathProps(issuePath)} className="relative block truncate px-2.5">
        <span className="sr-only">{label}: </span>
        {value ?? ""}
      </span>
    );
  }
  return (
    <input
      type="text"
      aria-label={label}
      maxLength={2000}
      autoComplete="off"
      enterKeyHint="done"
      value={draft ?? value ?? ""}
      onFocus={onFocus}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      {...issuePathProps(issuePath)}
      className="block h-8 w-full min-w-0 rounded-none bg-transparent px-2.5 outline-none hover:bg-accent focus:bg-card focus-ring-inset touch:h-11"
    />
  );
}

/**
 * The template's stickiness legend: what each code means and whether it
 * passes. An h3 under the section's h2, as the Photos heading after it.
 */
function StickinessLegend({ labels, config }: { labels: Labels; config: DispensingPackingConfig }) {
  return (
    <ModuleSection title={plainLabel(labelFor(labels, "stickinessLegend"))}>
      <dl className="grid gap-x-4 gap-y-1.5 text-sm touch:text-base sm:grid-cols-[auto_1fr_auto]">
        {config.stickinessCodes.map((entry) => (
          <div key={entry.code} className="contents">
            <dt className="font-semibold tabular-nums">{entry.code}</dt>
            <dd className="text-muted-foreground">{entry.label}</dd>
            <dd>
              <StatusPill size="sm" status={entry.pass ? "pass" : "fail"} />
            </dd>
          </div>
        ))}
      </dl>
    </ModuleSection>
  );
}

/** calc's issues about a size's rows (`["sizes", size, "boxes", ...]`), in row order. */
function boxIssues(issues: readonly ValidationIssue[], size: string): ValidationIssue[] {
  return issues.filter((issue) => issue.path[0] === "sizes" && issue.path[1] === size && issue.path[2] === "boxes");
}

/** calc's issues about a size's aged sample (`["sizes", size, "agedSample", ...]`). */
function agedSampleIssues(issues: readonly ValidationIssue[], size: string): ValidationIssue[] {
  return issues.filter((issue) => issue.path[0] === "sizes" && issue.path[1] === size && issue.path[2] === AGED);
}

/**
 * calc's problems in the rows, each with a link to its cell (BUILD_SPEC 6.2),
 * listed as the carton list lists its own: a cell only turns red (an error) or
 * amber (a warning, such as a box/carton number not sampled for the size), and its
 * message is read to screen readers alone. The Passed or Failed of the size
 * stays calc's.
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

/** A table's heading row height in px, kept current as its wording wraps and fonts load; null until measured. */
function useHeadHeight(head: RefObject<HTMLTableSectionElement | null>): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const element = head.current;
    const table = element?.parentElement;
    if (!element || !table || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
    observer.observe(element);
    // The table as well: it resizes with its heading row in a browser that does not observe row groups.
    observer.observe(table);
    return () => observer.disconnect();
  }, [head]);
  return height;
}
