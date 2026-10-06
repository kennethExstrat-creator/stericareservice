"use client";

// Glove Packing Check capture (BUILD_SPEC 6.1, 8 "Speed"): one size at a time
// (swipe on iPad, arrow keys on desktop), one row per dispenser box. The box
// number is picked from the size's carton list (6.2 rule 7); layering and
// dispensing % are typed on the numeric keypad, Enter going down the column
// and a pasted column filling down it; the stickiness code is picked from the
// template's codes. Averages and Passed / Failed come from calc as you type,
// read-only (rule 2). Wording comes from the template (rule 11).
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { PlusIcon } from "lucide-react";
import {
  BoxPicker,
  EnterGroup,
  EntryProblems,
  findIssue,
  issuePathProps,
  ModuleSection,
  PercentField,
  RequirementList,
  SizeTabs,
  StatusPill,
  useIssueFocus,
  type EntryProblem,
  type InvalidEntry,
} from "@/components/qc";
import { Button } from "@/components/ui/button";
import { formatSize, formatSpec } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cartonsFor, labelFor, type CaptureProps, type Labels, type ValidationIssue } from "@/modules/_framework";
import type { DispensingPackingComputed, DispensingPackingConfig, DispensingPackingData } from ".";
import { AVERAGE_DECIMALS, packingHeading, plannedBoxes } from "./calc";
import { MAX_BOXES_PER_SIZE } from "./config";
import { boxesOf, rowsShown, updatePackingBox } from "./edit";
import { emptyPackingBox, type PackingBox } from "./schema";
import { plainLabel } from "./text";

type Props = CaptureProps<DispensingPackingData, DispensingPackingConfig, DispensingPackingComputed>;
type Update = (current: DispensingPackingData) => DispensingPackingData;
type PercentKey = "layeringPct" | "dispensingPct";

const HEAD = "border-b border-border bg-slate-50 px-2 py-2 text-left align-bottom font-semibold text-foreground";
const CELL = "border-b border-l border-border p-0 align-middle";

