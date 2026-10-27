"use client";

// A long text shortened to its start, with Show More / Show Less. Both
// versions come rendered from the server; this only swaps them.
import { useId, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ShowMore({ preview, full }: { preview: ReactNode; full: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="space-y-2">
      <div id={id}>{open ? full : preview}</div>
      <Button
        type="button"
        variant="link"
        size="sm"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="h-auto px-0 touch:h-11"
      >
        {open ? "Show Less" : "Show More"}
        <ChevronDownIcon aria-hidden className={cn("transition-transform", open && "rotate-180")} />
      </Button>
    </div>
  );
}
