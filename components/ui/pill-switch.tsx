"use client";

// A pill switch (Kenneth, 11 October 2026): a soft capsule with the chosen
// side a white pill on it, as Source Documents' Files / Media switch
// (app/(app)/inspections/_components/source-tabs.tsx, which has the same
// classes). One side is always chosen.
import type { LucideIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export type PillOption<T extends string> = { value: T; label: string; icon: LucideIcon };

/** One side of the switch: 44 px on a touchscreen. */
const PILL =
  "h-8 gap-1.5 rounded-full px-4 font-semibold text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground touch:h-11 touch:px-5 data-[state=on]:bg-card data-[state=on]:text-brand-700 data-[state=on]:shadow-sm data-[state=on]:ring-1 data-[state=on]:ring-border";

export function PillSwitch<T extends string>({
  value,
  options,
  onValueChange,
  label,
  className,
  "data-testid": testId,
}: {
  value: T;
  options: readonly PillOption<T>[];
  onValueChange: (value: T) => void;
  /** The switch's accessible name. */
  label: string;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      spacing={1}
      value={value}
      // A click on the side already chosen answers "": the switch keeps its side.
      onValueChange={(next) => {
        const option = options.find((candidate) => candidate.value === next);
        if (option) onValueChange(option.value);
      }}
      aria-label={label}
      className={cn("rounded-full bg-muted p-1 ring-1 ring-border/60", className)}
      data-testid={testId}
    >
      {options.map(({ value: option, label: text, icon: Icon }) => (
        <ToggleGroupItem key={option} value={option} className={PILL}>
          <Icon aria-hidden />
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