export default function Capture({
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
  const [size, setSize] = useState(context.sizes[0] ?? "");
  // Rows asked for with "Add box", per size, beyond the plan.
  const [requested, setRequested] = useState<Record<string, number>>({});
  // Entries the cells refused ("2 42"), listed under the table with a link.
  const [rejected, setRejected] = useState<Record<string, EntryProblem>>({});

  // A pasted column fills several cells in one go, each reporting its value
  // before the screen renders again: every change builds on the last one.
  const latest = useRef(data);
  useEffect(() => {
    latest.current = data;
  }, [data]);
  const change = (update: Update) => {
    const next = update(latest.current);
    latest.current = next;
    onChange(next);
  };

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
            change={change}
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
  change: (update: Update) => void;
  requested: number;
  onRequest: (rows: number) => void;
  rejected: readonly EntryProblem[];
  onRejected: (key: string, problem: EntryProblem | null) => void;
};

function PackingSizePanel({ size, props, change, requested, onRequest, rejected, onRejected }: PanelProps) {
  const { data, config, title, labels, context, evaluation, readOnly, onFocusChange } = props;
  const boxes = boxesOf(data, size);
  const planned = plannedBoxes(context, config, size);
  const rows = rowsShown(planned, boxes.length, requested);
  const cartons = cartonsFor(context, size);
  const used = boxes.map((box) => box.boxNo);
  // A module whose config or data is broken comes back with no computed values.
  const computed = evaluation?.computed.sizes?.[size];
  const result = evaluation?.result.perSize?.[size];
  const sizeName = formatSize(size, { sizes: context.templateSizes, prefix: true });
  const issues = evaluation?.issues ?? [];
  const keyOf = (field: PercentKey, index: number) => `${size}:${field}:${index}`;
  const passing = config.stickinessCodes.filter((entry) => entry.pass).map((entry) => entry.code);
  // A refused entry is listed while its cell stays empty.
  const problems = rejected.filter((problem) => {
    const [owner, field, index] = problem.key.split(":");
    const box = boxes[Number(index)];
    return owner === size && ((field === "layeringPct" ? box?.layeringPct : box?.dispensingPct) ?? null) === null;
  });

  return (
    <div className="min-w-0 space-y-4">
      {planned === 0 && (
        <p className="rounded-lg border border-dashed border-not-done-border bg-not-done-tint px-4 py-3 text-sm text-not-done touch:text-base">
          {result?.summary}
        </p>
      )}
      <EnterGroup className="relative overflow-clip rounded-lg border border-border bg-card">
        <table className="w-full table-fixed border-separate border-spacing-0 text-sm touch:text-base">
          <caption className="sr-only">{`${title}, ${sizeName}`}</caption>
          <colgroup>
            <col className="w-12 touch:w-14" />
            <col className="w-28 touch:w-32" />
            <col className="w-24 touch:w-28" />
            <col className="w-24 touch:w-28" />
            <col className="w-20 touch:w-24" />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={cn(HEAD, "text-center")}>
                {labelFor(labels, "itemColumn")}
              </th>
              <th scope="col" className={cn(HEAD, "border-l")}>
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
          <tbody>
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
                sizeName={sizeName}
                readOnly={readOnly}
                onPatch={(patch) => change((current) => updatePackingBox(current, size, index, patch))}
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        {result?.status === "not_done" && planned > 0 ? (
          <p className="text-sm text-muted-foreground touch:text-base">{result.summary}</p>
        ) : (
          <span />
        )}
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
            Add box
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
    </div>
  );
}

type RowProps = {
  size: string;
  index: number;
  box: PackingBox;
  cartons: readonly number[];
  used: readonly (number | null)[];
  labels: Labels;
  config: DispensingPackingConfig;
  issues: readonly ValidationIssue[];
  sizeName: string;
  readOnly: boolean;
  onPatch: (patch: Partial<PackingBox>) => void;
  onFocusBox: (box: number | null) => void;
  onRejected: (field: PercentKey, entry: InvalidEntry | null, problem: Pick<EntryProblem, "label" | "inputId">) => void;
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
  sizeName,
  readOnly,
  onPatch,
  onFocusBox,
  onRejected,
}: RowProps) {
  const item = `${labelFor(labels, "itemColumn")} ${index + 1}`;
  const path = (field: keyof PackingBox) => ["sizes", size, "boxes", index, field];
  const inputId = (field: PercentKey) => `dispensing-packing-${size}-${field}-${index}`;
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
        <BoxPicker
          variant="cell"
          label={`${labelFor(labels, "boxNo")}, ${item}`}
          sizeLabel={sizeName.toLowerCase()}
          value={box.boxNo}
          cartons={cartons}
          used={used}
          onValueChange={(boxNo) => {
            onPatch({ boxNo });
            onFocusBox(boxNo);
          }}
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

/** One of the template's codes, from a native select: the iPad's own picker, typeahead on desktop. */
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
        data-fail={failing || undefined}
        className={cn(
          "block h-8 w-full cursor-pointer appearance-none rounded-none bg-transparent px-2.5 font-semibold outline-none focus-ring-inset touch:h-11",
          "hover:bg-accent data-fail:bg-fail-tint data-fail:text-fail aria-invalid:bg-fail-tint aria-invalid:text-fail",
        )}
      >
        <option value="">—</option>
        {config.stickinessCodes.map((entry) => (
          <option key={entry.code} value={entry.code}>
            {entry.code}
          </option>
        ))}
        {unknown && <option value={value}>{value}</option>}
      </select>
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

/** The template's stickiness legend: what each code means and whether it passes. */
function StickinessLegend({ labels, config }: { labels: Labels; config: DispensingPackingConfig }) {
  return (
    <ModuleSection title={plainLabel(labelFor(labels, "stickinessLegend"))} headingLevel={4}>
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
