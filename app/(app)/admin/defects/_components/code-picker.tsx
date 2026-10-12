"use client";

// The defect codes a shortform counts under (Admin > Defects > Shortforms),
// picked from the library, never typed: up to three, one for each case its
// meaning names (IB: Defective Bead when major, Poor Beading when minor).
//
// No new library: cmdk is not installed, so it is the WAI-ARIA combobox
// pattern on Radix Popover. The button opens a search box (role combobox,
// aria-activedescendant) over a listbox: on desktop type and press Enter, on
// iPad tap a code (the search box is not focused, so the keyboard stays
// down). The list is drawn inside the panel, not in a portal: the panel is a
// modal sheet whose scroll lock would stop a list outside it from scrolling.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDownIcon, PlusIcon, XIcon } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { COARSE_QUERY } from "@/components/qc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pickerOptions, type LibraryCode } from "@/lib/admin/shortforms";
import { MAX_SHORTFORM_CODES } from "@/lib/schemas/ai-settings";
import { cn } from "@/lib/utils";
import { CodeProblemBadge } from "./badges";

type CodePickerProps = {
  /** The button's id: the panel focuses it when the codes have an error. */
  id: string;
  /** The codes chosen, in order. */
  value: readonly string[];
  onValueChange: (codes: string[]) => void;
  /** Every defect code, active or not, by name. Only active codes are offered. */
  library: readonly LibraryCode[];
  /** What the suggestions come from: the shortform and its meaning. */
  words: string;
  /** The hint and the error, for the button. */
  describedBy?: string;
  invalid?: boolean;
};

const OPTION = cn(
  "flex min-h-9 cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md px-2.5 py-1.5 text-sm select-none",
  "data-active:bg-accent data-active:text-accent-foreground touch:min-h-11 touch:text-base",
);

const GROUP_LABEL = "px-2.5 pt-2 pb-1 text-xs font-semibold text-muted-foreground touch:text-sm";

