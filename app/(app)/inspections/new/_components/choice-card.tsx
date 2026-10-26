"use client";

// One option of a RadioGroup as a card: the whole card is the target (at
// least 44 px on the iPad), the radio shows the choice and takes keyboard
// focus. Chosen: brand-500 edge on brand-50. Nothing fades when disabled, so
// text keeps its contrast while the form is sending.
import type { ReactNode, Ref } from "react";
import { RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

export function ChoiceCard({
  id,
  value,
  title,
  description,
  invalid = false,
  ref,
}: {
  id: string;
  value: string;
  title: ReactNode;
  description?: ReactNode;
  /** The group needs a choice: red edges, as a field with an error. */
  invalid?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <label
      htmlFor={id}
      data-slot="choice-card"
      className={cn(
        "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors",
        "hover:border-brand-300 has-data-checked:border-brand-500 has-data-checked:bg-brand-50",
        "has-disabled:cursor-not-allowed has-disabled:hover:border-border",
        invalid && "border-destructive hover:border-destructive",
      )}
    >
      <RadioGroupItem ref={ref} id={id} value={value} className="mt-0.5 touch:mt-0" />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-medium break-words text-foreground">{title}</span>
        {description && <span className="text-sm text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
}
