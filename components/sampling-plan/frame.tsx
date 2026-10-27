// The sampling plan's page (Kenneth, 27 October 2026: the PDF he sent as
// its design): A4 landscape at its true size, with the report's chrome as
// that design sets it. The thin blue-to-teal bar across the top;
// SteriCare's logo, and its letterhead at the right (the company and its
// address on one line, the phone, email and website under it); a dark rule;
// the band, SAMPLING PLAN in spaced capitals with the PO and the inspection
// day at the right; and the footer, whom it is prepared for at the left and
// "Computer-generated document. No signature required." at the right. No
// page number and no Draft tag: the plan goes to the manufacturer before the
// inspection, whatever its status. Sizes in millimetres and points, as the
// report's pages are drawn (components/report/theme.ts), and printed as
// drawn (the print route's rules make it one sheet).
import type { ReactNode } from "react";
import { PAGE_GUTTER, PAPER_CLASS, TYPE } from "@/components/report/theme";
import type { SamplingPlanChrome } from "@/lib/sampling-plan/model";
import { cn } from "@/lib/utils";

export type SamplingPlanFrameProps = {
  chrome: SamplingPlanChrome;
  children: ReactNode;
  className?: string;
};

export function SamplingPlanFrame({ chrome, children, className }: SamplingPlanFrameProps) {
  const { letterhead } = chrome;
  return (
    <section
      data-sampling-plan-page
      aria-label={chrome.bandTitle}
      className={cn(
        "relative flex shrink-0 flex-col overflow-hidden bg-white font-sans text-slate-900",
        // Tints and bars print as drawn, not dropped to save ink.
        "[-webkit-print-color-adjust:exact] [print-color-adjust:exact]",
        PAPER_CLASS.a4.landscape,
        className,
      )}
    >
      <div aria-hidden data-slot="sampling-plan-top-bar" className="flex h-[1.6mm] shrink-0">
        <span className="w-[70%] bg-brand-600" />
        <span className="flex-1 bg-accent-500" />
      </div>
      <header data-slot="sampling-plan-header" className={cn("shrink-0 pt-[3.2mm]", PAGE_GUTTER)}>
        <div className="flex items-start justify-between gap-[8mm]">
          {/* The logo as the website draws it, at print resolution: nothing for next/image to do. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={letterhead.logo.src}
            width={letterhead.logo.width}
            height={letterhead.logo.height}
            alt="SteriCare"
            className="mt-[0.6mm] h-[8.8mm] w-auto shrink-0"
          />
          <address data-slot="sampling-plan-letterhead" className={cn("text-right text-slate-600 not-italic", TYPE.small, "leading-[1.5]")}>
            <p>
              <span className="font-bold text-slate-900">
                {letterhead.company} ({letterhead.registration})
              </span>{" "}
              · {letterhead.address}
            </p>
            <p>
              {letterhead.phone} · {letterhead.email} · {letterhead.website}
            </p>
          </address>
        </div>
        <div className="mt-[2.7mm] border-t-[0.3mm] border-slate-900" />
        <div className="flex items-center justify-between gap-[6mm] border-b-[0.25mm] border-slate-200 py-[1.9mm]">
          <p data-slot="sampling-plan-band-title" className={cn("min-w-0 truncate text-brand-700", TYPE.kicker)}>
            {chrome.bandTitle}
          </p>
          {chrome.bandAside && (
            <p data-slot="sampling-plan-band-aside" className={cn("shrink-0 text-slate-600 tabular-nums", TYPE.small)}>
              {chrome.bandAside}
            </p>
          )}
        </div>
      </header>
      <div data-slot="sampling-plan-content" className={cn("relative min-h-0 flex-1 overflow-hidden pt-[4.3mm] pb-[2mm]", PAGE_GUTTER)}>
        {children}
      </div>
      <footer data-slot="sampling-plan-footer" className={cn("shrink-0 pb-[6.4mm]", PAGE_GUTTER)}>
        <div className={cn("flex items-end justify-between gap-[8mm] border-t-[0.25mm] border-slate-200 pt-[2mm] text-slate-600", TYPE.small)}>
          <p className="min-w-0 truncate">{chrome.footerLeft}</p>
          <p data-slot="sampling-plan-footer-right" className="shrink-0">
            {chrome.footerRight}
          </p>
        </div>
      </footer>
    </section>
  );
}
