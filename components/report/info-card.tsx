// The report's cards (the design): a white card edged in slate-200 for details
// (Page 1's client and order, Glove Information), a soft blue one for a
// passage (the Inspection Summary, a lab's details), and the label-over-value
// grid that fills them. Rounded as the website's cards are.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TYPE } from "./theme";

const TONE_CLASS = {
  plain: "border-slate-200 bg-white",
  soft: "border-slate-100 bg-brand-50",
} as const;

export type InfoCardProps = {
  /** The card's heading: "Glove Information". */
  title?: string;
  /** Beside the heading at the right: "Accept 0 · Reject 1". */
  aside?: ReactNode;
  tone?: keyof typeof TONE_CLASS;
  children: ReactNode;
  className?: string;
};

export function InfoCard({ title, aside, tone = "plain", children, className }: InfoCardProps) {
  return (
    <section data-slot="report-card" data-tone={tone} className={cn("rounded-[2.8mm] border-[0.3mm] px-[5mm] py-[4.5mm]", TONE_CLASS[tone], className)}>
      {(title || aside) && (
        <div className="mb-[3mm] flex items-baseline justify-between gap-[4mm]">
          {title && <h3 className={cn("font-sans text-slate-900", TYPE.block)}>{title}</h3>}
          {aside && <div className={cn("text-slate-600", TYPE.small)}>{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export type KeyValueItem = {
  key?: string;
  label: string;
  value: ReactNode;
  /** Across every column: a factory address. */
  wide?: boolean;
  /** Nothing recorded ("Not stated"): grey, not bold. */
  muted?: boolean;
};

export type KeyValueGridProps = {
  items: readonly KeyValueItem[];
  columns?: 1 | 2 | 3 | 4;
  className?: string;
};

const COLUMNS_CLASS = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" } as const;

/** Labels over values, in columns; a description list, so each value is read with its label. */
export function KeyValueGrid({ items, columns = 2, className }: KeyValueGridProps) {
  return (
    <dl data-slot="report-key-values" className={cn("grid gap-x-[6mm] gap-y-[3.2mm]", COLUMNS_CLASS[columns], className)}>
      {items.map((item) => (
        <div key={item.key ?? item.label} data-key={item.key} className={cn("min-w-0", item.wide && "col-span-full")}>
          <dt className={cn("text-slate-600", TYPE.small)}>{item.label}</dt>
          <dd className={cn("mt-[0.6mm] [overflow-wrap:anywhere]", item.muted ? "text-[10pt] leading-[1.35] text-slate-600" : cn("text-slate-900", TYPE.value))}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
