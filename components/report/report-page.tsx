// One page at its true size, A4 or Letter, upright or turned, with the
// chrome every page of the new design shares: the thin blue-to-teal bar
// across the top, SteriCare's logo and letterhead (the address on a line of
// its own upright, beside the company's name on a landscape page, as the
// sampling plan sets it), a dark rule, the header band (its title in spaced
// capitals, a Draft tag where asked, its text at the right), and the footer
// (its left line and note, and its right: "Page 1 of 9", or the document's
// own words). The page breaks after itself when printed. The report and the
// sampling plan fill the chrome their own ways (PageChrome).
import type { ReactNode } from "react";
import type { PageChrome, ReportPaper } from "@/lib/report/model";
import { cn } from "@/lib/utils";
import { PAGE_GUTTER, PAPER_CLASS, TYPE } from "./theme";

export type ReportPageProps = {
  paper: ReportPaper;
  chrome: PageChrome;
  /** 1-based across the document; with `total`, "Page 1 of 9" where the chrome numbers its pages. */
  number?: number;
  total?: number;
  children: ReactNode;
  className?: string;
};

export function ReportPage({ paper, chrome, number, total, children, className }: ReportPageProps) {
  const numbered = chrome.numbered && number !== undefined && total !== undefined;
  return (
    <section
      data-report-page
      data-page={number}
      data-orientation={paper.orientation}
      aria-label={numbered ? `Page ${number} of ${total}` : chrome.bandTitle}
      className={cn(
        "relative flex shrink-0 break-after-page flex-col overflow-hidden bg-white font-sans text-slate-900",
        // Tints and bars print as drawn, not dropped to save ink.
        "[-webkit-print-color-adjust:exact] [print-color-adjust:exact]",
        PAPER_CLASS[paper.size][paper.orientation],
        className,
      )}
    >
      <div aria-hidden data-slot="report-top-bar" className="flex h-[1.6mm] shrink-0">
        <span className="w-[70%] bg-brand-600" />
        <span className="flex-1 bg-accent-500" />
      </div>
      <PageHeader chrome={chrome} landscape={paper.orientation === "landscape"} />
      <div data-slot="report-page-content" className={cn("relative min-h-0 flex-1 overflow-hidden pt-[4mm] pb-[3mm]", PAGE_GUTTER)}>
        {children}
      </div>
      <PageFooter chrome={chrome} pageText={numbered ? `Page ${number} of ${total}` : null} />
    </section>
  );
}

function PageHeader({ chrome, landscape }: { chrome: PageChrome; landscape: boolean }) {
  const { letterhead } = chrome;
  const company = (
    <span className="font-bold text-slate-900">
      {letterhead.company} ({letterhead.registration})
    </span>
  );
  return (
    <header data-slot="report-page-header" className={cn("shrink-0", landscape ? "pt-[5mm]" : "pt-[6.4mm]", PAGE_GUTTER)}>
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
        <address data-slot="report-letterhead" className={cn("text-right text-slate-600 not-italic", TYPE.small, "leading-[1.5]")}>
          {landscape ? (
            <p>
              {company} · {letterhead.address}
            </p>
          ) : (
            <>
              <p>{company}</p>
              <p>{letterhead.address}</p>
            </>
          )}
          <p>
            {letterhead.phone} · {letterhead.email} · {letterhead.website}
          </p>
        </address>
      </div>
      <div className={cn("border-t-[0.3mm] border-slate-900", landscape ? "mt-[2.8mm]" : "mt-[3.4mm]")} />
      <div className="flex items-center justify-between gap-[6mm] border-b-[0.3mm] border-slate-200 py-[2.2mm]">
        <p className="flex min-w-0 items-center gap-[2.6mm]">
          <span data-slot="report-band-title" className={cn("truncate text-brand-700", TYPE.kicker)}>
            {chrome.bandTitle}
          </span>
          {chrome.draft && <DraftTag />}
        </p>
        {chrome.bandAside && (
          <p data-slot="report-band-aside" className={cn("shrink-0 text-slate-600 tabular-nums", TYPE.small)}>
            {chrome.bandAside}
          </p>
        )}
      </div>
    </header>
  );
}

/** Until the inspection is approved: a small dashed tag beside the band's title, on every page. */
export function DraftTag() {
  return (
    <span
      data-slot="report-draft-tag"
      className="inline-flex shrink-0 items-center rounded-full border-[0.3mm] border-dashed border-slate-400 px-[2mm] py-[0.2mm] text-[7pt] leading-[1.4] font-bold tracking-[0.14em] text-slate-700 uppercase"
    >
      Draft
    </span>
  );
}

function PageFooter({ chrome, pageText }: { chrome: PageChrome; pageText: string | null }) {
  const right = chrome.footerRight ?? pageText;
  return (
    <footer data-slot="report-page-footer" className={cn("shrink-0 pb-[8mm]", PAGE_GUTTER)}>
      <div className={cn("flex items-end justify-between gap-[8mm] border-t-[0.3mm] border-slate-200 pt-[3mm]", TYPE.small)}>
        <div className="min-w-0 text-slate-600">
          {chrome.footerLeft && <p className="truncate">{chrome.footerLeft}</p>}
          {chrome.footerNote && (
            <p data-slot="report-footer-note" className="line-clamp-2 text-[7.5pt] leading-[1.4]">
              {chrome.footerNote}
            </p>
          )}
        </div>
        {right && (
          <p
            data-slot="report-footer-right"
            className={cn("shrink-0 tabular-nums", chrome.footerRight ? "text-slate-600" : "font-bold text-slate-900")}
          >
            {right}
          </p>
        )}
      </div>
    </footer>
  );
}
