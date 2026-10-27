// Section 08, Packaging Labelling & Conclusion (TG35 page 8), from its slot
// (lib/report/sections/labellingConclusion.ts): the lead; a card per
// labelling level, its limit at the top right, a row per check with each
// size's count (Boxes Inspected first, Defects Found tinted, a failing count
// red), and the result's chip; the results matrix, a status tick per check
// and size with its legend; and the conclusion card in the result's colours
// (passed green, failed red, on hold amber), the date, the inspector's
// signature over its line and the remark. A part the options switch off is
// left out; a part page one cannot hold is on the next.
//
// Typed by SectionPages, never importing the registry at run time, and the
// primitives from their own files (not ../index, which lists these pages).
import type { ReactNode } from "react";
import { STATUS_LABEL } from "@/lib/design/status";
import { formatCount } from "@/lib/format";
import type { CheckStatus } from "@/lib/report/checks";
import {
  NOT_STATED,
  type FinalConclusion,
  type LabelCell,
  type LabelLevelCard,
  type LabellingBlock,
  type LabellingConclusionSection,
  type ReportConclusion,
  type ReportStatus,
  type ResultsMatrix,
  type SignatureDrawing,
} from "@/lib/report/model";
import { cardSizeColumn, LABEL_CARD_WORDS, LABELLING_ROOM, NO_REMARK } from "@/lib/report/sections/labellingConclusion";
import { cn } from "@/lib/utils";
import { ChartKey } from "../chart-parts";
import { InfoCard } from "../info-card";
import { ReportTable, type ReportColumn, type ReportRow } from "../report-table";
import { BlockHeading, SectionHeading } from "../section-heading";
import { StatusChip, StatusTick } from "../status-chip";
import { TYPE } from "../theme";
import { TickMatrix } from "../tick-matrix";
import type { SectionPages, SectionPagesProps } from "./index";

type Sizes = LabellingConclusionSection["sizes"];

function Pages({ model, entry, content }: SectionPagesProps<"labellingConclusion">): ReactNode[] {
  return content.pages.map((blocks, index) => (
    <div key={index} data-slot="report-labelling-conclusion" data-part={index + 1} className="flex flex-col gap-[5mm]">
      <SectionHeading
        kicker={entry.kicker}
        title={index === 0 ? content.title : `${content.title} (Continued)`}
        lead={index === 0 && content.lead ? content.lead : undefined}
      />
      {blocks.map((block) => (
        <Block key={block} block={block} content={content} result={model.summary.conclusion} />
      ))}
    </div>
  ));
}

export const labellingConclusionPages: SectionPages<"labellingConclusion"> = { key: "labellingConclusion", Pages };

function Block({ block, content, result }: { block: LabellingBlock; content: LabellingConclusionSection; result: ReportConclusion }) {
  if (block === "levels") return <LevelCards levels={content.levels} sizes={content.sizes} />;
  if (block === "matrix") return content.matrix ? <MatrixBlock matrix={content.matrix} sizes={content.sizes} /> : null;
  return <ConclusionCard conclusion={content.conclusion} result={result} />;
}

/* ------------------------------------------------------------------ *
 * The labelling cards
 * ------------------------------------------------------------------ */

