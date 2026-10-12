"use client";

// The Steri-AI Summary button on the Conclusion (docs/AI.md, "Steri-AI
// Summary"; Kenneth, 12 October 2026): Steri-AI drafts the Inspection
// Summary in SteriCare's house style. It writes text only and never changes
// a result; once in the field the text is the inspector's, to check, edit
// and sign. Import it by its path, never through components/ai's index,
// which holds a server component.
//
// The conclusion's Capture calls useSteriAiSummary with the screen's
// SummaryAssist (modules/_framework/summary-assist.tsx), renders the button
// in the field's heading row, passes `writing` to the editor as `busy` (so
// its undo history stays) and renders the status line under the editor and
// the Replace Your Summary? dialog. Plain props only: nothing here imports
// app code or lib/ai. The rules are in steri-ai-summary-state.ts.
//
// - The button: a split pill. Its main part writes at once with the choices
//   last used on this device; the chevron opens Summary Options (Length,
//   Paragraphs, Format, Language when two or more are offered, a Note for
//   Steri-AI, Reset to House Style, Polish My Text, Write Summary). Offline,
//   and for Write until PASSED, FAILED or HOLD is chosen, it greys out but
//   stays focusable (aria-disabled) and a press says why.
// - Writing: the main part spins, the editor is locked, and the line under
//   the field says Steri-AI is writing; after 15 s that it is still writing,
//   with Cancel.
// - Done: the draft is in the field as one undo step; the line says
//   "Drafted by Steri-AI · 152 words. Check it before you sign." until the
//   text is edited, with Shorter, Longer, Write Again and Undo, then
//   Steri-AI's notes and the figures it could not find. Focus stays where it
//   was.
// - 32 px controls with a mouse, 44 px on any touchscreen.
import {
  useCallback,
  useId,
  useLayoutEffect,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import {
  ChevronDownIcon,
  FoldVerticalIcon,
  InfoIcon,
  OctagonXIcon,
  RefreshCwIcon,
  SparklesIcon,
  TriangleAlertIcon,
  Undo2Icon,
  UnfoldVerticalIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { RichTextEditorHandle } from "@/components/qc/rich-text-editor";
import { RichTextView } from "@/components/qc/rich-text-view";
import { formatCount } from "@/lib/format";
import { browserConnectivity } from "@/lib/offline/connectivity";
import type { InspectionResult } from "@/lib/schemas";
import type { RichTextDoc } from "@/lib/schemas/rich-text";
import {
  needsResultMessage,
  SUMMARY_FIELDS,
  SUMMARY_FORMATS,
  SUMMARY_LANGUAGES,
  SUMMARY_LENGTHS,
  SUMMARY_LIMITS,
  SUMMARY_MENU_TEXT,
  SUMMARY_MESSAGES,
  SUMMARY_PARAGRAPHS,
  SummaryFormatSchema,
  SummaryLanguageSchema,
  SummaryLengthSchema,
  SummaryParagraphsSchema,
  type SummaryMenu,
  type SummaryOptions,
} from "@/lib/schemas/summary-style";
import { cn } from "@/lib/utils";
import type { SummaryAssist } from "@/modules/_framework/summary-assist";
import {
  applyDraft,
  createDeviceStore,
  figuresLine,
  fitsBelow,
  hasStatus,
  INITIAL_SUMMARY_STATE,
  languageOffered,
  parseMark,
  performSummaryRun,
  regenerateOptions,
  requestOptions,
  shownChoices,
  SLOW_AFTER_MS,
  storedChoices,
  summaryDraftKey,
  summaryOptionsKey,
  summaryReducer,
  summaryStatus,
  SUMMARY_TEXT,
  textHashOf,
  withChoice,
  type SummaryChoiceKey,
  type SummaryChoices,
  type SummaryMark,
  type SummaryRunIO,
  type SummaryState,
  type SummaryStatusView,
} from "./steri-ai-summary-state";

/* ------------------------------------------------------------------ *
 * The hook
 * ------------------------------------------------------------------ */

/** What the device keeps for every screen of the page: the menu's choices and the drafts' marks. */
const DEVICE = createDeviceStore();

const nothing = () => null;

function useDeviceValue(key: string | null): string | null {
  const read = useCallback(() => DEVICE.read(key), [key]);
  // Not read on the server or while hydrating: the first render after brings it.
  return useSyncExternalStore(DEVICE.subscribe, read, nothing);
}

function subscribeOnline(listener: () => void): () => void {
  return browserConnectivity().subscribe(() => listener());
}
const onlineNow = () => browserConnectivity().isOnline();
const onlineOnServer = () => true;

/** navigator.onLine and its events: "offline" is reliable; a failed call still says it could not reach the server. */
function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, onlineNow, onlineOnServer);
}

