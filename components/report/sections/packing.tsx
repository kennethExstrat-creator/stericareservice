// Section 07, Glove Packing & Dispensing (TG35 page 7), drawn from its
// content (lib/report/sections/packing.ts), page by page as that file
// planned them: the section's heading and lead on the first page ("Continued"
// on a later one), then the parts each page holds. Average Layering &
// Dispensing: each size's two bars against the minimums' dashed red lines on
// a 0 to 100% axis, the figures and the worst stickiness grade at the right,
// and the aged gloves under a dashed rule. Per-Box Results: the sizes'
// columns (box/carton number, layering, dispensing) by item, divided by
// hairlines, zebra rows tighter than a table's usual (the design's 4.75 mm),
// and each size's average. Box-Aged Gloves beside Stickiness Grades. A value
// below its minimum and a failing grade print in red. Sizes in millimetres
// match the plan's estimates (PACKING_ROOM): change them together.
import { Fragment, type ReactNode } from "react";
import { STATUS_TINT_CLASS } from "@/lib/design/status";
import { formatNumber } from "@/lib/format";
import type { PackingAged, PackingFigure, PackingGrade, PackingPerBox, PackingSection } from "@/lib/report/model";
import {
  AGED_COLUMN_SHARES,
  AGED_ROW_KEY,
  chartTitle,
  continuedNote,
  GRADES_TITLE,
  gradeLine,
  PER_BOX_TITLE,
  percentText,
  perBoxGeometry,
} from "@/lib/report/sections/packing";
import { cn } from "@/lib/utils";
import { GroupedHBars, SERIES_TONE, type GroupedHBarRow } from "../bars";
import { ChartKey, plainTick, type AsideLine } from "../chart-parts";
import { ReportTable, type ReportColumn, type ReportRow } from "../report-table";
import { BlockHeading, SectionHeading } from "../section-heading";
import { StatusChip } from "../status-chip";
import { contentWidth, TYPE } from "../theme";
import { defineSectionPages, type SectionPagesProps } from "./index";

type Words = PackingSection["words"];

function Pages({ model, entry, content }: SectionPagesProps<"packing">): ReactNode[] {
  const width = contentWidth(model.paper);
  return content.pages.map((page, index) => (
    <div key={index} data-slot="report-packing" data-page-part={index + 1} className="flex flex-col gap-[4mm]">
      <SectionHeading
        kicker={entry.kicker}
        title={entry.title}
        lead={index === 0 ? content.lead : undefined}
        aside={index === 0 ? undefined : "Continued"}
      />
      <div className="flex flex-col gap-[3.5mm]">
        {page.parts.map((part) => {
          if (part.kind === "chart") return <ChartBlock key="chart" content={content} />;
          if (part.kind === "perBox") return <PerBoxBlock key={`boxes-${part.from}`} content={content} from={part.from} to={part.to} width={width} />;
          return <AgedAndGrades key="aged" content={content} />;
        })}
      </div>
    </div>
  ));
}

export const packingPages = defineSectionPages({ key: "packing", Pages });

/* ------------------------------------------------------------------ *
 * Figures and grades
 * ------------------------------------------------------------------ */

/** A value as entered, or an average at one decimal; "—" while none. With `unit`, "88%". */
function figureText(figure: PackingFigure, { average = false, unit = false }: { average?: boolean; unit?: boolean } = {}): string {
  if (figure.value === null) return "—";
  return formatNumber(figure.value, { maxDecimals: average ? 1 : undefined, unit: unit ? "%" : undefined });
}

/** A figure in its cell: in red, and bold, below its minimum. */
function Figure({ figure, average, unit }: { figure: PackingFigure; average?: boolean; unit?: boolean }) {
  const shown = figureText(figure, { average, unit });
  if (!figure.low) return <>{shown}</>;
  return (
    <span data-low="true" className="font-semibold text-fail">
      {shown}
    </span>
  );
}