function LevelCards({ levels, sizes }: { levels: readonly LabelLevelCard[]; sizes: Sizes }) {
  return (
    <div data-slot="report-label-levels" className={cn("grid items-start gap-[4.6mm]", levels.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
      {levels.map((card) => (
        <LevelCard key={card.level} card={card} sizes={sizes} />
      ))}
    </div>
  );
}

/** A count as the card prints it: a dash for nothing recorded, red where it fails the size, amber below the plan. */
function Count({ cell }: { cell: LabelCell }) {
  if (cell.value === null) {
    return (
      <>
        <span aria-hidden className="text-slate-400">
          —
        </span>
        <span className="sr-only">Not recorded</span>
      </>
    );
  }
  return (
    <span data-tone={cell.tone ?? undefined} className={cn(cell.tone === "fail" && "font-bold text-fail", cell.tone === "warn" && "font-bold text-warn")}>
      {formatCount(cell.value)}
    </span>
  );
}

function LevelCard({ card, sizes }: { card: LabelLevelCard; sizes: Sizes }) {
  const width = `${cardSizeColumn(sizes.length)}mm`;
  const columns: ReportColumn[] = [
    { key: "check", label: LABEL_CARD_WORDS.check },
    ...sizes.map((size): ReportColumn => ({ key: `size:${size.value}`, label: size.label, align: "center", numeric: true, width })),
  ];
  const counts = (cells: readonly LabelCell[]) => Object.fromEntries(sizes.map((size, index) => [`size:${size.value}`, <Count key={size.value} cell={cells[index]} />]));
  const rows: ReportRow[] = [
    { key: "inspected", cells: { check: LABEL_CARD_WORDS.inspected, ...counts(card.inspected) } },
    ...card.checks.map((check) => ({ key: check.code, cells: { check: <span className="text-slate-700">{check.label}</span>, ...counts(check.cells) } })),
    // Blank rows line the totals up with the card beside it.
    ...Array.from({ length: card.padding }, (_, index): ReportRow => ({ key: `blank-${index}`, cells: { check: <span aria-hidden>&nbsp;</span> } })),
    { key: "defects", emphasis: true, cells: { check: LABEL_CARD_WORDS.defects, ...counts(card.defects) } },
  ];
  return (
    <InfoCard title={card.title} aside={<span className="tabular-nums">{card.limit}</span>} className="px-[4.6mm] py-[3.8mm]">
      <div data-slot="report-label-level" data-level={card.level}>
        <ReportTable caption={`${card.title}: label checks by size`} columns={columns} rows={rows} />
        <div className="flex items-center justify-between gap-[3mm] pt-[1.6mm]">
          <span className={cn("text-slate-600", TYPE.body)}>{LABEL_CARD_WORDS.result}</span>
          <StatusChip status={card.result.status} label={card.result.label} />
        </div>
      </div>
    </InfoCard>
  );
}

/* ------------------------------------------------------------------ *
 * The results matrix
 * ------------------------------------------------------------------ */

function legendItem(status: CheckStatus | "none") {
  if (status === "none") return { key: "none", swatch: <span className="text-slate-400">—</span>, label: "Not Applicable" };
  return { key: status, swatch: <StatusTick status={status} size={3.6} />, label: STATUS_LABEL[status] };
}

function MatrixBlock({ matrix, sizes }: { matrix: ResultsMatrix; sizes: Sizes }) {
  return (
    <section data-slot="report-results-matrix" className="flex flex-col gap-[1.6mm]">
      <BlockHeading title="Results Matrix" aside={<ChartKey items={matrix.legend.map(legendItem)} />} />
      <TickMatrix
        caption="Results matrix: each check by size"
        columns={sizes.map((size) => size.label)}
        rows={matrix.rows}
        columnWidth={`${(LABELLING_ROOM.matrixColumn * 100).toFixed(1)}%`}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The conclusion card
 * ------------------------------------------------------------------ */

/** The card in its result's colours, as page 1's: passed green, failed red, on hold amber, not concluded slate. */
const CARD_TONE: Readonly<Record<ReportStatus, { card: string; text: string; rule: string }>> = {
  pass: { card: "border-pass-border bg-pass-tint", text: "text-pass", rule: "border-pass-border" },
  fail: { card: "border-fail-border bg-fail-tint", text: "text-fail", rule: "border-fail-border" },
  hold: { card: "border-hold-border bg-hold-tint", text: "text-hold", rule: "border-hold-border" },
  warn: { card: "border-warn-border bg-warn-tint", text: "text-warn", rule: "border-warn-border" },
  not_done: { card: "border-dashed border-not-done-border bg-not-done-tint", text: "text-not-done", rule: "border-not-done-border" },
};

function ConclusionCard({ conclusion, result }: { conclusion: FinalConclusion; result: ReportConclusion }) {
  const tone = CARD_TONE[result.status];
  // The template's word fits at the design's size; "Not Concluded" takes a smaller one.
  const long = result.label.length > 8;
  return (
    <section
      data-slot="report-final-conclusion"
      data-status={result.status}
      className={cn("rounded-[2.8mm] border-[0.4mm] px-[6mm] py-[4.4mm]", tone.card)}
    >
      <div className="flex items-end gap-[8mm]">
        <div className="min-w-0 flex-1">
          <h3 className={cn(TYPE.kicker, tone.text)}>{conclusion.heading}</h3>
          <div className="mt-[3mm] flex items-center gap-[3.2mm]">
            <StatusTick status={result.status} size={long ? 8 : 11} />
            {/* The size before leading-none: a font size after it would merge the line height away. */}
            <p
              data-slot="report-final-result"
              className={cn(long ? "text-[16pt]" : "text-[30pt]", "min-w-0 leading-none font-bold tracking-[-0.02em] uppercase", tone.text)}
            >
              {result.label}
            </p>
          </div>
        </div>
        <div className="w-[34mm] shrink-0 pb-[0.4mm]">
          <p className={cn(tone.text, TYPE.small)}>{conclusion.dateLabel}</p>
          <p
            data-slot="report-final-date"
            className={cn("mt-[0.6mm] text-[13pt] leading-[1.2] tabular-nums", conclusion.date ? "font-bold text-slate-900" : "text-slate-600")}
          >
            {conclusion.date ?? NOT_STATED}
          </p>
        </div>
        {conclusion.signature && <SignatureLine signature={conclusion.signature} rule={tone.rule} text={tone.text} />}
      </div>
      {conclusion.remark && (
        <p data-slot="report-final-remark" className={cn("mt-[3.4mm] border-t-[0.3mm] pt-[3mm] whitespace-pre-line", tone.rule, tone.text, TYPE.body)}>
          <strong className="font-bold">{conclusion.remark.label}:</strong> {conclusion.remark.text ?? NO_REMARK}
        </p>
      )}
    </section>
  );
}

/** The signature over its line, the line left blank for the pen until signed, or while the report is to be signed by hand. */
function SignatureLine({ signature, rule, text }: { signature: NonNullable<FinalConclusion["signature"]>; rule: string; text: string }) {
  return (
    <div data-slot="report-signature" data-signed={signature.drawing ? "drawn" : signature.byHand ? "by-hand" : "none"} className="w-[64mm] shrink-0">
      <div className={cn("relative h-[15mm] border-b-[0.3mm]", rule)}>{signature.drawing && <SignatureDrawingSvg drawing={signature.drawing} />}</div>
      <p className={cn("mt-[1.4mm]", text, TYPE.small)}>{signature.label}</p>
    </div>
  );
}

/** The strokes as drawn on the pad, in its own box, sitting on the line; a pen's width whatever the box's size. */
function SignatureDrawingSvg({ drawing }: { drawing: SignatureDrawing }) {
  return (
    <svg
      role="img"
      aria-label="The inspector's signature, as drawn"
      viewBox={`0 0 ${drawing.width} ${drawing.height}`}
      preserveAspectRatio="xMinYMax meet"
      className="absolute inset-0 size-full text-slate-900"
    >
      <g fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
        {drawing.paths.map((path, index) => (
          <path key={index} d={path} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
    </svg>
  );
}
