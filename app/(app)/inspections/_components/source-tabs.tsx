"use client";

// Source Documents' Files / Media switch (Kenneth, 11 October 2026): a pill
// switch, a soft capsule with the chosen side a white pill on it. The same
// on the capture screen's step and on New Inspection's card.
import { FileTextIcon, ImagesIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type SourceTab = "files" | "media";

/** One side of the switch: 44 px on a touchscreen. */
const PILL =
  "h-8 gap-1.5 rounded-full px-4 font-semibold text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground touch:h-11 touch:px-5 data-[state=on]:bg-card data-[state=on]:text-brand-700 data-[state=on]:shadow-sm data-[state=on]:ring-1 data-[state=on]:ring-border";

export function SourceTabs({ value, onValueChange }: { value: SourceTab; onValueChange: (tab: SourceTab) => void }) {
  return (
    <ToggleGroup
      type="single"
      spacing={1}
      value={value}
      // A click on the side already chosen answers "": the switch keeps its side.
      onValueChange={(next) => (next === "files" || next === "media") && onValueChange(next)}
      aria-label="Show"
      className="rounded-full bg-muted p-1 ring-1 ring-border/60"
      data-testid="source-tabs"
    >
      <ToggleGroupItem value="files" className={PILL}>
        <FileTextIcon aria-hidden />
        Files
      </ToggleGroupItem>
      <ToggleGroupItem value="media" className={PILL}>
        <ImagesIcon aria-hidden />
        Media
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
