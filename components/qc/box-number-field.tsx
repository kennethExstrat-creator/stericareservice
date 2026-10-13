"use client";

// A box/carton number (BUILD_SPEC 6.2 rule 7; Kenneth, 13 October 2026: box #
// and carton # are one number, "yes link again", reversing 12 October). It is
// typed on the numeric keypad as any NumberField: Enter walks its group, a
// pasted column fills down, refused text stays with its reason and, with
// `issuePath`, outlives the field. While it is typed, the size's sampled
// box/carton numbers (`cartons`: cartonsFor(context, size), which
// carton_sampling contributes) show as suggestions under it: those holding
// the digits typed, ascending, the ones other rows hold marked "Used" and
// still offered (one carton can supply several inner boxes). A tap on a
// suggestion (iPad), or the arrows and Enter (desktop), fills it in, and
// Enter then walks on as after typing; the down arrow also opens the list
// with nothing typed. Typing never waits for the list or goes through it:
// Enter with no suggestion chosen stores what was typed, and a press on the
// list never takes the focus, so the keypad stays up. The list refuses
// nothing: a number the size's list does not hold is calc's warning on the
// field (box_not_in_carton_list). While the size has no list, there are no
// suggestions and the field is a plain number field.
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type TouchEvent,
} from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { boxOptions, moveSuggestion, pickedElsewhere, showsSuggestions, usedNote } from "./box-options";
import { FILL_EVENT, type FillRequest } from "./field-navigation";
import { NumberField, type NumberFieldInputProps, type NumberFieldProps } from "./number-field";

export type BoxNumberFieldProps = Omit<
  NumberFieldProps,
  "unit" | "min" | "max" | "minExclusive" | "integer" | "decimals" | "inputMode" | "onDraftChange" | "inputProps"
> & {
  /** The size's sampled box/carton numbers (`cartonsFor(context, size)`): the suggestions. None, no suggestions. */
  cartons?: readonly number[];
  /** Every row's number in this field's list, its own included: those other rows hold are marked "Used". */
  used?: readonly (number | null | undefined)[];
};

/** The keys that move through the suggestions (moveSuggestion). */
const LIST_KEYS: ReadonlySet<string> = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp"]);

/** A press on the list leaves the focus in the field: the iPad's keypad stays up and nothing is committed. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

/** How far a finger may move on a suggestion and still tap it, in px: further is a scroll of the list. */
const TAP_SLOP = 10;

// A suggestion: 32 px with a mouse, 44 px on any touchscreen; the one the arrows chose in the brand's tint.
const OPTION =
  "flex min-h-8 cursor-pointer items-center justify-between gap-3 rounded-sm px-2.5 py-1 text-sm tabular-nums select-none hover:bg-accent touch:min-h-11 touch:text-base data-active:bg-brand-50 data-active:ring-2 data-active:ring-brand-500 data-active:ring-inset";