export type SteriAiSummaryInput = {
  /** The screen's Steri-AI Summary (useSummaryAssist); null where it gives none, and nothing shows. */
  assist: SummaryAssist | null;
  /** The template's conclusion words, for "Choose PASSED, FAILED or HOLD first: …". */
  words: { pass: string; fail: string; hold: string };
  /** The inspector's conclusion now: Write waits for it, Polish My Text does not. */
  finalResult: InspectionResult | null;
  /** The Inspection Summary as stored. */
  value: RichTextDoc | null;
  /** Approved, submitted, not the user's, a save conflict or a refused save: nothing shows. */
  readOnly: boolean;
  /** The Inspection Summary editor's handle: every draft goes in through it, as one undo step. */
  editor: RefObject<RichTextEditorHandle | null>;
};

export type SteriAiSummary = {
  /** A provider, and the inspection can be changed here: render the button, the status line and the dialog. */
  shown: boolean;
  /** Steri-AI is writing: the editor's `busy`. */
  writing: boolean;
  online: boolean;
  /** No conclusion yet: Write is unavailable. */
  needsResult: boolean;
  /** The field holds text: Polish My Text is offered. */
  hasText: boolean;
  menu: SummaryMenu | null;
  /** What the menu shows: the inspector's choices, else the house style's. */
  choices: Required<SummaryChoices> | null;
  note: string;
  setNote: (note: string) => void;
  choose: <K extends SummaryChoiceKey>(key: K, value: NonNullable<SummaryChoices[K]>) => void;
  resetChoices: () => void;
  write: () => void;
  polish: () => void;
  regenerate: (kind: "again" | "shorter" | "longer") => void;
  undo: () => void;
  cancel: () => void;
  retry: () => void;
  dismissNotes: () => void;
  /** Replace Your Summary?: the draft waiting, and the three answers. */
  asking: SummaryState["asking"];
  fitsBelow: boolean;
  replace: () => void;
  addBelow: () => void;
  keep: () => void;
  status: SummaryStatusView;
  announcement: string;
  /** The status line's id: the button is described by it while it says something. */
  statusId: string;
  describedBy: string | undefined;
  /** Why Write Summary is unavailable now, for the menu; null when it is available. */
  writeBlocked: string | null;
  /** The main part of the button's id. */
  buttonId: string;
  /**
   * Focus to the main part, without scrolling: where a status line button
   * that goes once pressed (Cancel, Try Again, Shorter, Longer, Write Again,
   * Undo, Dismiss) leaves the keyboard focus, so it is never dropped
   * (docs/DESIGN.md; 12 October 2026).
   */
  focusButton: () => void;
};

