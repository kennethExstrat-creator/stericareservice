"use client";

// The header, General Information on screen. The manufacturer, the client
// and the inspector are the inspection's, never typed (6.2 rules 10 and 11).
// The manufacturer and the client are pickers with New Inspection's lists
// while the inspection can be changed here (Kenneth, 30 October 2026:
// "manufacturer and client should be editable"): a pick changes the
// inspection row at once through the screen's slot (inspection-parties.tsx),
// and a new factory brings its address unless the inspector typed their own
// (followFactoryAddress). Read-only, and where the screen gives no slot, they
// show as text. The inspector is always read-only. The rest is typed once
// here and reused everywhere. Dates come
// from pickers (rule 3): a calendar, or month and year where the template
// prints only those. Enter moves to the next field. Every label is the
// template's (rule 11). Every change goes through useDataUpdater, built from
// the latest data. Its rows follow its own width, not the window's: it sits
// in the narrow column left of Source Documents' files from 1024 px, full
// width below (Kenneth, 26 October 2026).
import { useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { DateField, findIssue, issuePathProps, StatusIcon, useDataUpdater, useIssueFocus } from "@/components/qc";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { labelFor, type CaptureProps } from "@/modules/_framework";
import {
  useInspectionParties,
  type InspectionParties,
  type InspectionParty,
  type PartyOption,
} from "@/modules/_framework/inspection-parties";
import { headerRows, type HeaderComputed } from "./calc";
import type { HeaderConfig, HeaderField } from "./config";
import { monthDate, yearMonth } from "./dates";
import { followFactoryAddress, setDate, setText, tidyText } from "./edit";
import { TEXT_MAX_LENGTH, type HeaderData, type HeaderDateField, type HeaderTextField } from "./schema";

const FIELD_ATTRIBUTE = "data-header-field";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Years offered around the inspection: made up to ten years before, expiring up to ten after. */
const YEARS_AROUND = 10;

type FromInspection = Extract<HeaderField, "manufacturer" | "client" | "inspector">;
const FROM_INSPECTION: readonly FromInspection[] = ["manufacturer", "client", "inspector"];

/** Under the facts, where the inspector's row shows. */
const INSPECTOR_HINT = "The inspector is recorded automatically.";

/** The client picker's entry for an inspection without a client, worded as on New Inspection. */
const NO_CLIENT = "none";
const NO_CLIENT_LABEL = "No Client";

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
}: CaptureProps<HeaderData, HeaderConfig, HeaderComputed>) {
  const root = useRef<HTMLDivElement>(null);
  useIssueFocus(focusPath, { root });
  const id = useId();
  const [fallbackYear] = useState(() => new Date().getFullYear());
  const update = useDataUpdater(data, onChange);
  // The screen's pickers, where the inspection can be changed here; the facts stay text while it cannot.
  const parties = useInspectionParties();
  const pickers = readOnly ? null : parties;
  // A client or manufacturer picked and on its way to the server: shown as picked, both pickers waiting.
  const [picking, setPicking] = useState<{ party: InspectionParty; value: string } | null>(null);

  const rows = headerRows(data, config, context);
  const shown = (field: HeaderField) => config.fields[field];
  const issues = evaluation?.issues ?? [];
  const facts = FROM_INSPECTION.filter(shown);
  const dates = (["inspectionDate", "mfgDate", "expiryDate"] as const).filter(shown);
  const referenceYear = yearOf(rows.inspectionDate ?? rows.mfgDate ?? rows.expiryDate) ?? fallbackYear;

  const typeText = (field: HeaderTextField, value: string) => update((current) => setText(current, field, value));
  const leaveText = (field: HeaderTextField) => update((current) => tidyText(current, field));
  const pickDate = (field: HeaderDateField, value: string | null) => update((current) => setDate(current, field, value));

  // The inspection's client (or none) or factory, changed on the server; a new factory brings its address.
  const pickParty = async (slot: InspectionParties, party: InspectionParty, value: string) => {
    const next = party === "client" && value === NO_CLIENT ? null : value;
    if (picking !== null || next === (context.inspection[party]?.id ?? null)) return;
    setPicking({ party, value });
    const result = await slot.change(party, next);
    setPicking(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    if (result.warning) toast.warning(result.warning);
    const address = result.address;
    if (address && shown("factoryAddress")) update((current) => followFactoryAddress(current, address.previous, address.next));
  };

  const partyPicker = (slot: InspectionParties, party: InspectionParty) => {
    const current = context.inspection[party] ?? null;
    const listed = party === "client" ? slot.clients : slot.manufacturers;
    // The inspection's own, whatever the list holds, so the picker never reads blank.
    const options: readonly PartyOption[] =
      current === null || listed.some((option) => option.id === current.id)
        ? listed
        : [{ id: current.id, label: current.name }, ...listed];
    const value = picking?.party === party ? picking.value : (current?.id ?? (party === "client" ? NO_CLIENT : ""));
    return (
      <Select value={value} onValueChange={(next) => void pickParty(slot, party, next)} disabled={picking !== null}>
        <SelectTrigger
          id={`${id}-${party}`}
          aria-labelledby={`${id}-${party}-label`}
          aria-busy={picking?.party === party ? true : undefined}
          className="mt-1 w-full font-normal"
          data-party-picker={party}
        >
          <SelectValue placeholder={party === "client" ? "Choose the client" : "Choose the manufacturer"} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              <span className="truncate">{option.label}</span>
            </SelectItem>
          ))}
          {party === "client" && options.length > 0 && <SelectSeparator />}
          {party === "client" && <SelectItem value={NO_CLIENT}>{NO_CLIENT_LABEL}</SelectItem>}
        </SelectContent>
      </Select>
    );
  };

  const textField = (field: HeaderTextField, { multiline = false, wide = false } = {}) => (
    <div key={field} className={cn("min-w-0 space-y-1.5", wide && "@xl:col-span-2")} {...issuePathProps([field])}>
      <Label htmlFor={`${id}-${field}`} className="leading-snug touch:text-base">
        {labelFor(labels, field)}
      </Label>
      {multiline ? (
        <Textarea
          id={`${id}-${field}`}
          rows={2}
          value={data[field] ?? ""}
          onChange={(event) => typeText(field, event.target.value)}
          onBlur={() => leaveText(field)}
          maxLength={TEXT_MAX_LENGTH}
          readOnly={readOnly}
          data-header-field=""
        />
      ) : (
        <Input
          id={`${id}-${field}`}
          value={data[field] ?? ""}
          onChange={(event) => typeText(field, event.target.value)}
          onBlur={() => leaveText(field)}
          onKeyDown={nextOnEnter}
          enterKeyHint="next"
          autoComplete="off"
          maxLength={TEXT_MAX_LENGTH}
          readOnly={readOnly}
          data-header-field=""
        />
      )}
    </div>
  );

  const dateField = (field: HeaderDateField) => {
    const warning = findIssue(issues, [field]);
    const warningId = `${id}-${field}-warning`;
    const label = labelFor(labels, field);
    const monthly = field !== "inspectionDate" && config.mfgExpiryPrecision === "month";
    // The inspection date shows the inspection row's own until the header sets one.
    const value = field === "inspectionDate" ? rows.inspectionDate : data[field];
    if (!monthly) {
      return (
        <DateField
          key={field}
          id={`${id}-${field}`}
          label={label}
          value={value}
          onValueChange={(next) => pickDate(field, next)}
          error={warning?.level === "error" ? warning.message : null}
          warning={warning && warning.level !== "error" ? warning.message : null}
          issuePath={[field]}
          readOnly={readOnly}
          onKeyDown={nextOnEnter}
          enterKeyHint="next"
          data-header-field=""
        />
      );
    }
    return (
      <div key={field} className="min-w-0 space-y-1.5" {...issuePathProps([field])}>
        <MonthPicker
          id={`${id}-${field}`}
          label={label}
          value={value}
          years={yearRange(referenceYear, value)}
          onValueChange={(next) => pickDate(field, next)}
          readOnly={readOnly}
          describedBy={warning ? warningId : undefined}
        />
        {warning && (
          <p id={warningId} className="flex items-start gap-1.5 text-sm text-warn touch:text-base">
            <StatusIcon status="warn" className="mt-0.5 size-4 shrink-0" />
            {warning.message}
          </p>
        )}
      </div>
    );
  };

  // A photo taken in the header has no size, hand, defect or box to tag.
  const clearFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFocusChange?.({});
  };

  return (
    // A size container: three facts, two fields and three dates a row once the form is wide enough for them.
    <div ref={root} className="@container relative space-y-5" onFocus={clearFocus} data-header-scope="">
      {facts.length > 0 && (
        <section aria-label="From the inspection" className="space-y-1.5">
          <dl className="grid gap-x-6 gap-y-3 rounded-lg border border-border bg-muted px-4 py-3 @lg:grid-cols-3">
            {facts.map((field) => (
              <div key={field} className="min-w-0">
                <dt id={`${id}-${field}-label`} className="text-sm text-muted-foreground touch:text-base">
                  {labelFor(labels, field)}
                </dt>
                <dd className="font-medium break-words text-foreground">
                  {pickers && field !== "inspector" ? partyPicker(pickers, field) : factValue(rows[field])}
                </dd>
              </div>
            ))}
          </dl>
          {facts.includes("inspector") && <p className="text-sm text-muted-foreground touch:text-base">{INSPECTOR_HINT}</p>}
        </section>
      )}

      <div className="grid gap-x-6 gap-y-5 @xl:grid-cols-2">
        {shown("factoryAddress") && textField("factoryAddress", { multiline: true, wide: true })}
        {shown("poNo") && textField("poNo")}
        {shown("productCode") && textField("productCode")}
        {shown("productName") && textField("productName", { multiline: true, wide: true })}
        {shown("factoryGloveCode") && textField("factoryGloveCode")}
      </div>

      {dates.length > 0 && <div className="grid gap-x-6 gap-y-5 @lg:grid-cols-3">{dates.map(dateField)}</div>}
    </div>
  );
}

