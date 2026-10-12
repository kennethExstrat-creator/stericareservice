"use client";

// The Inspection Summary card's Sections and Order (docs/AI.md, "Steri-AI
// Summary"; Kenneth, 12 October 2026): the parts of the summary, which are
// on, and their order, which is also their priority. Closed, one line names
// the parts that are on; Change opens the list in place, each part with a
// switch and Move Up / Move Down, 44 px on touch. No drag and drop: it is
// fiddly on the iPad. Result is always first and always on. A move keeps the
// focus on the button pressed (aria-disabled at either end, never disabled,
// so the focus is never dropped) and is announced.
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, PencilIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  SUMMARY_FIELDS,
  SUMMARY_OVERVIEW_DETAILS,
  SUMMARY_SECTIONS,
  type SummaryOverviewKey,
  type SummarySection,
  type SummarySectionKey,
} from "@/lib/schemas/summary-style";

const SECTION_BY_KEY = new Map<SummarySectionKey, (typeof SUMMARY_SECTIONS)[number]>(
  SUMMARY_SECTIONS.map((section) => [section.key, section]),
);


const sectionLabel = (key: SummarySectionKey) => SECTION_BY_KEY.get(key)?.label ?? key;
const isFixed = (key: SummarySectionKey) => SECTION_BY_KEY.get(key)?.fixed === true;

/** The parts that are on, in order, as one line: "Result, Remark, Issues First, … Next Step." */
export function sectionsLine(sections: readonly SummarySection[]): string {
  return `${sections
    .filter((section) => section.on)
    .map((section) => sectionLabel(section.key))
    .join(", ")}.`;
}

/** Where the movable parts start: after Result, which stays first. */
function firstMovable(sections: readonly SummarySection[]): number {
  return sections.length > 0 && isFixed(sections[0].key) ? 1 : 0;
}

/** True when `key` cannot move one place up (-1) or down (+1): Result, or a part at either end. */
export function atEnd(sections: readonly SummarySection[], key: SummarySectionKey, step: 1 | -1): boolean {
  const from = sections.findIndex((section) => section.key === key);
  const to = from + step;
  return from < firstMovable(sections) || to < firstMovable(sections) || to >= sections.length;
}

/** The list with `key` one place up (-1) or down (+1); unchanged at either end, and Result stays first. */
export function moveSection(sections: readonly SummarySection[], key: SummarySectionKey, step: 1 | -1): SummarySection[] {
  if (atEnd(sections, key, step)) return [...sections];
  const from = sections.findIndex((section) => section.key === key);
  const next = [...sections];
  [next[from], next[from + step]] = [next[from + step], next[from]];
  return next;
}

/** The list with `key` switched on or off; Result stays on. */
export function switchSection(sections: readonly SummarySection[], key: SummarySectionKey, on: boolean): SummarySection[] {
  return sections.map((section) => (section.key === key && !isFixed(key) ? { ...section, on } : section));
}

/** The details ticked, `key` on or off, in Order Overview's own order. */
export function tickOverview(overview: readonly SummaryOverviewKey[], key: SummaryOverviewKey, on: boolean): SummaryOverviewKey[] {
  return SUMMARY_OVERVIEW_DETAILS.map((detail) => detail.key).filter((entry) => (entry === key ? on : overview.includes(entry)));
}

type Props = {
  sections: SummarySection[];
  overview: SummaryOverviewKey[];
  onSectionsChange: (sections: SummarySection[]) => void;
  onOverviewChange: (overview: SummaryOverviewKey[]) => void;
  /** The list is open (the card opens it when a save refuses something in it). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A refusal of the parts or of Order Overview's details, from the save. */
  error?: string;
  disabled?: boolean;
};

