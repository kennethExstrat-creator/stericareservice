"use client";

// "+2 POs" beside the first PO of an inspection with several (PO parts,
// lib/inspections/parts.ts): a tap or a click opens every PO of the
// inspection with its product, status and result. A popover rather than a
// tooltip, so it opens on iPad too, where a tooltip never shows; with a mouse
// the first PO's own tooltip lists the POs as well (inspection-table.tsx).
// The list is rendered on the server and handed in as children.
//
// As tall as the row's other controls: 24 px with a mouse, so the row stays
// at 36 px, and 44 px with 16 px text on touch (docs/DESIGN.md).
import { useId, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function PoPartsButton({
  label,
  detail,
  title,
  children,
}: {
  /** "+2 POs". */
  label: string;
  /** Read after the label by screen readers: " in INS-2026-0001". */
  detail: string;
  /** The popover's heading: "INS-2026-0001: 3 POs". */
  title: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="xs" data-row-action="parts" className="relative touch:text-base">
          {label}
          <span className="sr-only">{detail}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-labelledby={titleId}
        className="w-auto max-w-[min(32rem,calc(100vw-2rem))] gap-2 p-3 touch:text-base"
      >
        <p id={titleId} className="font-semibold">
          {title}
        </p>
        {children}
      </PopoverContent>
    </Popover>
  );
}
