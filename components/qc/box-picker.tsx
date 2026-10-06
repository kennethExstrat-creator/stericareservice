"use client";

// A box number picked from the size's carton list (BUILD_SPEC 6.2 rule 7:
// box numbers in dispensing and labelling are picked, never typed freely).
// The trigger opens the size's sampled cartons in ascending order with a
// search box: on desktop type the digits and press Enter, on iPad tap a box
// (the search box is not focused, so the keyboard stays down). Boxes picked
// in other rows are marked but stay selectable, since one carton can supply
// several inner boxes. A stored number that is not in the list (a slip
// carried over from paper, such as box 2336 in the STD_EG example) shows as
// an error until it is replaced. While the size has no carton list yet
// (carton sampling off or not filled in), the box number is typed and not
// checked, as docs/MODULES.md describes.
import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { bestOption, boxOptions, isUnlisted, moveInGrid, pickedElsewhere, readBoxNumber } from "./box-options";
import { caretOf } from "./grid-navigation";
import { issuePathProps, type IssuePath } from "./issue-path";

type BoxPickerProps = {
  value: number | null;
  onValueChange: (value: number | null) => void;
  /** The size's sampled carton numbers (`cartonsFor(context, size)`). */
  cartons: readonly number[];
  /** Every row's pick in this size, this row included: picks in other rows are marked. */
  used?: readonly (number | null | undefined)[];
  /** Accessible name, e.g. "Box #, item 3". */
  label: string;
  /** For messages, e.g. "size M". */
  sizeLabel?: string;
  /** "field" stands alone with its error below; "cell" fills a table cell. */
  variant?: "field" | "cell";
  placeholder?: string;
  /** Shown above the box number entry while the size has no carton list. */
  emptyMessage?: ReactNode;
  readOnly?: boolean;
  /** Marks the control for issue links (useIssueFocus). */
  issuePath?: IssuePath;
  /** For photo tags: the box is in focus. */
  onFocus?: () => void;
  id?: string;
  className?: string;
};

const OPTION =
  "relative flex h-10 cursor-pointer flex-col items-center justify-center rounded-md border border-transparent px-1 text-sm font-semibold tabular-nums transition-colors select-none touch:h-12 touch:text-base";