function MonthPicker({
  id,
  label,
  value,
  years,
  onValueChange,
  readOnly,
  describedBy,
}: {
  id: string;
  label: string;
  value: string | null;
  years: readonly number[];
  onValueChange: (value: string) => void;
  readOnly: boolean;
  describedBy?: string;
}) {
  // A month or year picked alone waits here until the other one is picked.
  const [draft, setDraft] = useState<{ month: number | null; year: number | null }>({ month: null, year: null });
  const saved = value === null ? null : yearMonth(value);
  const month = saved?.month ?? draft.month;
  const year = saved?.year ?? draft.year;

  // Read-only, the date reads as text like every other read-only field:
  // disabled selects would fade it below the contrast floor.
  if (readOnly) {
    return (
      <>
        <Label htmlFor={id} className="leading-snug touch:text-base">
          {label}
        </Label>
        <Input
          id={id}
          value={saved === null ? "" : monthYearText(saved)}
          onKeyDown={nextOnEnter}
          enterKeyHint="next"
          readOnly
          aria-describedby={describedBy}
          data-header-field=""
        />
      </>
    );
  }

  const choose = (next: { month: number | null; year: number | null }) => {
    if (next.month !== null && next.year !== null) {
      setDraft({ month: null, year: null });
      onValueChange(monthDate(next.year, next.month));
    } else {
      setDraft(next);
    }
  };

  return (
    <fieldset className="min-w-0 space-y-1.5" aria-describedby={describedBy}>
      <legend id={`${id}-legend`} className="text-sm leading-snug font-medium touch:text-base">
        {label}
      </legend>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <Select
          value={month === null ? "" : String(month)}
          onValueChange={(next) => choose({ month: Number(next), year })}
        >
          <SelectTrigger id={id} aria-label={`${label}: month`} className="w-full" data-header-field="">
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((name, index) => (
              <SelectItem key={name} value={String(index + 1)}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={year === null ? "" : String(year)}
          onValueChange={(next) => choose({ month, year: Number(next) })}
        >
          <SelectTrigger aria-label={`${label}: year`} className="w-full" data-header-field="">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            {years.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </fieldset>
  );
}

/** "Feb 2025": the month as the picker names it, and the year. */
function monthYearText({ year, month }: { year: number; month: number }): string {
  return `${MONTHS[month - 1] ?? month} ${year}`;
}

function factValue(value: string | null): ReactNode {
  if (value !== null) return value;
  return (
    <span className="text-muted-foreground">
      <span aria-hidden>—</span>
      <span className="sr-only">Not set</span>
    </span>
  );
}

/** Enter moves to the next header field, as on a paper form read top to bottom. */
function nextOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const scope = event.currentTarget.closest("[data-header-scope]") ?? event.currentTarget.form ?? document;
  const fields = Array.from(scope.querySelectorAll<HTMLElement>(`[${FIELD_ATTRIBUTE}]`)).filter(
    (field) => field.getClientRects().length > 0,
  );
  fields[fields.indexOf(event.currentTarget) + 1]?.focus();
}

function yearOf(date: string | null): number | null {
  return date === null ? null : yearMonth(date).year;
}

/** The reference year ± ten years, and the saved year if it lies outside them. */
function yearRange(reference: number, value: string | null): number[] {
  const years = Array.from({ length: YEARS_AROUND * 2 + 1 }, (_, index) => reference - YEARS_AROUND + index);
  const saved = yearOf(value);
  if (saved !== null && !years.includes(saved)) years.push(saved);
  return years.sort((a, b) => a - b);
}
