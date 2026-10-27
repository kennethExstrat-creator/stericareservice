// The report's look (the new pre-shipment design, Kenneth, 27 October
// 2026), as literal class strings so Tailwind sees them: Outfit throughout
// (headings too, as the design sets them), the SteriCare blues and teal from
// the website's tokens (app/globals.css), quiet slate greys, rounded cards,
// and the app's status colours for results. Sizes in points and millimetres:
// a page is drawn at its true size and printed as it is. The sampling plan
// sent to manufacturers shares it.
import type { ReportOrientation, ReportPaper } from "@/lib/report/model";
import type { ReportPageSize } from "@/lib/schemas/report-options";

/** The paper at its true size, upright or turned. */
export const PAPER_CLASS: Readonly<Record<ReportPageSize, Readonly<Record<ReportOrientation, string>>>> = {
  a4: { portrait: "w-[210mm] h-[297mm]", landscape: "w-[297mm] h-[210mm]" },
  letter: { portrait: "w-[215.9mm] h-[279.4mm]", landscape: "w-[279.4mm] h-[215.9mm]" },
};

/** The page's side margins, which the header, the content and the footer share. */
export const PAGE_GUTTER = "px-[13mm]";

/** A page's content width in millimetres, inside the side margins: what a full-width chart is laid out at. */
export function contentWidth(paper: Pick<ReportPaper, "width">): number {
  return paper.width - 26;
}

export const TYPE = {
  /** Axis ticks, legends' small print. */
  tiny: "text-[7.5pt] leading-[1.3]",
  /** Labels, the letterhead, the footer, table headers. */
  small: "text-[8.5pt] leading-[1.4]",
  /** Body text and table cells. */
  body: "text-[9pt] leading-[1.5]",
  /** A value in a card. */
  value: "text-[10pt] leading-[1.35] font-semibold",
  /** A block's heading: "Order Mix by Size". */
  block: "text-[12pt] leading-[1.25] font-semibold tracking-[-0.01em]",
  /** A section's title. */
  title: "text-[21pt] leading-[1.15] font-bold tracking-[-0.02em]",
  /** Page 1's product name. */
  cover: "text-[23pt] leading-[1.12] font-bold tracking-[-0.02em]",
  /** The kicker over a title: capitals, spaced. */
  kicker: "text-[8.5pt] leading-[1.3] font-bold uppercase tracking-[0.16em]",
} as const;

/** A step of the blues, as an HTML fill, an SVG fill and the text that reads on it. */
export type SequenceStep = { fill: string; svg: string; text: string };

type Step = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;

const STEPS: Readonly<Record<Step, SequenceStep>> = {
  100: { fill: "bg-brand-100", svg: "fill-brand-100", text: "text-brand-900" },
  200: { fill: "bg-brand-200", svg: "fill-brand-200", text: "text-brand-950" },
  300: { fill: "bg-brand-300", svg: "fill-brand-300", text: "text-brand-950" },
  400: { fill: "bg-brand-400", svg: "fill-brand-400", text: "text-brand-950" },
  500: { fill: "bg-brand-500", svg: "fill-brand-500", text: "text-white" },
  600: { fill: "bg-brand-600", svg: "fill-brand-600", text: "text-white" },
  700: { fill: "bg-brand-700", svg: "fill-brand-700", text: "text-white" },
  800: { fill: "bg-brand-800", svg: "fill-brand-800", text: "text-white" },
  900: { fill: "bg-brand-900", svg: "fill-brand-900", text: "text-white" },
  950: { fill: "bg-brand-950", svg: "fill-brand-950", text: "text-white" },
};

/** Fewer parts spread as wide as the design's four (300, 500, 700, 900); more climb the whole scale. */
const LADDERS: Readonly<Record<number, readonly Step[]>> = {
  1: [500],
  2: [300, 700],
  3: [300, 500, 800],
  4: [300, 500, 700, 900],
};
const FULL_LADDER: readonly Step[] = [200, 300, 400, 500, 600, 700, 800, 900];

/** `count` steps of the blues, light to dark: a stacked bar's parts where they are not sizes. */
export function sequenceFor(count: number): SequenceStep[] {
  if (count <= 0) return [];
  const ladder =
    LADDERS[count] ?? Array.from({ length: count }, (_, index) => FULL_LADDER[Math.round((index * (FULL_LADDER.length - 1)) / (count - 1))]);
  return ladder.map((step) => STEPS[step]);
}

/** The letter sizes' blues in both designs (the report and the sampling plan): S light blue, M blue, L dark blue, XL navy. */
const LETTER_SIZE_STEP: Readonly<Record<string, Step>> = { XXS: 100, XS: 200, S: 300, M: 500, L: 700, XL: 900, XXL: 950 };

/**
 * A size's blue, the same wherever the size shows (the order mix, the size
 * chips, a table's columns): the letter sizes as both designs colour them,
 * any other size (5.5 to 9.0) by its place among the template's sizes,
 * light to dark.
 */
export function sizeTone(size: string, templateSizes: readonly string[] = []): SequenceStep {
  const letter = LETTER_SIZE_STEP[size.trim().toUpperCase()];
  if (letter) return STEPS[letter];
  const index = templateSizes.indexOf(size);
  if (index === -1 || templateSizes.length < 2) return STEPS[500];
  return STEPS[FULL_LADDER[Math.round((index * (FULL_LADDER.length - 1)) / (templateSizes.length - 1))]];
}