export function BoxPicker({
  value,
  onValueChange,
  cartons,
  used = [],
  label,
  sizeLabel,
  variant = "field",
  placeholder = "Pick box",
  emptyMessage,
  readOnly = false,
  issuePath,
  onFocus,
  id,
  className,
}: BoxPickerProps) {
  const baseId = useId();
  const triggerId = id ?? `${baseId}-trigger`;
  const errorId = `${baseId}-error`;
  const searchId = `${baseId}-search`;
  const listId = `${baseId}-list`;
  const popupId = `${baseId}-popup`;
  const optionId = (box: number) => `${baseId}-option-${box}`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const [columns, setColumns] = useState(5);

  const listed = boxOptions(cartons);
  const hasList = listed.length > 0;
  const unlisted = isUnlisted(value, listed);
  const options = boxOptions(listed, query);
  const elsewhere = pickedElsewhere(used, value);
  const activeBox = active !== null && options.includes(active) ? active : bestOption(options, query);
  const typed = readBoxNumber(query);
  const sizeText = sizeLabel ? ` for ${sizeLabel}` : "";
  const error = unlisted ? `Box ${value} is not in the carton list${sizeText}. Pick the box from the list.` : null;

  // Keep the active option in view as arrows move through a long list.
  useEffect(() => {
    if (!open || activeBox === null) return;
    document.getElementById(`${baseId}-option-${activeBox}`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeBox, baseId]);

  const pick = (box: number | null) => {
    if (box !== value) onValueChange(box);
    setOpen(false);
  };

  const onOpenChange = (next: boolean) => {
    if (readOnly) return;
    if (next) {
      setQuery("");
      setActive(value !== null && listed.includes(value) ? value : null);
      setColumns(window.matchMedia("(pointer: fine)").matches ? 5 : 4);
    }
    setOpen(next);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const box = hasList ? activeBox : typed;
      if (box !== null) pick(box);
      return;
    }
    if (!hasList) return;
    const input = event.currentTarget;
    const caret = caretOf(input.selectionStart, input.selectionEnd, input.value.length);
    // Left and right edit the search text unless the caret is already at that edge.
    if (event.key === "ArrowLeft" && caret !== "start" && caret !== "all") return;
    if (event.key === "ArrowRight" && caret !== "end" && caret !== "all") return;
    const index = activeBox === null ? -1 : options.indexOf(activeBox);
    const next = moveInGrid(event.key, index, options.length, columns);
    if (next === null) return;
    event.preventDefault();
    setActive(options[next]);
  };

  const display =
    value === null ? (
      <span className="truncate text-muted-foreground">{readOnly ? "—" : placeholder}</span>
    ) : (
      <span className="truncate font-semibold tabular-nums">{value}</span>
    );

  if (readOnly) {
    return (
      <span
        id={triggerId}
        data-slot="box-picker"
        data-invalid={unlisted || undefined}
        {...issuePathProps(issuePath)}
        className={cn(
          "inline-flex items-center gap-1.5 data-invalid:text-fail",
          variant === "cell" && "px-2.5",
          className,
        )}
      >
        <span className="sr-only">{label}: </span>
        {display}
        {unlisted && <TriangleAlertIcon aria-hidden className="size-4 shrink-0" />}
        {error && <span className="sr-only">. {error}</span>}
      </span>
    );
  }

  return (
    <div data-slot="box-picker" className={cn(variant === "field" && "space-y-1.5", className)} {...issuePathProps(issuePath)}>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          {/* A select-only combobox (WAI-ARIA APG): named by `label`, its text is the value. */}
          <button
            type="button"
            role="combobox"
            id={triggerId}
            aria-label={label}
            aria-expanded={open}
            aria-controls={popupId}
            aria-invalid={unlisted || undefined}
            aria-describedby={error ? errorId : undefined}
            onFocus={onFocus}
            className={cn(
              "flex w-full min-w-0 items-center gap-1.5 text-left outline-none transition-[color,box-shadow]",
              variant === "field" &&
                "h-9 rounded-md border border-input bg-card px-2.5 text-base shadow-xs hover:border-primary focus-visible:border-ring focus-ring aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 fine:text-sm touch:h-11 touch:px-3",
              variant === "cell" &&
                "h-8 rounded-none bg-transparent px-2.5 text-sm hover:bg-accent focus-visible:bg-card focus-ring-inset aria-invalid:bg-fail-tint aria-invalid:text-fail aria-invalid:ring-2 aria-invalid:ring-fail aria-invalid:ring-inset touch:h-11 touch:text-base",
              "aria-invalid:text-fail",
            )}
          >
            {display}
            {unlisted && <TriangleAlertIcon aria-hidden className="size-4 shrink-0" />}
            <ChevronDownIcon aria-hidden className="ml-auto size-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          id={popupId}
          align="start"
          aria-label={`${label}: carton list${sizeText}`}
          className="max-h-[calc(var(--radix-popover-content-available-height)-0.5rem)] w-[min(22rem,calc(100vw-2rem))] gap-3 p-3"
          onOpenAutoFocus={(event) => {
            // Focus the search on desktop. On touch focus the list itself, so
            // the on-screen keyboard does not cover the boxes; without a list
            // the box number has to be typed, so the field takes focus.
            event.preventDefault();
            const typing = !hasList || window.matchMedia("(pointer: fine)").matches;
            document.getElementById(typing ? searchId : listId)?.focus();
          }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-display text-base font-semibold text-foreground">
              Cartons{sizeLabel ? ` · ${sizeLabel}` : ""}
            </p>
            <p className="text-xs text-muted-foreground tabular-nums touch:text-sm">
              {hasList ? `${listed.length} sampled` : "No list yet"}
            </p>
          </div>

          {error && (
            <p className="flex items-start gap-1.5 rounded-md border border-fail-border bg-fail-tint px-2.5 py-2 text-sm text-fail">
              <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}

          {hasList ? (
            <>
              <Input
                id={searchId}
                role="combobox"
                aria-label="Find a box"
                aria-expanded
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={activeBox !== null ? optionId(activeBox) : undefined}
                inputMode="numeric"
                autoComplete="off"
                placeholder="Find a box"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(null);
                }}
                onKeyDown={onSearchKeyDown}
              />
              <div
                id={listId}
                role="listbox"
                tabIndex={-1}
                aria-label={`Cartons${sizeText}`}
                className="grid max-h-72 min-h-24 shrink grid-cols-4 content-start gap-1 overflow-y-auto overscroll-contain outline-none fine:grid-cols-5"
              >
                {options.map((box) => {
                  const selected = box === value;
                  const others = elsewhere.get(box) ?? 0;
                  return (
                    <div
                      key={box}
                      id={optionId(box)}
                      role="option"
                      aria-selected={selected}
                      data-active={box === activeBox || undefined}
                      data-used={others > 0 || undefined}
                      onClick={() => pick(box)}
                      onPointerMove={() => box !== activeBox && setActive(box)}
                      className={cn(
                        OPTION,
                        "bg-card text-foreground ring-1 ring-border hover:bg-accent",
                        "data-used:bg-slate-100 data-used:text-slate-700",
                        "data-active:border-ring data-active:ring-2 data-active:ring-ring/40",
                        "aria-selected:bg-primary aria-selected:text-primary-foreground aria-selected:ring-primary",
                      )}
                    >
                      <span className="leading-none">{box}</span>
                      {selected ? (
                        <span className="mt-0.5 inline-flex items-center gap-0.5 text-xs leading-none font-medium">
                          <CheckIcon aria-hidden className="size-3" />
                          Picked
                        </span>
                      ) : (
                        others > 0 && (
                          <span className="mt-0.5 text-xs leading-none font-medium text-muted-foreground">
                            Used{others > 1 ? ` ×${others}` : ""}
                          </span>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
              {options.length === 0 && (
                <p className="text-sm text-muted-foreground">No box in the list matches “{query}”.</p>
              )}
            </>
          ) : (
            <>
              <p className="rounded-md border border-dashed border-not-done-border bg-not-done-tint px-3 py-2.5 text-sm text-not-done touch:text-base">
                {emptyMessage ??
                  `No carton list${sizeText} yet. Type the box number; it is not checked until the cartons are entered.`}
              </p>
              <div className="flex items-center gap-2">
                <Input
                  id={searchId}
                  aria-label="Box number"
                  inputMode="numeric"
                  autoComplete="off"
                  enterKeyHint="done"
                  placeholder="Box number"
                  value={query}
                  aria-invalid={query.trim() !== "" && typed === null ? true : undefined}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onSearchKeyDown}
                />
                <Button type="button" size="sm" disabled={typed === null} onClick={() => typed !== null && pick(typed)}>
                  {typed === null ? "Use box" : `Use box ${typed}`}
                </Button>
              </div>
              {query.trim() !== "" && typed === null && (
                <p className="text-sm text-fail">A box number is a whole number from 1.</p>
              )}
            </>
          )}

          {value !== null && (
            <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => pick(null)}>
              Clear box
            </Button>
          )}
        </PopoverContent>
      </Popover>
      {error &&
        (variant === "field" ? (
          <p id={errorId} className="text-sm text-fail">
            {error}
          </p>
        ) : (
          <span id={errorId} className="sr-only">
            {error}
          </span>
        ))}
    </div>
  );
}
