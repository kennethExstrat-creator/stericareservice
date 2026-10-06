"use client";

// A defect class (e.g. "Major Defects (AQL 2.5)") as tap-to-add chips with a
// live total. Order is the caller's: most-used defects first (BUILD_SPEC 8).
// A one-off label can be added; it is saved unmapped and flagged for an admin.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { PlusIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DefectChip } from "./defect-chip";

export type DefectChipItem = {
  key: string;
  label: string;
  count: number;
  unmapped?: boolean;
};

type DefectChipGroupProps = {
  /** Section heading in the template's wording. */
  legend: string;
  /** Limits or hints, e.g. "Accept 7 / Reject 8". */
  description?: ReactNode;
  items: readonly DefectChipItem[];
  onCountChange: (key: string, count: number) => void;
  /** Enables "Other defect": called with the trimmed one-off label. */
  onAddLabel?: (label: string) => void;
  disabled?: boolean;
  className?: string;
};

export function DefectChipGroup({
  legend,
  description,
  items,
  onCountChange,
  onAddLabel,
  disabled = false,
  className,
}: DefectChipGroupProps) {
  const id = useId();
  const [announcement, setAnnouncement] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const otherButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const total = items.reduce((sum, item) => sum + item.count, 0);

  // Closing the form unmounts the focused field; hand focus back to its opener.
  useEffect(() => {
    if (adding || !returnFocus.current) return;
    returnFocus.current = false;
    otherButton.current?.focus();
  }, [adding]);

  const closeForm = () => {
    returnFocus.current = true;
    setDraft("");
    setAdding(false);
  };

  const change = (item: DefectChipItem, count: number) => {
    onCountChange(item.key, count);
    setAnnouncement(`${item.label}: ${count}. Total ${total - item.count + count}.`);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const label = draft.trim();
    if (!label || !onAddLabel) return;
    onAddLabel(label);
    setAnnouncement(`Added ${label}.`);
    closeForm();
  };

  return (
    <fieldset
      data-slot="defect-chip-group"
      disabled={disabled}
      aria-describedby={`${id}-hint`}
      className={cn("min-w-0 space-y-3", className)}
    >
      {/* The legend names the group; the visible heading sits in a flex row,
          where a legend cannot. */}
      <legend className="sr-only">{legend}</legend>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p aria-hidden className="font-display text-base font-semibold text-foreground">
          {legend}
        </p>
        <p className="text-sm text-muted-foreground tabular-nums">
          Total <span className="font-semibold text-foreground">{total}</span>
        </p>
      </div>
      {description && <div className="text-sm text-muted-foreground">{description}</div>}
      <p id={`${id}-hint`} className="sr-only">
        Tap a defect to add one. Use its minus button to remove one.
      </p>

      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <DefectChip
            key={item.key}
            label={item.label}
            count={item.count}
            unmapped={item.unmapped}
            disabled={disabled}
            onIncrement={() => change(item, item.count + 1)}
            onDecrement={() => change(item, Math.max(0, item.count - 1))}
          />
        ))}

        {onAddLabel &&
          (adding ? (
            <form onSubmit={submit} className="flex w-full max-w-md items-center gap-2 sm:w-auto">
              <Input
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") closeForm();
                }}
                aria-label="Other defect label"
                placeholder="Describe the defect"
                maxLength={80}
                className="h-8 rounded-full px-3 sm:w-56"
              />
              <Button type="submit" size="sm" disabled={!draft.trim()}>
                Add
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={closeForm}>
                Cancel
              </Button>
            </form>
          ) : (
            <Button
              ref={otherButton}
              type="button"
              variant="ghost"
              size="sm"
              className="border border-dashed border-input text-muted-foreground"
              onClick={() => setAdding(true)}
            >
              <PlusIcon aria-hidden />
              Other defect
            </Button>
          ))}
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </fieldset>
  );
}
