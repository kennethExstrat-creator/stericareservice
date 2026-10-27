// A printable document: its pages in order, each in its frame with the
// shared chrome and, where the chrome numbers them, "Page X of N" across the
// document (docs/REPORT.md). Given the report's model it draws the report in
// the plan's order: the Summary first, then each section and the photo
// records through their pages in SECTION_PAGES (components/report/sections)
// once built, "nothing entered yet" while their builder gives nothing. Given a paper, a chrome and page
// bodies it draws any other document on the same frame, the sampling plan
// sent to manufacturers among them (A4 landscape). Pure markup with no
// hooks: the print route renders it on the server at true size, and the
// Report page renders the same pages scaled.
import type { ReactNode } from "react";
import { reportPageChrome, type PageChrome, type ReportModel, type ReportPaper, type ReportPlanEntry } from "@/lib/report/model";
import { cn } from "@/lib/utils";
import { comingNextPages } from "./coming-next-page";
import { ReportPage } from "./report-page";
import { sectionPages, type SectionPagesProps } from "./sections";
import { summaryPages } from "./summary-page";

/** The bodies of one entry's pages, as many as its pageCount. */
function bodiesOf(entry: ReportPlanEntry, model: ReportModel): ReactNode[] {
  if (entry.kind === "summary") return summaryPages({ summary: model.summary, chrome: model.chrome, sizes: model.sizes });
  const content = model.sections[entry.key];
  const pages = sectionPages(entry.key);
  if (entry.built && content && pages) {
    return pages.Pages({ model, entry, content } as SectionPagesProps<typeof entry.key> as never);
  }
  return comingNextPages(entry);
}

/** A page's body with the key its frame takes. */
export type DocumentPage = { key: string; body: ReactNode };

/** Every page of the report, in print order. */
export function reportBodies(model: ReportModel): DocumentPage[] {
  return model.plan.flatMap((entry) => bodiesOf(entry, model).map((body, index) => ({ key: `${entry.key}-${index}`, body })));
}

export type ReportDocumentProps =
  /** The report, from its model: its paper, chrome and pages. */
  | { model: ReportModel; className?: string }
  /** Any document on the same frame: the paper (paperOf(size, orientation)), the chrome, the bodies. */
  | { paper: ReportPaper; chrome: PageChrome; pages: readonly DocumentPage[]; className?: string };

export function ReportDocument(props: ReportDocumentProps) {
  const { paper, chrome, pages } =
    "model" in props
      ? { paper: props.model.paper, chrome: reportPageChrome(props.model.chrome), pages: reportBodies(props.model) }
      : props;
  return (
    <div
      data-report-document
      data-page-size={paper.size}
      data-orientation={paper.orientation}
      data-pages={pages.length}
      className={cn("flex flex-col items-center gap-[8mm]", props.className)}
    >
      {pages.map(({ key, body }, index) => (
        <ReportPage key={key} paper={paper} chrome={chrome} number={index + 1} total={pages.length}>
          {body}
        </ReportPage>
      ))}
    </div>
  );
}