export function SummarySectionsField({ sections, overview, onSectionsChange, onOverviewChange, open, onOpenChange, error, disabled }: Props) {
  const id = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const refocus = useRef<{ key: SummarySectionKey; direction: "up" | "down" } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // React may move the row's element to reorder the list, which drops the focus: put it back on the button pressed.
  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = null;
    listRef.current?.querySelector<HTMLButtonElement>(`[data-move="${target.direction}"][data-key="${target.key}"]`)?.focus();
  });

  function move(key: SummarySectionKey, step: 1 | -1) {
    if (atEnd(sections, key, step)) return;
    const next = moveSection(sections, key, step);
    onSectionsChange(next);
    refocus.current = { key, direction: step === -1 ? "up" : "down" };
    setAnnouncement(`${sectionLabel(key)} moved to position ${next.findIndex((section) => section.key === key) + 1} of ${next.length}.`);
  }

  return (
    <div role="group" aria-labelledby={`${id}-title`} className="grid gap-2" data-testid="summary-sections" data-open={open || undefined}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span id={`${id}-title`} className="text-sm leading-snug font-medium text-foreground">
          {SUMMARY_FIELDS.sections.label}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={open}
          aria-controls={open ? `${id}-list` : undefined}
          onClick={() => onOpenChange(!open)}
          className="relative"
        >
          {open ? <CheckIcon aria-hidden /> : <PencilIcon aria-hidden />}
          {open ? (
            "Done"
          ) : (
            <>
              Change<span className="sr-only"> Sections and Order</span>
            </>
          )}
        </Button>
      </div>
      {!open && <p className="text-base text-foreground fine:text-sm">{sectionsLine(sections)}</p>}
      <p id={`${id}-hint`} className="text-sm text-muted-foreground touch:text-base">
        {SUMMARY_FIELDS.sections.hint}
      </p>
      {open && (
        <ol
          ref={listRef}
          id={`${id}-list`}
          aria-describedby={`${id}-hint`}
          className="mt-1 grid max-w-4xl divide-y divide-border rounded-lg bg-card ring-1 ring-border"
        >
          {sections.map((section, index) => (
            <SectionRow
              key={section.key}
              id={`${id}-${section.key}`}
              section={section}
              position={index + 1}
              upAtEnd={atEnd(sections, section.key, -1)}
              downAtEnd={atEnd(sections, section.key, 1)}
              onSwitch={(on) => onSectionsChange(switchSection(sections, section.key, on))}
              onMove={(step) => move(section.key, step)}
              disabled={disabled}
            >
              {section.key === "overview" && section.on && (
                <OverviewNames id={`${id}-overview`} overview={overview} onChange={onOverviewChange} disabled={disabled} />
              )}
            </SectionRow>
          ))}
        </ol>
      )}
      {error && <FieldError>{error}</FieldError>}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

/** Two icon buttons and the gap between them, kept free on Result's row so the switches line up. */
const MOVE_BUTTONS_WIDTH = "w-[4.25rem] touch:w-[5.75rem]";

/**
 * Greyed at either end but focusable (aria-disabled), as the editor's Undo.
 * The switch keeps 12 px clear of the buttons: its hit area reaches that far
 * past its edge and would take a tap meant for Move Up.
 */
const MOVE_BUTTON_CLASS =
  "text-slate-600 hover:text-foreground aria-disabled:cursor-not-allowed aria-disabled:text-slate-400 aria-disabled:hover:bg-transparent aria-disabled:hover:text-slate-400";

function SectionRow({
  id,
  section,
  position,
  upAtEnd,
  downAtEnd,
  onSwitch,
  onMove,
  disabled,
  children,
}: {
  id: string;
  section: SummarySection;
  position: number;
  upAtEnd: boolean;
  downAtEnd: boolean;
  onSwitch: (on: boolean) => void;
  onMove: (step: 1 | -1) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const meta = SECTION_BY_KEY.get(section.key);
  const label = meta?.label ?? section.key;
  const fixed = meta?.fixed === true;
  return (
    <li className="grid gap-3 px-3 py-3 touch:px-4" data-section={section.key} data-on={section.on}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="w-5 shrink-0 pt-px text-right text-sm text-muted-foreground tabular-nums touch:pt-0.5 touch:text-base">
          {position}
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span id={`${id}-label`} className="text-sm leading-snug font-medium text-foreground touch:text-base">
            {label}
          </span>
          {meta?.hint && (
            <span id={`${id}-hint`} className="text-sm text-muted-foreground touch:text-base">
              {meta.hint}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {fixed && <span className="text-xs text-muted-foreground touch:text-sm">Always On</span>}
          <Switch
            checked={section.on}
            onCheckedChange={onSwitch}
            disabled={disabled || fixed}
            aria-labelledby={`${id}-label`}
            aria-describedby={meta?.hint ? `${id}-hint` : undefined}
            className="mr-3 ml-3"
          />
          {fixed ? (
            <span aria-hidden className={MOVE_BUTTONS_WIDTH} />
          ) : (
            <>
              <MoveButton id={section.key} label={label} direction="up" atEnd={upAtEnd} onMove={() => onMove(-1)} disabled={disabled} />
              <MoveButton id={section.key} label={label} direction="down" atEnd={downAtEnd} onMove={() => onMove(1)} disabled={disabled} />
            </>
          )}
        </div>
      </div>
      {children}
    </li>
  );
}

function MoveButton({
  id,
  label,
  direction,
  atEnd,
  onMove,
  disabled,
}: {
  id: SummarySectionKey;
  label: string;
  direction: "up" | "down";
  atEnd: boolean;
  onMove: () => void;
  disabled?: boolean;
}) {
  const Icon = direction === "up" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={`${direction === "up" ? "Move Up" : "Move Down"}: ${label}`}
      aria-disabled={atEnd || undefined}
      data-move={direction}
      data-key={id}
      disabled={disabled}
      onClick={() => {
        if (!atEnd) onMove();
      }}
      className={MOVE_BUTTON_CLASS}
    >
      <Icon aria-hidden />
    </Button>
  );
}

/**
 * Order Overview's details, under its row while it is on: those on by
 * default, then those the report's header already prints, which the line
 * under them says. One grid, so the two rows line up; from 1024 px its four
 * columns take their words' width and wrap only when the row is too narrow.
 */
function OverviewNames({
  id,
  overview,
  onChange,
  disabled,
}: {
  id: string;
  overview: SummaryOverviewKey[];
  onChange: (overview: SummaryOverviewKey[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="grid gap-3 pl-8" aria-describedby={`${id}-hint`} data-testid="summary-overview">
      <legend className="sr-only">{SUMMARY_FIELDS.overview.label}</legend>
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,auto)] lg:justify-start">
        {SUMMARY_OVERVIEW_DETAILS.map((detail) => (
          <div key={detail.key} className="flex items-center gap-3">
            <Checkbox
              id={`${id}-${detail.key}`}
              checked={overview.includes(detail.key)}
              onCheckedChange={(checked) => onChange(tickOverview(overview, detail.key, checked === true))}
              disabled={disabled}
            />
            <Label htmlFor={`${id}-${detail.key}`} className="leading-snug font-normal touch:text-base">
              {detail.label}
            </Label>
          </div>
        ))}
      </div>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground touch:text-base">
        {SUMMARY_FIELDS.overview.hint}
      </p>
    </fieldset>
  );
}