/** A grade in a table's cell: the code, in red where it fails. */
function GradeText({ grade }: { grade: PackingGrade | null }) {
  if (!grade) return <>—</>;
  if (grade.pass) return <>{grade.code}</>;
  return (
    <span data-grade-fails="true" className="font-semibold text-fail">
      {grade.code}
    </span>
  );
}

/** A stickiness code in its chip: green where it passes, red where it fails (Stickiness Grades). */
function GradeChip({ grade }: { grade: PackingGrade }) {
  const status = grade.pass ? "pass" : "fail";
  return (
    <span
      data-slot="report-grade-chip"
      data-status={status}
      className={cn(
        "inline-flex h-[5.4mm] min-w-[8mm] shrink-0 items-center justify-center rounded-[1.2mm] border-[0.3mm] px-[1.4mm] text-[9pt] leading-none font-bold",
        STATUS_TINT_CLASS[status],
      )}
    >
      {grade.code}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Average Layering & Dispensing
 * ------------------------------------------------------------------ */

const CHART_TICKS = [0, 20, 40, 60, 80, 100];

/** The axis's ticks: every 20%, and each minimum (in red) in place of a tick too close to it. */
function chartTicks(minimums: readonly number[]): number[] {
  const kept = CHART_TICKS.filter((tick) => minimums.every((minimum) => minimum === tick || Math.abs(minimum - tick) >= 6));
  return [...new Set([...kept, ...minimums])].sort((a, b) => a - b);
}

function asideLine(word: string, figure: PackingFigure): AsideLine {
  return { text: word, strong: figure.value === null ? "—" : percentText(figure.value), ...(figure.low ? { tone: "fail" as const } : {}) };
}

function ChartBlock({ content }: { content: PackingSection }) {
  const { chart, words, minimums } = content;
  if (!chart) return null;
  const limits: Record<string, number> = {};
  if (minimums.layering !== null) limits.layering = minimums.layering;
  if (minimums.dispensing !== null) limits.dispensing = minimums.dispensing;
  const marked = Object.values(limits);
  const rows = chart.aged ? [...chart.rows, chart.aged] : chart.rows;
  const example = rows.find((row) => row.grade?.pass)?.grade ?? rows.find((row) => row.grade)?.grade ?? null;
  const bars: GroupedHBarRow[] = rows.map((row) => ({
    key: row.key,
    label: row.label,
    sublabel: row.sublabel,
    ...(row.key === AGED_ROW_KEY ? { sublabelBelow: true, separated: chart.rows.length > 0 } : {}),
    values: { layering: row.layering.value, dispensing: row.dispensing.value },
    aside: [asideLine(words.layering, row.layering), asideLine(words.dispensing, row.dispensing)],
    ...(row.grade ? { tag: { text: row.grade.code, status: row.grade.pass ? ("pass" as const) : ("fail" as const) } } : {}),
  }));
  const described = rows
    .map((row) => `${row.label}: ${words.layering} ${figureText(row.layering, { average: true, unit: true })}, ${words.dispensing} ${figureText(row.dispensing, { average: true, unit: true })}`)
    .join("; ");
  return (
    <section data-slot="report-packing-chart" className="flex flex-col gap-[1.6mm]">
      <BlockHeading
        title={chartTitle(words)}
        aside={
          <ChartKey
            items={[
              { key: "layering", swatch: <span className={cn("block h-[2.4mm] w-[4.4mm] rounded-[0.7mm]", SERIES_TONE.brand.swatch)} />, label: words.layering },
              { key: "dispensing", swatch: <span className={cn("block h-[2.4mm] w-[4.4mm] rounded-[0.7mm]", SERIES_TONE.accent.swatch)} />, label: words.dispensing },
              ...(marked.length > 0
                ? [{ key: "minimum", swatch: <span className="block h-[3.6mm] border-l-[0.3mm] border-dashed border-fail" />, label: "Minimum" }]
                : []),
              ...(example
                ? [
                    {
                      key: "grade",
                      swatch: (
                        <StatusChip status={example.pass ? "pass" : "fail"} label={example.code} size="sm" className="rounded-[0.8mm] px-[1.4mm] [&>svg]:hidden" />
                      ),
                      label: `${words.stickiness} grade`,
                    },
                  ]
                : []),
            ]}
          />
        }
      />
      <GroupedHBars
        label={`${chartTitle(words)} by size: ${described}.`}
        axis={{ min: 0, max: 100, ticks: chartTicks(marked) }}
        series={[
          { key: "layering", label: words.layering, tone: "brand" },
          { key: "dispensing", label: words.dispensing, tone: "accent" },
        ]}
        minimums={limits}
        format={(value) => (marked.includes(value) ? plainTick(value) : `${plainTick(value)}%`)}
        rows={bars}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Per-Box Results
 * ------------------------------------------------------------------ */

/** The design's tighter rows (4.75 mm) and header lines, over the dense table's. */
const TIGHT_ROWS = "leading-[1.25] [&_td]:py-[0.5mm] [&_tbody_th]:py-[0.5mm] [&_tfoot_th]:py-[0.5mm] [&_thead_th]:leading-[1.25]";

function share(part: number, whole: number): string {
  return `${((part / whole) * 100).toFixed(3)}%`;
}

function Note({ parts }: { parts: PackingPerBox["note"] }) {
  return (
    <span data-slot="report-packing-note">
      {parts.map((part, index) =>
        part.fail ? (
          <span key={index} className="font-semibold text-fail">
            {part.text}
          </span>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </span>
  );
}

function PerBoxBlock({ content, from, to, width }: { content: PackingSection; from: number; to: number; width: number }) {
  const { perBox, words } = content;
  if (!perBox) return null;
  const geometry = perBoxGeometry(perBox.sizes.length, width);
  const aside = from === 0 ? <Note parts={perBox.note} /> : continuedNote(words, from, to);
  return (
    <section data-slot="report-packing-boxes" data-from={from} data-to={to} className="flex flex-col gap-[1mm]" style={{ width: `${geometry.table}mm` }}>
      <BlockHeading title={PER_BOX_TITLE} aside={aside} />
      {perBox.items === 0 ? (
        <p className={cn("text-slate-600", TYPE.body)}>No boxes are entered yet.</p>
      ) : (
        <PerBoxTable perBox={perBox} words={words} from={from} to={to} geometry={geometry} />
      )}
    </section>
  );
}

function PerBoxTable({
  perBox,
  words,
  from,
  to,
  geometry,
}: {
  perBox: PackingPerBox;
  words: Words;
  from: number;
  to: number;
  geometry: ReturnType<typeof perBoxGeometry>;
}) {
  const columns: ReportColumn[] = [
    { key: "item", label: words.item, width: share(geometry.item, geometry.table), muted: true },
    ...perBox.sizes.flatMap((size): ReportColumn[] => [
      { key: `${size.size}:box`, label: words.boxNo, numeric: true, width: share(geometry.box, geometry.table), divided: true },
      { key: `${size.size}:layering`, label: words.layeringShort, numeric: true, width: share(geometry.layering, geometry.table) },
      { key: `${size.size}:dispensing`, label: words.dispensingShort, numeric: true, width: share(geometry.dispensing, geometry.table) },
    ]),
  ];
  const groups = [
    { span: 1 },
    ...perBox.sizes.map((size) => ({ label: <span className="block text-[10pt] leading-[1.25] font-bold text-brand-700">{size.label}</span>, span: 3 })),
  ];
  const rows: ReportRow[] = Array.from({ length: Math.max(0, to - from) }, (_, offset) => {
    const index = from + offset;
    const cells: Record<string, ReactNode> = { item: index + 1 };
    for (const size of perBox.sizes) {
      const box = size.boxes[index] ?? null;
      if (!box) continue;
      cells[`${size.size}:box`] = box.boxNo === null ? "—" : formatNumber(box.boxNo);
      cells[`${size.size}:layering`] = <Figure figure={box.layering} />;
      cells[`${size.size}:dispensing`] = <Figure figure={box.dispensing} />;
    }
    return { key: String(index + 1), cells };
  });
  // The average row closes the table on the page with its last items.
  let totals: Record<string, ReactNode> | undefined;
  if (to >= perBox.items) {
    totals = { item: <span className="font-bold text-brand-700">{words.average}</span> };
    for (const size of perBox.sizes) {
      totals[`${size.size}:layering`] = <Figure figure={size.layering} average />;
      totals[`${size.size}:dispensing`] = <Figure figure={size.dispensing} average />;
    }
  }
  return (
    <ReportTable
      dense
      zebra
      caption={`${PER_BOX_TITLE}: ${words.layering} and ${words.dispensing} in %, by size and ${words.item}`}
      columns={columns}
      groups={groups}
      rows={rows}
      totals={totals}
      className={TIGHT_ROWS}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Box-Aged Gloves and Stickiness Grades
 * ------------------------------------------------------------------ */

function AgedAndGrades({ content }: { content: PackingSection }) {
  return (
    <div data-slot="report-packing-closing" className="grid grid-cols-2 items-start gap-x-[6mm]">
      {content.aged && <AgedBlock aged={content.aged} words={content.words} />}
      {content.grades && <GradesBlock grades={content.grades} />}
    </div>
  );
}

/** A result in its cell, kept to its own height (no line box around it). */
function ResultChip({ status, size }: { status: PackingAged["rows"][number]["status"]; size: "sm" | "md" }) {
  return (
    <div className="flex justify-end">
      <StatusChip status={status} size={size} />
    </div>
  );
}

function AgedBlock({ aged, words }: { aged: PackingAged; words: Words }) {
  const columns: ReportColumn[] = [
    { key: "size", label: "Size", width: share(AGED_COLUMN_SHARES.size, 1), strong: true },
    { key: "layering", label: words.layering, numeric: true, width: share(AGED_COLUMN_SHARES.layering, 1) },
    { key: "dispensing", label: words.dispensing, numeric: true, width: share(AGED_COLUMN_SHARES.dispensing, 1) },
    { key: "stickiness", label: words.stickiness, align: "right", width: share(AGED_COLUMN_SHARES.stickiness, 1) },
    { key: "result", label: "Result", align: "right", width: share(AGED_COLUMN_SHARES.result, 1) },
  ];
  const shared = aged.status;
  const rows: ReportRow[] = aged.rows.map((row, index) => ({
    key: row.size,
    cells: {
      size: row.label,
      layering: <Figure figure={row.layering} unit />,
      dispensing: <Figure figure={row.dispensing} unit />,
      stickiness: <GradeText grade={row.grade} />,
      result: shared === null ? <ResultChip status={row.status} size="sm" /> : index === 0 ? <ResultChip status={shared} size="md" /> : null,
    },
    // One result for every sample, as the design prints it: once, across the rows and the average.
    ...(shared !== null && index === 0 ? { rowSpans: { result: aged.rows.length + 1 } } : {}),
  }));
  rows.push({
    key: "average",
    emphasis: true,
    cells: {
      size: words.average,
      layering: <Figure figure={aged.average.layering} average unit />,
      dispensing: <Figure figure={aged.average.dispensing} average unit />,
      stickiness: <GradeText grade={aged.average.grade} />,
      result: null,
    },
  });
  return (
    <section data-slot="report-packing-aged" className="flex flex-col gap-[1mm]">
      <BlockHeading title={aged.title} />
      <ReportTable dense caption={aged.title} columns={columns} rows={rows} />
    </section>
  );
}

function GradesBlock({ grades }: { grades: readonly PackingGrade[] }) {
  return (
    <section data-slot="report-packing-grades" className="flex flex-col gap-[2mm]">
      <BlockHeading title={GRADES_TITLE} />
      <ul className="flex flex-col gap-[1.2mm]">
        {grades.map((grade) => (
          <li key={grade.code} data-grade={grade.code} className="flex items-start gap-[3mm]">
            <GradeChip grade={grade} />
            <p className={cn("min-w-0 pt-[0.6mm] text-slate-600", TYPE.small)}>{gradeLine(grade)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