export function CodePicker({ id, value, onValueChange, library, words, describedBy, invalid }: CodePickerProps) {
  const baseId = useId();
  const popupId = `${baseId}-popup`;
  const searchId = `${baseId}-search`;
  const listId = `${baseId}-list`;
  const optionId = (code: string) => `${baseId}-option-${code}`;

  const chosenList = useRef<HTMLUListElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Where the keyboard goes once a pick or a removal has drawn: the button, or the last
  // remove button when the third code took the button away.
  const focusAfter = useRef<"trigger" | "last" | null>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);

  const byCode = new Map(library.map((row) => [row.code, row]));
  const { suggested, others } = pickerOptions(library, value, words, query);
  const options = [...suggested, ...others];
  const activeCode = active !== null && options.some((option) => option.code === active) ? active : (options[0]?.code ?? null);

  // Keep the active option in view as the arrows move through the list.
  useEffect(() => {
    if (!open || activeCode === null) return;
    document.getElementById(`${baseId}-option-${activeCode}`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeCode, baseId]);

  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    if (target === "trigger" && trigger.current) trigger.current.focus();
    else chosenList.current?.querySelector<HTMLElement>("li:last-child button")?.focus();
  }, [value]);

  function pick(code: string) {
    const next = [...value, code];
    focusAfter.current = next.length >= MAX_SHORTFORM_CODES ? "last" : "trigger";
    onValueChange(next);
    setOpen(false);
  }

  function remove(code: string) {
    focusAfter.current = "trigger";
    onValueChange(value.filter((chosen) => chosen !== code));
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter") {
      // Never the panel's form: Enter picks.
      event.preventDefault();
      if (activeCode !== null) pick(activeCode);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (options.length === 0) return;
    const index = options.findIndex((option) => option.code === activeCode);
    const next = event.key === "ArrowDown" ? Math.min(options.length - 1, index + 1) : Math.max(0, index - 1);
    setActive(options[next].code);
  }

  const renderOption = (option: LibraryCode) => (
    <div
      key={option.code}
      id={optionId(option.code)}
      role="option"
      aria-selected={option.code === activeCode}
      data-active={option.code === activeCode || undefined}
      data-code={option.code}
      className={OPTION}
      onClick={() => pick(option.code)}
      onPointerMove={() => option.code !== activeCode && setActive(option.code)}
    >
      <span className="[overflow-wrap:anywhere]">{option.name}</span>
      <span className="font-mono text-xs text-muted-foreground touch:text-sm">{option.code}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <ul ref={chosenList} className="flex flex-col gap-2" data-chosen-codes>
          {value.map((code) => {
            const row = byCode.get(code);
            const state = !row ? "unknown" : row.active ? null : "inactive";
            return (
              <li
                key={code}
                data-code={code}
                className="flex min-h-11 items-center gap-2 rounded-md border border-border bg-card py-1 pr-1 pl-3 fine:min-h-9"
              >
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm touch:text-base">
                  {row && <span className="font-medium text-foreground [overflow-wrap:anywhere]">{row.name}</span>}
                  <span className={cn("font-mono text-xs touch:text-sm", row ? "text-muted-foreground" : "text-foreground")}>
                    {code}
                  </span>
                </span>
                {state && <CodeProblemBadge state={state} />}
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${code}`} onClick={() => remove(code)}>
                  <XIcon aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {value.length < MAX_SHORTFORM_CODES && (
        <PopoverPrimitive.Root
          open={open}
          onOpenChange={(next) => {
            if (next) {
              setQuery("");
              setActive(null);
            }
            setOpen(next);
          }}
        >
          <PopoverPrimitive.Trigger asChild>
            <button
              ref={trigger}
              type="button"
              id={id}
              aria-haspopup="listbox"
              aria-expanded={open}
              // Only while the list is drawn: aria-controls must name an element that exists.
              aria-controls={open ? popupId : undefined}
              aria-describedby={describedBy}
              // The error is in the description; the edge shows it too.
              data-invalid={invalid || undefined}
              className={cn(
                "flex h-9 w-full min-w-0 items-center gap-1.5 rounded-md border border-input bg-card px-2.5 text-left text-base shadow-xs transition-[color,box-shadow] outline-none",
                "hover:border-primary focus-visible:border-ring focus-ring-inset data-invalid:border-destructive data-invalid:ring-3 data-invalid:ring-destructive/20",
                "fine:text-sm touch:h-11 touch:px-3 [&_svg]:size-4 [&_svg]:shrink-0",
              )}
            >
              {value.length === 0 ? (
                <span className="truncate text-muted-foreground">Choose a code</span>
              ) : (
                <>
                  <PlusIcon aria-hidden className="text-muted-foreground" />
                  <span className="truncate font-medium text-foreground">Add Another Code</span>
                </>
              )}
              <ChevronDownIcon aria-hidden className="ml-auto text-muted-foreground" />
            </button>
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Content
            id={popupId}
            align="start"
            sideOffset={4}
            collisionPadding={8}
            className={cn(
              "z-50 flex w-(--radix-popover-trigger-width) min-w-64 flex-col overflow-hidden rounded-md bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden",
              "max-h-[min(24rem,calc(var(--radix-popover-content-available-height)-0.5rem))]",
              "duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            )}
            onOpenAutoFocus={(event) => {
              // The search with a mouse; on touch the list, so the keyboard does not cover the codes.
              event.preventDefault();
              const typing = !window.matchMedia(COARSE_QUERY).matches;
              document.getElementById(typing ? searchId : listId)?.focus();
            }}
          >
            <div className="border-b border-border p-2">
              <Input
                id={searchId}
                role="combobox"
                aria-label="Search codes"
                aria-expanded
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={activeCode !== null ? optionId(activeCode) : undefined}
                placeholder="Search by code or name"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(null);
                }}
                onKeyDown={onKeyDown}
              />
            </div>
            <div
              id={listId}
              role="listbox"
              tabIndex={-1}
              aria-label="Defect codes"
              aria-activedescendant={activeCode !== null ? optionId(activeCode) : undefined}
              onKeyDown={onKeyDown}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 outline-none"
            >
              {suggested.length > 0 && (
                <div role="group" aria-labelledby={`${listId}-suggested`}>
                  <div id={`${listId}-suggested`} role="presentation" className={GROUP_LABEL}>
                    Suggested
                  </div>
                  {suggested.map(renderOption)}
                </div>
              )}
              {others.length > 0 && (
                <div role="group" aria-labelledby={`${listId}-others`}>
                  <div id={`${listId}-others`} role="presentation" className={GROUP_LABEL}>
                    {suggested.length > 0 ? "Every Other Active Code" : "Active Codes"}
                  </div>
                  {others.map(renderOption)}
                </div>
              )}
              {options.length === 0 && (
                <p className="px-2.5 py-3 text-sm text-muted-foreground touch:text-base">
                  {query.trim() ? `No active code matches “${query.trim()}”.` : "No other active code to choose."}
                </p>
              )}
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Root>
      )}
    </div>
  );
}
