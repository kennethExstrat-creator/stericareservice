"use client";

// "New inspection" is in place but switched off until capture arrives in
// Phase 2 (/inspections/new). It stays focusable (aria-disabled, not
// disabled) so the reason can be read: on hover or focus with a mouse or
// keyboard, and on a tap, because a finger on an iPad never hovers.
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const NEW_INSPECTION_HINT = "Inspection capture arrives in the next build";

export function NewInspectionButton() {
  const [open, setOpen] = useState(false);

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <Button
          type="button"
          aria-disabled="true"
          onClick={(event) => {
            // Stops Radix closing the tooltip on click, and shows it on a tap.
            event.preventDefault();
            setOpen(true);
          }}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-primary aria-disabled:active:translate-y-0 aria-disabled:active:bg-primary"
        >
          <PlusIcon aria-hidden />
          New inspection
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" sideOffset={6}>
        {NEW_INSPECTION_HINT}
      </TooltipContent>
    </Tooltip>
  );
}
