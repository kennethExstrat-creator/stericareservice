"use client";

// The order table as on page 1 of both reports: one row per size the
// template offers. A quantity orders the size (6.2 rule 4). Quantities go in
// on the numeric keypad, Enter walks down the column and a pasted column
// fills down; lot numbers are added as chips, several per size, typed or
// pasted. Lot sizes and totals are computed and read-only (rule 2). Every
// label is the template's (rule 11). Every change goes through
// useDataUpdater, built from the latest data, so a pasted column keeps every
// size's quantity.
import { useId, useRef, useState, type ClipboardEvent, type FocusEvent, type KeyboardEvent } from "react";
import { XIcon } from "lucide-react";
import {
  EnterGroup,
  EntryProblems,
  Figure,
  findIssue,
  issuePathProps,
  NumberField,
  useDataUpdater,
  useIssueFocus,
  type EntryProblem,
  type InvalidEntry,
} from "@/components/qc";
import { Button } from "@/components/ui/button";
import { formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { labelFor, type CaptureProps, type Labels } from "@/modules/_framework";
import { readOrder, type OrderLotsComputed } from "./calc";
import type { OrderLotsConfig } from "./config";
import { addLots, lineFor, removeKey, removeLot, setLine, splitLots, tidySite } from "./edit";
import type { OrderLotsData } from "./schema";

const HEAD_CELL = "border-b border-border bg-slate-50 px-2.5 py-2 text-left align-bottom font-semibold";
const ROW_HEAD = "border-r border-b border-border px-3 text-left font-semibold tabular-nums";
const CELL = "border-r border-b border-border p-0 align-middle last:border-r-0 group-has-[input:focus]/row:bg-brand-50/60";
/** Marks the packing site cells, so Enter goes down their column. */
const SITE_ATTRIBUTE = "data-site-cell";

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
}: CaptureProps<OrderLotsData, OrderLotsConfig, OrderLotsComputed>) {
  const root = useRef<HTMLDivElement>(null);
  useIssueFocus(focusPath, { root });
  const id = useId();
  const [rejected, setRejected] = useState<Readonly<Record<string, InvalidEntry>>>({});
  const update = useDataUpdater(data, onChange);

  const sizes = context.templateSizes.map((size) => size.value);
  // Issue paths point into the data: a line saved under another spelling ("m") keeps that key.
  const savedKeys = new Map(readOrder(data).rows.map((row) => [row.size, row.key]));
  const dataPath = (size: string, ...rest: string[]) => ["sizes", savedKeys.get(size) ?? size, ...rest];
  const showSite = config.fields.packingSite;
  const computed = evaluation?.computed;
  const issues = evaluation?.issues ?? [];
  const sizeName = (size: string) => formatSize(size, { sizes: context.templateSizes, prefix: true });
  const qtyId = (size: string) => `${id}-qty-${size}`;

  const reject = (size: string, entry: InvalidEntry | null) =>
    setRejected((current) => {
      const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== size));
      return entry === null ? rest : { ...rest, [size]: entry };
    });
  const problems: EntryProblem[] = sizes.flatMap((size) => {
    const entry = rejected[size];
    return entry && lineFor(data, size).qtyCases === null
      ? [{ key: size, label: `${labelFor(labels, "qtyCases")}, ${sizeName(size)}`, entry, inputId: qtyId(size) }]
      : [];
  });

  // A photo taken while a row is in focus is tagged with its size (BUILD_SPEC 8.1).
  const focusSize = (size: string) => (event: FocusEvent<HTMLTableRowElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFocusChange?.({ size });
  };

  return (
    <div ref={root} className="space-y-3">
      <EnterGroup className="relative overflow-clip rounded-lg border border-border bg-card">
        <table className="w-full table-fixed border-separate border-spacing-0 text-sm touch:text-base">
          <caption className="sr-only">{title}</caption>
          <colgroup>
            <col className="w-16" />
            <col className="w-28 touch:w-32" />
            <col />
            {showSite && <col className="w-36 md:w-44" />}
            <col className="w-28 md:w-32" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={HEAD_CELL}>
                {labelFor(labels, "size")}
              </th>
              <th scope="col" className={cn(HEAD_CELL, "text-right")}>
                {labelFor(labels, "qtyCases")}
              </th>
              <th scope="col" className={HEAD_CELL}>
                {labelFor(labels, "lotNumbers")}
              </th>
              {showSite && (
                <th scope="col" className={HEAD_CELL}>
                  {labelFor(labels, "packingSite")}
                </th>
              )}
              <th scope="col" className={cn(HEAD_CELL, "text-right")}>
                {labelFor(labels, "lotSizeGloves")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sizes.map((size) => {
              const line = lineFor(data, size);
              const ordered = line.qtyCases !== null && line.qtyCases > 0;
              return (
                <tr key={size} className="group/row" onFocus={focusSize(size)} {...issuePathProps(dataPath(size))}>
                  <th
                    scope="row"
                    className={cn(ROW_HEAD, ordered ? "bg-card text-foreground" : "bg-card text-muted-foreground")}
                  >
                    {formatSize(size, { sizes: context.templateSizes })}
                  </th>
                  <td className={CELL}>
                    <NumberField
                      variant="cell"
                      group="qty"
                      id={qtyId(size)}
                      label={`${labelFor(labels, "qtyCases")}, ${sizeName(size)}`}
                      integer
                      min={0}
                      value={line.qtyCases}
                      onValueChange={(qtyCases) => update((current) => setLine(current, size, { qtyCases }))}
                      onInvalidChange={(entry) => reject(size, entry)}
                      error={findIssue(issues, dataPath(size, "qtyCases"))?.message}
                      issuePath={dataPath(size, "qtyCases")}
                      readOnly={readOnly}
                    />
                  </td>
                  <td className={CELL}>
                    <LotNumbers
                      lots={line.lotNumbers}
                      label={labelFor(labels, "lotNumbers")}
                      sizeName={sizeName(size)}
                      issuePath={dataPath(size, "lotNumbers")}
                      readOnly={readOnly}
                      onAdd={(lots) => {
                        // update runs the change at once, so what it skipped is known on return.
                        let skipped: string[] = [];
                        update((current) => {
                          const added = addLots(current, size, lots);
                          skipped = added.skipped;
                          return added.data;
                        });
                        return skipped;
                      }}
                      onRemove={(index, lot) => update((current) => removeLot(current, size, index, lot))}
                    />
                  </td>
                  {showSite && (
                    <td className={CELL}>
                      <TextCell
                        label={`${labelFor(labels, "packingSite")}, ${sizeName(size)}`}
                        value={line.packingSite}
                        onValueChange={(packingSite) => update((current) => setLine(current, size, { packingSite }))}
                        onLeave={() => update((current) => tidySite(current, size))}
                        issuePath={dataPath(size, "packingSite")}
                        readOnly={readOnly}
                      />
                    </td>
                  )}
                  <td className={cn(CELL, "bg-slate-50 px-2.5 text-right")}>
                    {ordered ? <Figure value={computed?.lotSizeGloves[size]} grouping /> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <dl className="flex flex-wrap items-baseline justify-end gap-x-8 gap-y-1 border-t-2 border-t-slate-300 bg-slate-50 px-3 py-2 touch:py-3">
          <div className="flex items-baseline gap-2">
            <dt className="font-semibold">{labelFor(labels, "totalCartons")}</dt>
            <dd>
              <Figure value={computed?.totalCartons} grouping className="font-semibold" />
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="font-semibold">{labelFor(labels, "totalGloves")}</dt>
            <dd>
              <Figure value={computed?.totalGloves} grouping className="font-semibold" />
            </dd>
          </div>
        </dl>
      </EnterGroup>

      <EntryProblems problems={problems} />
      <StrayLines
        data={data}
        labels={labels}
        sizes={sizes}
        readOnly={readOnly}
        onRemove={(key) => update((current) => removeKey(current, key))}
      />
    </div>
  );
}

/** Lot numbers of one size: chips with a remove button, and a field that adds what is typed or pasted. */
function LotNumbers({
  lots,
  label,
  sizeName,
  issuePath,
  readOnly,
  onAdd,
  onRemove,
}: {
  lots: readonly string[];
  label: string;
  sizeName: string;
  issuePath: readonly (string | number)[];
  readOnly: boolean;
  /** Returns the lots skipped because the size already has them. */
  onAdd: (lots: string[]) => string[];
  /** The chip's place in the list and the lot it shows. */
  onRemove: (index: number, lot: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");

  const add = (text: string) => {
    const typed = splitLots(text);
    if (typed.length === 0) return;
    const skipped = onAdd(typed);
    setDraft("");
    setNotice(skipped.length > 0 ? `Already listed: ${skipped.join(", ")}.` : "");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    add(draft);
  };
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text");
    if (splitLots(text).length < 2) return;
    event.preventDefault();
    add(`${draft}\n${text}`);
  };

  return (
    <div className="relative flex min-h-8 flex-wrap items-center gap-1.5 px-1.5 py-1 touch:min-h-11" {...issuePathProps(issuePath)}>
      {lots.map((lot, index) => (
        <span
          key={`${index}-${lot}`}
          {...issuePathProps([...issuePath, index])}
          className={cn(
            "inline-flex h-7 max-w-full items-center rounded-full border border-border bg-secondary pl-2.5 text-secondary-foreground touch:h-11 touch:pl-3",
            readOnly && "pr-2.5 touch:pr-3",
          )}
        >
          <span className="truncate">{lot}</span>
          {!readOnly && (
            <button
              type="button"
              onClick={() => onRemove(index, lot)}
              aria-label={`Remove ${label} ${lot}, ${sizeName}`}
              className="flex size-7 shrink-0 items-center justify-center rounded-full outline-none hover:bg-brand-100 focus-ring-inset touch:size-11"
            >
              <XIcon aria-hidden className="size-3.5" />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => add(draft)}
          aria-label={`${label}, ${sizeName}: add`}
          placeholder={lots.length === 0 ? "Add lot" : "Add"}
          enterKeyHint="enter"
          autoComplete="off"
          spellCheck={false}
          className="h-8 min-w-20 flex-1 rounded-md bg-transparent px-1.5 outline-none placeholder:text-muted-foreground focus-visible:bg-card focus-ring-inset touch:h-11"
        />
      )}
      <span className="sr-only" aria-live="polite">
        {notice}
      </span>
      {notice && (
        <span aria-hidden className="w-full px-1 text-sm text-muted-foreground touch:text-base">
          {notice}
        </span>
      )}
    </div>
  );
}

/** A text cell of the table: stored as typed, blank as null; `onLeave` tidies it when it is left. */
function TextCell({
  label,
  value,
  onValueChange,
  onLeave,
  issuePath,
  readOnly,
}: {
  label: string;
  value: string | null;
  onValueChange: (value: string | null) => void;
  onLeave: () => void;
  issuePath: readonly (string | number)[];
  readOnly: boolean;
}) {
  return (
    <input
      type="text"
      value={value ?? ""}
      onChange={(event) => onValueChange(event.target.value === "" ? null : event.target.value)}
      onBlur={onLeave}
      onKeyDown={nextSiteOnEnter}
      enterKeyHint="next"
      aria-label={label}
      readOnly={readOnly}
      autoComplete="off"
      data-site-cell=""
      {...issuePathProps(issuePath)}
      className="h-8 w-full min-w-0 bg-transparent px-2.5 outline-none focus-visible:bg-card focus-ring-inset touch:h-11"
    />
  );
}

/** Enter goes down the column to the next size's packing site, as it does for quantities. */
function nextSiteOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const cells = Array.from(event.currentTarget.closest("table")?.querySelectorAll<HTMLElement>(`[${SITE_ATTRIBUTE}]`) ?? []);
  cells[cells.indexOf(event.currentTarget) + 1]?.focus();
}

/**
 * Lines saved under a key the table has no row for: not a size, a second
 * spelling of one, or a size the template does not offer. Calc reports each
 * as an error; this is where it is removed.
 */
function StrayLines({
  data,
  labels,
  sizes,
  readOnly,
  onRemove,
}: {
  data: OrderLotsData;
  labels: Labels;
  sizes: readonly string[];
  readOnly: boolean;
  onRemove: (key: string) => void;
}) {
  const reading = readOrder(data);
  const stray = [
    ...reading.invalid,
    ...reading.duplicates.map((duplicate) => duplicate.key),
    ...reading.rows.filter((row) => !sizes.includes(row.size)).map((row) => row.key),
  ];
  if (stray.length === 0) return null;
  return (
    <section
      aria-label="Lines the table does not show"
      className="space-y-2 rounded-lg border border-fail-border bg-fail-tint px-3 py-2.5 text-sm text-fail touch:text-base"
    >
      <p className="font-semibold">Saved under sizes this order does not show. Remove them, or ask an admin.</p>
      <ul className="space-y-1.5">
        {stray.map((key) => {
          const line = data.sizes[key];
          const parts = [
            line.qtyCases === null ? null : `${labelFor(labels, "qtyCases")} ${line.qtyCases}`,
            line.lotNumbers.length === 0 ? null : `${labelFor(labels, "lotNumbers")} ${line.lotNumbers.join(", ")}`,
          ].filter((part) => part !== null);
          return (
            <li key={key} className="flex flex-wrap items-center justify-between gap-2" {...issuePathProps(["sizes", key])}>
              <span>
                <span className="font-semibold">“{key}”</span>
                {parts.length > 0 && `: ${parts.join("; ")}`}
              </span>
              {!readOnly && (
                <Button type="button" size="sm" variant="outline" onClick={() => onRemove(key)}>
                  Remove “{key}”
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