/** The Steri-AI Summary button's state and actions, for the conclusion's Capture. */
export function useSteriAiSummary({ assist, words, finalResult, value, readOnly, editor }: SteriAiSummaryInput): SteriAiSummary {
  const statusId = useId();
  const online = useOnline();
  const menu = assist?.menu ?? null;
  const optionsKey = assist ? summaryOptionsKey(assist.userId) : null;
  const markKey = assist ? summaryDraftKey(assist.inspectionId, assist.userId) : null;
  const rawChoices = useDeviceValue(optionsKey);
  const rawMark = useDeviceValue(markKey);
  const kept = useMemo(() => (menu ? storedChoices(rawChoices, menu) : {}), [rawChoices, menu]);
  const mark = useMemo(() => parseMark(rawMark), [rawMark]);
  const textHash = useMemo(() => textHashOf(value), [value]);
  const [note, setNote] = useState("");
  const [state, dispatch] = useReducer(summaryReducer, INITIAL_SUMMARY_STATE);
  const buttonId = useId();
  const focusButton = useCallback(() => document.getElementById(buttonId)?.focus({ preventScroll: true }), [buttonId]);

  const shown = assist !== null && !readOnly;
  const needsResult = finalResult === null;
  const hasText = textHash !== null;

  // What a call that answers later needs to know about the screen then.
  const latest = useRef({ assist, value, mark, readOnly });
  useLayoutEffect(() => {
    latest.current = { assist, value, mark, readOnly };
  });
  const activeRun = useRef<number | null>(null);
  const lastRun = useRef(0);

  // After 15 s the line says it is still writing, and offers Cancel.
  const runId = state.run?.id;
  useEffect(() => {
    if (runId === undefined) return;
    const timer = setTimeout(() => dispatch({ type: "slow", id: runId }), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [runId]);

  const io = useCallback(
    (current: SummaryAssist): SummaryRunIO => ({
      menu: current.menu,
      draft: (options) => current.draft(options),
      isCurrent: (id) => activeRun.current === id && latest.current.assist !== null && !latest.current.readOnly,
      field: () => ({ value: latest.current.value, mark: latest.current.mark }),
      insert: (doc, mode) => editor.current?.insertDocument(doc, mode) ?? { applied: false },
      keepMark: (next: SummaryMark) => DEVICE.write(summaryDraftKey(current.inspectionId, current.userId), JSON.stringify(next)),
      dispatch,
      now: () => Date.now(),
    }),
    [editor],
  );

  const needsResultText = needsResultMessage(words);
  const start = useCallback(
    (options: SummaryOptions) => {
      const current = latest.current.assist;
      if (!current || activeRun.current !== null || state.asking) return;
      if (!online) {
        dispatch({ type: "blocked", notice: "offline", message: SUMMARY_MESSAGES.offline });
        return;
      }
      if (options.mode === "write" && needsResult) {
        dispatch({ type: "blocked", notice: "needs_result", message: needsResultText });
        return;
      }
      const id = lastRun.current + 1;
      lastRun.current = id;
      activeRun.current = id;
      void performSummaryRun(io(current), id, options).finally(() => {
        if (activeRun.current === id) activeRun.current = null;
      });
    },
    [io, needsResult, needsResultText, online, state.asking],
  );

  const write = useCallback(() => start(requestOptions("write", kept, note)), [start, kept, note]);
  const polish = useCallback(() => {
    if (hasText) start(requestOptions("polish", kept, note));
  }, [start, hasText, kept, note]);
  const regenerate = useCallback(
    (kind: "again" | "shorter" | "longer") => {
      if (mark && menu) start(regenerateOptions(mark, kind, menu, note));
    },
    [start, mark, menu, note],
  );
  const retry = useCallback(() => {
    if (state.error) start(state.error.retry);
  }, [start, state.error]);
  const cancel = useCallback(() => {
    activeRun.current = null;
    dispatch({ type: "cancelled" });
  }, []);

  const undo = useCallback(() => {
    if (!state.undo) return;
    const outcome = editor.current?.insertDocument(state.undo.before, "replace") ?? { applied: false };
    if (outcome.applied) dispatch({ type: "undone" });
  }, [editor, state.undo]);

  const dismissNotes = useCallback(() => {
    dispatch({ type: "dismissed" });
    if (markKey && mark && (mark.notes.length > 0 || mark.figures.length > 0)) {
      DEVICE.write(markKey, JSON.stringify({ ...mark, notes: [], figures: [] } satisfies SummaryMark));
    }
  }, [markKey, mark]);

  const choose = useCallback(
    <K extends SummaryChoiceKey>(key: K, choice: NonNullable<SummaryChoices[K]>) => {
      if (optionsKey && menu) DEVICE.write(optionsKey, JSON.stringify(withChoice(kept, key, choice, menu)));
    },
    [optionsKey, menu, kept],
  );
  const resetChoices = useCallback(() => {
    if (optionsKey) DEVICE.write(optionsKey, null);
  }, [optionsKey]);

  const asking = state.asking;
  const fits = asking ? fitsBelow(value, asking.draft.doc) : false;
  const answer = useCallback(
    (mode: "replace" | "below") => {
      const current = latest.current.assist;
      if (!asking || !current) return;
      if (mode === "below" && !fitsBelow(latest.current.value, asking.draft.doc)) return;
      applyDraft(io(current), { id: asking.id, options: asking.options, draft: asking.draft }, mode);
    },
    [asking, io],
  );
  const replace = useCallback(() => answer("replace"), [answer]);
  const addBelow = useCallback(() => answer("below"), [answer]);
  const keep = useCallback(() => dispatch({ type: "kept" }), []);

  const status = menu
    ? summaryStatus({ state, menu, online, needsResult, mark, textHash, basisNow: () => assist?.basisNow() ?? "" })
    : { activity: null, mark: null, notes: null };
  // A notice that no longer holds (back online, a conclusion chosen) leaves the live region too.
  const announcement =
    state.notice && status.activity?.kind !== "notice" && state.announcement === state.notice.message ? "" : state.announcement;

  return {
    shown,
    writing: shown && state.run !== null,
    online,
    needsResult,
    hasText,
    menu,
    choices: menu ? shownChoices(menu, kept) : null,
    note,
    setNote,
    choose,
    resetChoices,
    write,
    polish,
    regenerate,
    undo,
    cancel,
    retry,
    dismissNotes,
    asking,
    fitsBelow: fits,
    replace,
    addBelow,
    keep,
    status,
    announcement,
    statusId,
    describedBy: hasStatus(status) ? statusId : undefined,
    writeBlocked: !online ? SUMMARY_MESSAGES.offline : needsResult ? needsResultText : null,
    buttonId,
    focusButton,
  };
}

/* ------------------------------------------------------------------ *
 * The button
 * ------------------------------------------------------------------ */

/** Unavailable: greyed but focusable, as the signature pad's Undo (docs/DESIGN.md). */
const UNAVAILABLE =
  "aria-disabled:cursor-not-allowed aria-disabled:text-slate-400 aria-disabled:hover:border-input aria-disabled:hover:bg-card aria-disabled:hover:text-slate-400 aria-disabled:[&_svg]:text-slate-400";

/**
 * The split pill in the field's heading row: Steri-AI Summary writes at once
 * with the choices last used on this device; the chevron opens Summary
 * Options. 32 px with a mouse, 44 px on any touchscreen.
 */
export function SteriAiSummaryButton({ summary, className }: { summary: SteriAiSummary; className?: string }) {
  const [open, setOpen] = useState(false);
  const unavailable = !summary.online || summary.needsResult;
  return (
    <div role="group" aria-label={SUMMARY_TEXT.button} data-slot="steri-ai-summary" className={cn("inline-flex shrink-0 items-stretch", className)}>
      <Button
        id={summary.buttonId}
        type="button"
        variant="outline"
        size="sm"
        data-action="steri-ai-summary"
        aria-disabled={unavailable || undefined}
        aria-busy={summary.writing || undefined}
        aria-describedby={summary.describedBy}
        className={cn("relative rounded-r-none hover:z-10 focus-visible:z-10 touch:text-base", UNAVAILABLE)}
        onClick={() => {
          if (!summary.writing) summary.write();
        }}
      >
        {summary.writing ? <Spinner aria-hidden /> : <SparklesIcon aria-hidden className="text-brand-600" />}
        {/* Both words hold the width, so the chevron never moves while Steri-AI writes. */}
        <span className="grid">
          <span className={cn("col-start-1 row-start-1", summary.writing && "invisible")}>{SUMMARY_TEXT.button}</span>
          <span className={cn("col-start-1 row-start-1", !summary.writing && "invisible")}>{SUMMARY_TEXT.writingButton}</span>
        </span>
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={SUMMARY_TEXT.options}
            className="relative -ml-px w-8 rounded-l-none px-0 hover:z-10 focus-visible:z-10 touch:w-11 touch:px-0"
          >
            <ChevronDownIcon aria-hidden />
          </Button>
        </PopoverTrigger>
        {/* Wide enough for Format's longest choice beside Paragraphs and, with a mouse, for the foot on one row;
            it scrolls only where the window has no room. */}
        <PopoverContent
          align="end"
          aria-label={SUMMARY_TEXT.options}
          data-slot="steri-ai-summary-options"
          className="max-h-(--radix-popover-content-available-height) w-[28rem] max-w-[calc(100vw-2rem)] overflow-y-auto"
          // Locked to the house style, the note is the menu's first field: focusing it would raise the
          // iPad keyboard over the menu at once. The menu itself takes the focus (Tab reaches the note).
          onOpenAutoFocus={(event) => {
            if (summary.menu?.inspectorsCanAdjust !== false) return;
            event.preventDefault();
            if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus({ preventScroll: true });
          }}
        >
          <SummaryOptionsForm summary={summary} onDone={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

const LABEL = "text-sm leading-snug font-medium text-foreground touch:text-base";
const HINT = "text-sm text-muted-foreground";

/**
 * Summary Options: Length, Paragraphs, Format and Language (when two or more
 * are offered) while inspectors may adjust them, else the line that the
 * house style decides; the note; then Reset to House Style, Polish My Text
 * (only when the field has text) and Write Summary.
 */
export function SummaryOptionsForm({ summary, onDone }: { summary: SteriAiSummary; onDone: () => void }) {
  const baseId = useId();
  const ids = {
    length: `${baseId}-length`,
    paragraphs: `${baseId}-paragraphs`,
    format: `${baseId}-format`,
    language: `${baseId}-language`,
    note: `${baseId}-note`,
    noteHint: `${baseId}-note-hint`,
    polishHint: `${baseId}-polish-hint`,
    blocked: `${baseId}-blocked`,
  };
  const { menu, choices } = summary;
  if (!menu || !choices) return null;
  const languages = SUMMARY_LANGUAGES.filter((language) => menu.languagesOffered.includes(language.value));

  return (
    <div className="grid gap-3">
      {menu.inspectorsCanAdjust ? (
        <>
          <div className="grid gap-2">
            <span id={ids.length} className={LABEL}>
              {SUMMARY_FIELDS.length.label}
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              aria-labelledby={ids.length}
              value={choices.length}
              onValueChange={(next) => {
                const parsed = SummaryLengthSchema.safeParse(next);
                if (parsed.success) summary.choose("length", parsed.data);
              }}
              className="w-full"
            >
              {SUMMARY_LENGTHS.map((length) => (
                // Chosen in secondary (brand-100 / brand-700), as the editor's pressed controls.
                <ToggleGroupItem
                  key={length.value}
                  value={length.value}
                  className="flex-1 touch:text-base data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground"
                >
                  {length.shortLabel}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          {/* Paragraphs beside Format: its trigger says "Auto" short, its list "Auto (Follows Length)". */}
          <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 touch:grid-cols-[7rem_minmax(0,1fr)]">
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={ids.paragraphs} className={LABEL}>
                {SUMMARY_FIELDS.paragraphs.label}
              </Label>
              <Select
                value={String(choices.paragraphs)}
                onValueChange={(next) => {
                  const parsed = SummaryParagraphsSchema.safeParse(next === "auto" ? next : Number(next));
                  if (parsed.success) summary.choose("paragraphs", parsed.data);
                }}
              >
                <SelectTrigger id={ids.paragraphs} size="sm" className="w-full">
                  <SelectValue>{choices.paragraphs === "auto" ? "Auto" : String(choices.paragraphs)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SUMMARY_PARAGRAPHS.map((paragraphs) => (
                    <SelectItem key={paragraphs.value} value={String(paragraphs.value)}>
                      {paragraphs.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={ids.format} className={LABEL}>
                {SUMMARY_FIELDS.format.label}
              </Label>
              <Select
                value={choices.format}
                onValueChange={(next) => {
                  const parsed = SummaryFormatSchema.safeParse(next);
                  if (parsed.success) summary.choose("format", parsed.data);
                }}
              >
                <SelectTrigger id={ids.format} size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUMMARY_FORMATS.map((format) => (
                    <SelectItem key={format.value} value={format.value}>
                      {format.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {languageOffered(menu) && (
            <div className="grid gap-2">
              <Label htmlFor={ids.language} className={LABEL}>
                {SUMMARY_FIELDS.language.label}
              </Label>
              <Select
                value={choices.language}
                onValueChange={(next) => {
                  const parsed = SummaryLanguageSchema.safeParse(next);
                  if (parsed.success) summary.choose("language", parsed.data);
                }}
              >
                <SelectTrigger id={ids.language} size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {languages.map((language) => (
                    <SelectItem key={language.value} value={language.value}>
                      {language.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </>
      ) : (
        <p className={cn(HINT, "touch:text-base")}>{SUMMARY_MENU_TEXT.locked}</p>
      )}

      <div className="grid gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor={ids.note} className={LABEL}>
            {SUMMARY_MENU_TEXT.note.label}
          </Label>
          <span className={cn(HINT, "shrink-0 tabular-nums")}>
            {formatCount(summary.note.length)} of {formatCount(SUMMARY_LIMITS.note)}
          </span>
        </div>
        {/* Two lines to start (it grows with the text), so the menu fits above the button on an iPad. */}
        <Textarea
          id={ids.note}
          value={summary.note}
          maxLength={SUMMARY_LIMITS.note}
          aria-describedby={ids.noteHint}
          className="min-h-16 touch:min-h-16"
          onChange={(event) => summary.setNote(event.target.value)}
        />
        <p id={ids.noteHint} className={HINT}>
          {SUMMARY_MENU_TEXT.note.hint}
        </p>
      </div>

      <div className="grid gap-2 border-t border-border pt-3">
        {summary.hasText && (
          <p id={ids.polishHint} className={HINT}>
            {SUMMARY_MENU_TEXT.polish.hint}
          </p>
        )}
        {summary.writeBlocked && (
          <p id={ids.blocked} className={cn(HINT, "flex items-start gap-1.5")}>
            <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{summary.writeBlocked}</span>
          </p>
        )}
        {/* Reset at the start; the two actions stay together at the end, on a row of their own where both do not fit. */}
        <div className="flex flex-wrap items-center gap-2">
          {menu.inspectorsCanAdjust && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-8 px-0 touch:h-11 touch:px-0"
              onClick={summary.resetChoices}
            >
              {SUMMARY_TEXT.reset}
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {summary.hasText && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-describedby={ids.polishHint}
                aria-disabled={!summary.online || summary.writing || undefined}
                className={UNAVAILABLE}
                onClick={() => {
                  if (!summary.online || summary.writing) return;
                  onDone();
                  summary.polish();
                }}
              >
                {SUMMARY_MENU_TEXT.polish.label}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              aria-describedby={summary.writeBlocked ? ids.blocked : undefined}
              aria-disabled={summary.writeBlocked !== null || summary.writing || undefined}
              className="aria-disabled:cursor-not-allowed aria-disabled:bg-slate-200 aria-disabled:text-slate-600 aria-disabled:hover:bg-slate-200"
              onClick={() => {
                if (summary.writeBlocked !== null || summary.writing) return;
                onDone();
                summary.write();
              }}
            >
              {SUMMARY_TEXT.write}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The status line under the field
 * ------------------------------------------------------------------ */

/** Quiet ghost buttons, as the signature pad's: 32 px with a mouse, 44 px on touch, greyed but focusable at an end. */
const QUIET =
  "touch:text-base aria-disabled:cursor-not-allowed aria-disabled:text-slate-400 aria-disabled:hover:bg-transparent aria-disabled:hover:text-slate-400";

const LINE = "text-sm touch:text-base";

/**
 * Under the editor: the call's progress, its failure or why a press did
 * nothing; Steri-AI's draft while it is unedited; then its notes and the
 * figures to check. A live region beside it reads out each change.
 */
export function SteriAiSummaryStatus({ summary }: { summary: SteriAiSummary }) {
  const { activity, mark, notes } = summary.status;
  const line = useRef<HTMLDivElement>(null);
  // Every button here goes once pressed (a call starts, the draft or the notes go): the focus moves
  // to the button's main part rather than dropping to the page. Only when it was here: Safari does
  // not focus a button it clicks, and a tap never moves the focus.
  const keepFocus = (action: () => void) => () => {
    const focused = line.current?.contains(document.activeElement) ?? false;
    action();
    if (focused) summary.focusButton();
  };
  return (
    <div className="relative" data-slot="steri-ai-summary-status">
      <div ref={line} id={summary.statusId} className="space-y-2 empty:hidden">
        {activity?.kind === "writing" && (
          <div className={cn(LINE, "flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 text-brand-700 touch:min-h-11")}>
            <Spinner aria-hidden />
            <span>{activity.slow ? SUMMARY_TEXT.slow : SUMMARY_TEXT.writing}</span>
            {activity.slow && (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-8 px-1.5 touch:h-11 touch:px-2 touch:text-base"
                onClick={keepFocus(summary.cancel)}
              >
                {SUMMARY_TEXT.cancel}
              </Button>
            )}
          </div>
        )}
        {activity?.kind === "error" && (
          <div className={cn(LINE, "flex flex-wrap items-center gap-x-2 gap-y-1 text-fail")}>
            <p className="flex min-w-0 items-start gap-1.5">
              <OctagonXIcon aria-hidden className="mt-0.5 size-4 shrink-0 touch:mt-1" />
              <span>{activity.message}</span>
            </p>
            <Button type="button" variant="ghost" size="sm" className={QUIET} onClick={keepFocus(summary.retry)}>
              <RefreshCwIcon aria-hidden />
              {SUMMARY_TEXT.tryAgain}
            </Button>
          </div>
        )}
        {activity?.kind === "notice" && (
          <p className={cn(LINE, "flex items-start gap-1.5 text-muted-foreground")}>
            <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 touch:mt-1" />
            <span>{activity.message}</span>
          </p>
        )}
        {mark && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className={cn(LINE, "flex min-w-0 items-start gap-1.5", mark.stale ? "text-warn" : "text-muted-foreground")}>
              {mark.stale ? (
                <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 touch:mt-1" />
              ) : (
                <SparklesIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-600 touch:mt-1" />
              )}
              <span>{mark.line}</span>
            </p>
            <div className="flex flex-wrap items-center gap-1">
              {mark.shorter !== null && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={QUIET}
                  aria-disabled={mark.shorter === "off" || undefined}
                  onClick={() => {
                    if (mark.shorter === "on") keepFocus(() => summary.regenerate("shorter"))();
                  }}
                >
                  <FoldVerticalIcon aria-hidden />
                  {SUMMARY_TEXT.shorter}
                </Button>
              )}
              {mark.longer !== null && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={QUIET}
                  aria-disabled={mark.longer === "off" || undefined}
                  onClick={() => {
                    if (mark.longer === "on") keepFocus(() => summary.regenerate("longer"))();
                  }}
                >
                  <UnfoldVerticalIcon aria-hidden />
                  {SUMMARY_TEXT.longer}
                </Button>
              )}
              {mark.writeAgain && (
                <Button type="button" variant="ghost" size="sm" className={QUIET} onClick={keepFocus(() => summary.regenerate("again"))}>
                  <RefreshCwIcon aria-hidden />
                  {SUMMARY_TEXT.writeAgain}
                </Button>
              )}
              {mark.undo && (
                <Button type="button" variant="ghost" size="sm" className={QUIET} onClick={keepFocus(summary.undo)}>
                  <Undo2Icon aria-hidden />
                  {SUMMARY_TEXT.undo}
                </Button>
              )}
            </div>
          </div>
        )}
        {notes && (
          <div className={cn(LINE, "space-y-1")}>
            <div className="flex flex-wrap items-center justify-between gap-x-3">
              <p className="font-medium text-foreground">{notes.notes.length > 0 ? SUMMARY_TEXT.beforeYouSign : null}</p>
              <Button type="button" variant="ghost" size="sm" className={QUIET} onClick={keepFocus(summary.dismissNotes)}>
                {SUMMARY_TEXT.dismiss}
              </Button>
            </div>
            {notes.notes.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-foreground">
                {notes.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
            {notes.figures.length > 0 && (
              <p className="flex items-start gap-1.5 text-warn">
                <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 touch:mt-1" />
                <span>{figuresLine(notes.figures)}</span>
              </p>
            )}
            {notes.cut && (
              <p className="flex items-start gap-1.5 text-warn">
                <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 touch:mt-1" />
                <span>{SUMMARY_TEXT.cut}</span>
              </p>
            )}
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite" data-slot="steri-ai-summary-announcement">
        {summary.announcement}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Replace Your Summary?
 * ------------------------------------------------------------------ */

/**
 * Once a draft is ready and the field holds the inspector's own words:
 * Cancel (the first focus), Add Below (unavailable past the field's 5,000
 * characters) or Replace, with the draft to read.
 */
export function SteriAiSummaryDialog({ summary }: { summary: SteriAiSummary }) {
  const tooLongId = useId();
  const asking = summary.asking;
  return (
    <AlertDialog
      open={asking !== null}
      onOpenChange={(open) => {
        if (!open) summary.keep();
      }}
    >
      <AlertDialogContent
        data-slot="steri-ai-summary-dialog"
        className="data-[size=default]:sm:max-w-xl"
        // It opens without a trigger (once the draft is ready), and Radix gives the focus back to the
        // trigger: back to the button's main part instead, so it is never dropped.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          summary.focusButton();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{SUMMARY_TEXT.dialogTitle}</AlertDialogTitle>
          <AlertDialogDescription>{SUMMARY_TEXT.dialogBody}</AlertDialogDescription>
        </AlertDialogHeader>
        {asking && <ReplaceDialogBody draft={asking.draft.doc} fitsBelow={summary.fitsBelow} tooLongId={tooLongId} />}
        <AlertDialogFooter>
          {/* Radix gives Cancel the first focus. */}
          <AlertDialogCancel>{SUMMARY_TEXT.cancel}</AlertDialogCancel>
          <Button
            type="button"
            variant="outline"
            aria-disabled={!summary.fitsBelow || undefined}
            aria-describedby={summary.fitsBelow ? undefined : tooLongId}
            className={UNAVAILABLE}
            onClick={() => {
              if (summary.fitsBelow) summary.addBelow();
            }}
          >
            {SUMMARY_TEXT.addBelow}
          </Button>
          <Button type="button" onClick={summary.replace}>
            {SUMMARY_TEXT.replace}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The draft to read, in the field's read-only look, scrolling past 16 rem; then why Add Below is unavailable, if it is. */
export function ReplaceDialogBody({ draft, fitsBelow, tooLongId }: { draft: RichTextDoc; fitsBelow: boolean; tooLongId: string }) {
  return (
    <>
      <div
        role="region"
        aria-label={SUMMARY_TEXT.draftRegion}
        tabIndex={0}
        className="max-h-64 overflow-y-auto rounded-md border border-input bg-muted px-4 py-3 text-base outline-none focus-ring-inset"
      >
        <RichTextView doc={draft} />
      </div>
      {!fitsBelow && (
        <p id={tooLongId} className="flex items-start gap-1.5 text-sm text-warn touch:text-base">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 touch:mt-1" />
          <span>{SUMMARY_TEXT.tooLong}</span>
        </p>
      )}
    </>
  );
}
