// A page's heading in the report (the design): the kicker after a short teal dash
// ("— SECTION 02", "— PHOTO RECORD 1 OF 3", set in capitals by CSS), the
// title, and the lead under it in grey. Page 1 uses it with its own kicker
// and the product's name as the larger cover title.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TYPE } from "./theme";

export type SectionHeadingProps = {
  /** "Section 02", "Photo Record 1 of 3": written in Title Case, shown in capitals. */
  kicker: string;
  title: string;
  /** One or two sentences under the title, in grey. */
  lead?: ReactNode;
  /** Beside the title at the right: "All values in mm · 13 gloves per size". */
  aside?: ReactNode;
  /** Page 1's product name, a size larger. */
  cover?: boolean;
  className?: string;
};

export function SectionHeading({ kicker, title, lead, aside, cover = false, className }: SectionHeadingProps) {
  return (
    <header data-slot="report-section-heading" className={cn("flex flex-col gap-[1.6mm]", className)}>
      <p className={cn("flex items-center gap-[2.6mm] text-brand-600", TYPE.kicker)}>
        <span aria-hidden className="h-[0.5mm] w-[4.6mm] shrink-0 rounded-full bg-accent-500" />
        <span>{kicker}</span>
      </p>
      <div className="flex items-end justify-between gap-[6mm]">
        {/* The report's own face: Outfit, as the design sets its titles. */}
        <h2 className={cn("min-w-0 font-sans text-slate-900 [overflow-wrap:anywhere]", cover ? TYPE.cover : TYPE.title)}>{title}</h2>
        {aside && <div className={cn("shrink-0 pb-[1mm] text-right text-slate-600", TYPE.small)}>{aside}</div>}
      </div>
      {lead && <div className={cn("max-w-[175mm] text-slate-600", "text-[9.5pt] leading-[1.5]")}>{lead}</div>}
    </header>
  );
}

/** A block's heading inside a page: "Order Mix by Size", with what it adds at the right (totals, a legend). */
export function BlockHeading({ title, aside, className }: { title: string; aside?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-baseline justify-between gap-x-[6mm] gap-y-[1mm]", className)}>
      <h3 className={cn("font-sans text-slate-900", TYPE.block)}>{title}</h3>
      {aside && <div className={cn("text-slate-600", TYPE.small)}>{aside}</div>}
    </div>
  );
}
