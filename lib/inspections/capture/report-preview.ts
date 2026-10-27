// The Report page's layout preview (Kenneth, 27 October 2026: "for the
// report template design, i will give u later, build the visual framework
// first"): the report's pages as blocks laid out from the options, never the
// report itself. Pure: the page draws what this lays out, and the tests read
// it. Measures are millimetres on the chosen paper (REPORT_PAGE_SIZES).
//
// Every page has the running header (the reference number) and the footer
// (the footer note, the page number). The first starts with the cover block:
// the title, the client while it is shown, the reference number. Then each
// step in the report, in step order: a block with its title bar and table
// lines and, while photos are on, its photo grid, the chosen count at the
// chosen size (Small 4, Medium 3, Large 2 to a row). Then the Inspection
// Summary and the inspector's signature, while each is on. A block that
// does not fit goes to the next page: a step's title stays with its table
// and the first row of its photos, and its other rows follow row by row;
// the summary stays with the signature.
// Labels are drawn larger than a report would print them, so a thumbnail
// reads.
import { REPORT_PAGE_SIZES, type ReportOptions, type ReportPageSize, type ReportPhotoSize } from "@/lib/schemas/report-options";
import { reportFooterNote, reportTitle, stepInReport, type ReportStep } from "./report";

/** Photos to a row, by size. */
export const PHOTOS_PER_ROW: Readonly<Record<ReportPhotoSize, number>> = { small: 4, medium: 3, large: 2 };

/** The layout's measures, in millimetres. */
export const PREVIEW_LAYOUT = {
  /** Around the page. */
  margin: 14,
  /** The running header's band, under the top margin, and the footer's, above the bottom one. */
  header: 9,
  footer: 9,
  /** Between blocks. */
  gap: 6,
  /** Between a step's table and its photos, and between rows of photos. */
  photoGap: 3,
  cover: 40,
  /** A step's title bar and four table lines. */
  section: 34,
  summary: 36,
  signature: 28,
} as const;

export type PreviewBlock =
  | { kind: "cover"; title: string; client: string | null; refNo: string }
  | { kind: "section"; key: string; label: string; title: string }
  /** A step's photos on one page: `count` tiles, `perRow` to a row (all of them, or what fits after a page break). */
  | { kind: "photos"; key: string; label: string; count: number; perRow: number; size: ReportPhotoSize }
  | { kind: "summary" }
  | { kind: "signature"; inspector: string };

/** A block where it sits on its page: `top` from the page's top edge and `height`, in mm. */
export type PlacedBlock = PreviewBlock & { top: number; height: number };

export type PreviewPage = { number: number; blocks: PlacedBlock[] };

export type ReportPreview = {
  pageSize: ReportPageSize;
  /** The paper, in mm: the page's ratio. */
  width: number;
  height: number;
  /** In mm, for the page's own margins, header and footer. */
  layout: typeof PREVIEW_LAYOUT;
  pages: PreviewPage[];
  /** The running header: the inspection's reference number. */
  header: string;
  /** The footer note on every page; null for none. */
  footer: string | null;
};

export type PreviewInput = {
  options: ReportOptions;
  /** The inspection's steps, in step order (reportSteps); those switched off on the Report page are left out here. */
  steps: readonly ReportStep[];
  refNo: string;
  clientName: string | null;
  inspectorName: string;
};

/** What flows down the pages: a block, its height, the space above it, and whether it stays with the next one. */
type Flow = { block: PreviewBlock; height: number; gapBefore: number; keepWithNext: boolean };

export function reportPreview({ options, steps, refNo, clientName, inspectorName }: PreviewInput): ReportPreview {
  const paper = REPORT_PAGE_SIZES.find((size) => size.value === options.pageSize) ?? REPORT_PAGE_SIZES[0];
  const layout = PREVIEW_LAYOUT;
  const contentWidth = paper.width - 2 * layout.margin;
  const top = layout.margin + layout.header + layout.gap;
  const bottom = paper.height - layout.margin - layout.footer - layout.gap;

  const perRow = PHOTOS_PER_ROW[options.photoSize];
  const tileHeight = (((contentWidth - (perRow - 1) * layout.photoGap) / perRow) * 3) / 4;

  const flow: Flow[] = [
    {
      block: { kind: "cover", title: reportTitle(options), client: options.showClientName ? clientName : null, refNo },
      height: layout.cover,
      gapBefore: 0,
      keepWithNext: false,
    },
  ];
  for (const step of steps) {
    if (!stepInReport(options, step.key)) continue;
    const rows = options.includePhotos ? photoRows(options.photosPerStep, perRow) : [];
    flow.push({
      block: { kind: "section", key: step.key, label: step.shortTitle, title: step.title },
      height: layout.section,
      gapBefore: layout.gap,
      keepWithNext: rows.length > 0,
    });
    for (const count of rows) {
      flow.push({
        block: { kind: "photos", key: step.key, label: step.shortTitle, count, perRow, size: options.photoSize },
        height: tileHeight,
        gapBefore: layout.photoGap,
        keepWithNext: false,
      });
    }
  }
  // The signature is never alone on the last page: the summary goes with it.
  if (options.includeSummary) {
    flow.push({ block: { kind: "summary" }, height: layout.summary, gapBefore: layout.gap, keepWithNext: options.includeSignature });
  }
  if (options.includeSignature) {
    flow.push({ block: { kind: "signature", inspector: inspectorName }, height: layout.signature, gapBefore: layout.gap, keepWithNext: false });
  }

  return {
    pageSize: paper.value,
    width: paper.width,
    height: paper.height,
    layout,
    pages: paginate(flow, top, bottom).map((blocks, index) => ({ number: index + 1, blocks: joinPhotoRows(blocks) })),
    header: refNo,
    footer: reportFooterNote(options),
  };
}

/** `count` photos as rows of `perRow`: 4 Medium photos are a row of 3 and a row of 1. */
function photoRows(count: number, perRow: number): number[] {
  const rows: number[] = [];
  for (let left = count; left > 0; left -= perRow) rows.push(Math.min(perRow, left));
  return rows;
}

/**
 * The flow on pages from `top` to `bottom`: a block that does not fit, with
 * the next one when it stays with it, starts a new page. A block alone on
 * a page stays there whatever its height.
 */
function paginate(flow: readonly Flow[], top: number, bottom: number): PlacedBlock[][] {
  const pages: PlacedBlock[][] = [[]];
  let y = top;
  flow.forEach((item, index) => {
    let page = pages[pages.length - 1];
    const next = item.keepWithNext ? flow[index + 1] : undefined;
    const needed = item.gapBefore + item.height + (next ? next.gapBefore + next.height : 0);
    if (page.length > 0 && y + needed > bottom) {
      page = [];
      pages.push(page);
      y = top;
    } else if (page.length > 0) {
      y += item.gapBefore;
    }
    page.push({ ...item.block, top: y, height: item.height });
    y += item.height;
  });
  return pages;
}

/** A step's rows of photos on one page as one grid. */
function joinPhotoRows(blocks: readonly PlacedBlock[]): PlacedBlock[] {
  const joined: PlacedBlock[] = [];
  for (const block of blocks) {
    const last = joined[joined.length - 1];
    if (block.kind === "photos" && last?.kind === "photos" && last.key === block.key) {
      joined[joined.length - 1] = { ...last, count: last.count + block.count, height: block.top + block.height - last.top };
    } else {
      joined.push(block);
    }
  }
  return joined;
}