export function BoxNumberField({
  cartons = [],
  used = [],
  id,
  value,
  readOnly = false,
  onFocus,
  ...props
}: BoxNumberFieldProps) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const listId = `${inputId}-suggestions`;
  const optionId = (box: number) => `${listId}-${box}`;
  const anchor = useRef<HTMLDivElement>(null);
  // What is typed since the field took the focus (null while nothing is), and a list the down arrow opened.
  const [typed, setTyped] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  // Closed with Escape or a press elsewhere, until the next key typed or the next focus.
  const [dismissed, setDismissed] = useState(false);
  // The suggestion chosen with the arrows; none until the arrows move.
  const [active, setActive] = useState<number | null>(null);
  // Where a finger came down on a suggestion, to tell a tap from a scroll of the list.
  const touch = useRef<{ box: number; x: number; y: number } | null>(null);

  const listed = boxOptions(cartons);
  const options = boxOptions(listed, typed ?? "");
  const open = !dismissed && showsSuggestions({ readOnly, typed, browsing, options: options.length });
  const activeBox = open && active !== null && options.includes(active) ? active : null;
  const elsewhere = pickedElsewhere(used, value);

  // Keeps the chosen suggestion in view as the arrows move through a long list.
  useEffect(() => {
    if (activeBox === null) return;
    document.getElementById(`${listId}-${activeBox}`)?.scrollIntoView({ block: "nearest" });
  }, [activeBox, listId]);

  const closeList = () => {
    setBrowsing(false);
    setActive(null);
  };

  /**
   * Fills in `box` as a pasted column hands a field its value (FILL_EVENT):
   * stored by the field's own rules, the text typed dropped, the focus kept.
   */
  const pick = (box: number) => {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.dispatchEvent(new CustomEvent<FillRequest>(FILL_EVENT, { detail: { raw: String(box) } }));
    closeList();
  };

  /**
   * A finger lifted where it came down picks the suggestion at once, and the
   * touch is cancelled, so no mouse events or click follow: the field keeps
   * the focus and the keypad. A click (a mouse, a trackpad) picks through
   * onClick: the capture screen leaves a field on a click outside its page,
   * but not on one in the list the field controls (click-leaves-field.ts).
   * A finger that moved scrolled the list: nothing is picked.
   */
  const onTouchEnd = (event: TouchEvent<HTMLDivElement>, box: number) => {
    const start = touch.current;
    touch.current = null;
    const end = event.changedTouches[0];
    if (!start || start.box !== box || !end) return;
    if (Math.abs(end.clientX - start.x) > TAP_SLOP || Math.abs(end.clientY - start.y) > TAP_SLOP) return;
    event.preventDefault();
    pick(box);
  };

  // Before the field's own keys: an Enter on a chosen suggestion fills it in first, so the field's Enter
  // finds nothing typed to commit and walks on; the arrows move the choice and never the caret.
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (readOnly || listed.length === 0 || (event.target as HTMLElement).id !== inputId) return;
    if (event.key === "Enter") {
      if (activeBox !== null) pick(activeBox);
      return;
    }
    if (!LIST_KEYS.has(event.key) || event.altKey || event.metaKey || event.ctrlKey) return;
    // Closed, the down arrow (or the up arrow, from the end) opens the list for what is typed, all of it if nothing is.
    const shown = open ? options : boxOptions(listed, typed ?? "");
    if (shown.length === 0) return;
    const next = moveSuggestion(event.key, activeBox === null ? -1 : shown.indexOf(activeBox), shown.length);
    if (next === null) return;
    event.preventDefault();
    setBrowsing(true);
    setDismissed(false);
    setActive(shown[next]);
  };

  // The edit ends when the focus leaves: the list goes with it.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    closeList();
    setDismissed(false);
  };

  const inputProps: NumberFieldInputProps | undefined =
    readOnly || listed.length === 0
      ? undefined
      : {
          role: "combobox",
          "aria-autocomplete": "list",
          "aria-expanded": open,
          // Only while the list is rendered: aria-controls must name an element that exists.
          "aria-controls": open ? listId : undefined,
          "aria-activedescendant": activeBox === null ? undefined : optionId(activeBox),
        };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Escape, or a press outside the field and the list.
        if (next) return;
        setDismissed(true);
        closeList();
      }}
    >
      <PopoverAnchor asChild>
        <div ref={anchor} data-slot="box-number-field" className="min-w-0" onKeyDownCapture={onKeyDownCapture} onBlur={onBlur}>
          <NumberField
            {...props}
            id={inputId}
            value={value}
            readOnly={readOnly}
            integer
            min={1}
            inputMode="numeric"
            inputProps={inputProps}
            onDraftChange={(draft) => {
              setTyped(draft);
              setActive(null);
              if (draft !== null) setDismissed(false);
              else setBrowsing(false);
            }}
            onFocus={() => {
              setDismissed(false);
              onFocus?.();
            }}
          />
        </div>
      </PopoverAnchor>
      {/* Rendered only while open: closed, it goes at once, never left in an exit animation with every
          number in it (Radix keeps a closing popover mounted until its animation ends). */}
      {open && (
        <PopoverContent
          id={listId}
          role="listbox"
          aria-label="Sampled box/carton numbers"
          side="bottom"
          align="start"
          sideOffset={2}
          // The focus stays in the field the whole time: the keypad stays up and typing goes on.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            // A press in the field itself (to move the caret) leaves the list open.
            if (anchor.current?.contains(event.target as Node | null)) event.preventDefault();
          }}
          onMouseDown={keepFocus}
          className="max-h-[min(16rem,var(--radix-popover-content-available-height))] w-auto max-w-[calc(100vw-2rem)] min-w-[max(var(--radix-popover-trigger-width),8rem)] gap-0 overflow-y-auto overscroll-contain p-1"
        >
          {options.map((box) => {
            const note = usedNote(elsewhere.get(box) ?? 0);
            return (
              <div
                key={box}
                id={optionId(box)}
                role="option"
                aria-selected={box === activeBox}
                // Its number and, when another row holds it, so (WCAG 2.5.3: the words shown come first).
                aria-label={note ? `${box}, used ${note.spoken}` : undefined}
                // Only the arrows choose one for Enter: a pointer resting on the list never changes what Enter stores.
                data-active={box === activeBox || undefined}
                onTouchStart={(event) => {
                  const start = event.touches[0];
                  touch.current = start ? { box, x: start.clientX, y: start.clientY } : null;
                }}
                onTouchEnd={(event) => onTouchEnd(event, box)}
                onClick={() => pick(box)}
                className={OPTION}
              >
                <span className="font-semibold">{box}</span>
                {note && <span className="text-xs font-medium text-muted-foreground touch:text-sm">{note.shown}</span>}
              </div>
            );
          })}
        </PopoverContent>
      )}
    </Popover>
  );
}
