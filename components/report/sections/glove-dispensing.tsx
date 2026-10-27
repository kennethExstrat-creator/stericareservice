// Section 07's pages for a Safedon template, Glove Dispensing, drawn from its
// content (lib/report/sections/glove-dispensing.ts) page by page as that
// file planned them, in TG35 page 7's style: the section's heading and lead
// on the first page ("Section 07 · Continued" on a later one), then the
// parts each page holds. The chart: each size's defect rate as a bar
// against the template's maximum, a dashed red line on an axis from 0, the
// figures and the size's result at the right; a failed size's bar red, a
// rate so far grey. Per-Box Results: the sizes' columns (box/carton number,
// defects) by No., divided by hairlines, zebra rows as tight as the design's
// (4.75 mm), each size's total. The defects by type, a plain table as TG35
// page 6's, beside the template's definitions of the defects. A defect found
// prints in bold, none in grey, a failing total or rate in red, a
// box/carton number the module warns about in amber. Sizes in millimetres
// match the plan's estimates (GLOVE_DISPENSING_ROOM): change them together.
// components/report/sections/packing.tsx hands this file the section's
// content when it is Glove Dispensing's.
import { Fragment, type ReactNode } from "react";
import { STATUS_LABEL } from "@/lib/design/status";
import type { GloveDispensingSection, ReportModel, ReportSectionPlanEntry } from "@/lib/report/model";
import {
  continuedNote,
  DEFINITIONS_TITLE,
  definitionText,
  dispensingBoxGeometry,
  PER_BOX_TITLE,
  type DispensingChart,
  type DispensingDefects,
  type DispensingDefinition,
  type DispensingPerBox,
  type DispensingStatus,
  type DispensingValue,
  type DispensingWords,
} from "@/lib/report/sections/glove-dispensing";
import { cn } from "@/lib/utils";
import { barLength } from "../bars";
import { AsideLines, AxisTicks, ChartKey, GridLines, LimitLine, plainTick } from "../chart-parts";
import { ReportTable, type ReportColumn, type ReportRow } from "../report-table";
import { BlockHeading, SectionHeading } from "../section-heading";
import { StatusChip, StatusTick } from "../status-chip";
import { contentWidth, TYPE } from "../theme";

type Sizes = GloveDispensingSection["sizes"];

export type GloveDispensingPagesProps = { model: ReportModel; entry: ReportSectionPlanEntry<"packing">; content: GloveDispensingSection };

/** One body per page of the content: the heading, then the page's parts. */
export function gloveDispensingPages({ model, entry, content }: GloveDispensingPagesProps): ReactNode[] {
  const width = contentWidth(model.paper);
  return content.pages.map((page, index) => (
    <div key={index} data-slot="report-dispensing" data-page-part={index + 1} className="flex flex-col gap-[4mm]">
      {index === 0 ? (
        <SectionHeading kicker={entry.kicker} title={entry.title} lead={content.lead} />
      ) : (
        <SectionHeading kicker={`${entry.kicker} · Continued`} title={entry.title} />
      )}
      <div className="flex flex-col gap-[3.5mm]">
        {page.parts.map((part) => {
          if (part.kind === "chart") return content.chart && <ChartBlock key="chart" chart={content.chart} />;
          if (part.kind === "perBox") {
            return content.perBox && <PerBoxBlock key={`boxes-${part.from}`} perBox={content.perBox} words={content.words} from={part.from} to={part.to} width={width} />;
          }
          if (part.kind === "closing") return <Closing key="closing" content={content} />;
          if (part.kind === "defects") {
            return (
              <HalfColumn key={`defects-${part.from}`} half={content.defects.half}>
                <DefectsBlock defects={content.defects} sizes={content.sizes} from={part.from} to={part.to} />
              </HalfColumn>
            );
          }
          return (
            <HalfColumn key={`definitions-${part.from}`} half={content.defects.half}>
              <DefinitionsBlock definitions={content.definitions.slice(part.from, part.to)} continued={part.from > 0} />
            </HalfColumn>
          );
        })}
      </div>
    </div>
  ));
}

/* ------------------------------------------------------------------ *
 * Figures
 * ------------------------------------------------------------------ */

/** A figure's look: a defect found in bold, none in grey, a failing total or rate in red, a warned box/carton number in amber. */
const TONE: Readonly<Record<DispensingValue["tone"], string>> = {
  plain: "",
  muted: "text-slate-600",
  zero: "text-slate-600",
  found: "font-bold text-slate-900",
  total: "font-bold text-slate-900",
  fail: "font-bold text-fail",
  warn: "font-semibold text-warn",
  missing: "text-slate-400",
};

function Value({ value }: { value: DispensingValue | undefined }) {
  if (!value) return null;
  if (value.tone === "plain") return <>{value.text}</>;
  return (
    <span data-tone={value.tone} className={cn("whitespace-nowrap", TONE[value.tone])}>
      {value.text}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * The defect rate against the maximum
 * ------------------------------------------------------------------ */

/** The bar's fill: blue, red where the size failed, grey for a rate so far (not done). */
const BAR_TONE: Readonly<Record<DispensingStatus, string>> = { pass: "bg-brand-600", fail: "bg-fail-solid", not_done: "bg-slate-300" };

const SWATCH = "block h-[2.4mm] w-[4.4mm] rounded-[0.7mm]";

function ChartBlock({ chart }: { chart: DispensingChart }) {
  const marked = chart.maximum === null ? [] : [chart.maximum];
  const described = chart.rows
    .map((row) => `${row.label}: ${row.aside.map((line) => `${line.text} ${line.strong}`).join(", ")}, ${STATUS_LABEL[row.status]}`)
    .join("; ");
  return (
    <section data-slot="report-dispensing-chart" className="flex flex-col gap-[1.6mm]">
      <BlockHeading
        title={chart.title}
        aside={
          <ChartKey
            items={[
              { key: "rate", swatch: <span className={cn(SWATCH, BAR_TONE.pass)} />, label: chart.keys.rate },
              ...(chart.keys.notDone ? [{ key: "notDone", swatch: <span className={cn(SWATCH, BAR_TONE.not_done)} />, label: chart.keys.notDone }] : []),
              ...(chart.maximum !== null
                ? [{ key: "maximum", swatch: <span className="block h-[3.6mm] border-l-[0.3mm] border-dashed border-fail" />, label: "Maximum" }]
                : []),
            ]}
          />
        }
      />
      <figure aria-label={`${chart.title} by size: ${described}.`} className="grid grid-cols-[34mm_minmax(0,1fr)_34mm_20mm]">
        {chart.rows.map((row) => (
          <div key={row.size} data-row={row.size} data-status={row.status} className="contents">
            <div className="flex min-h-[9.6mm] items-center">
              <p className={cn("text-slate-900", TYPE.body)}>
                <span className="font-bold">{row.label}</span>
                <span className="text-slate-600"> {row.sublabel}</span>
              </p>
            </div>
            <div className="relative min-h-[9.6mm]">
              <GridLines axis={chart.axis} />
              {row.rate !== null && (
                <span
                  aria-hidden
                  data-slot="report-bar"
                  data-value={row.rate}
                  className={cn("absolute top-1/2 left-0 h-[3.4mm] -translate-y-1/2 rounded-r-[0.8mm]", BAR_TONE[row.status])}
                  style={{ width: barLength(row.rate, chart.axis) }}
                />
              )}
              {chart.maximum !== null && <LimitLine value={chart.maximum} axis={chart.axis} />}
            </div>
            <div className="flex items-center">
              <AsideLines lines={row.aside} className="border-l-[0.25mm] border-slate-200 pl-[3mm]" />
            </div>
            <div className="flex items-center justify-end">
              <StatusChip status={row.status} />
            </div>
          </div>
        ))}
        <span />
        <AxisTicks axis={chart.axis} format={(value) => (marked.includes(value) ? plainTick(value) : `${plainTick(value)}%`)} marked={marked} extra={marked} />
        <span />
        <span />
      </figure>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Per-Box Results
 * ------------------------------------------------------------------ */

/** The design's tighter rows (4.75 mm) and header lines, over the dense table's (the packing check's per-box table). */
const TIGHT_ROWS = "leading-[1.25] [&_td]:py-[0.5mm] [&_tbody_th]:py-[0.5mm] [&_tfoot_th]:py-[0.5mm] [&_thead_th]:leading-[1.25]";

function share(part: number, whole: number): string {
  return `${((part / whole) * 100).toFixed(3)}%`;
}

function Note({ parts }: { parts: DispensingPerBox["note"] }) {
  return (
    <span data-slot="report-dispensing-note">
      {parts.map((part, index) =>
        part.tone === "warn" ? (
          <span key={index} className="font-semibold text-warn">
            {part.text}
          </span>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </span>
  );
}

function PerBoxBlock({ perBox, words, from, to, width }: { perBox: DispensingPerBox; words: DispensingWords; from: number; to: number; width: number }) {
  const geometry = dispensingBoxGeometry(perBox.sizes.length, width);
  const aside = from === 0 ? <Note parts={perBox.note} /> : continuedNote(words, from, to);
  return (
    <section data-slot="report-dispensing-boxes" data-from={from} data-to={to} className="flex flex-col gap-[1mm]" style={{ width: `${geometry.table}mm` }}>
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
  perBox: DispensingPerBox;
  words: DispensingWords;
  from: number;
  to: number;
  geometry: ReturnType<typeof dispensingBoxGeometry>;
}) {
  const columns: ReportColumn[] = [
    { key: "item", label: words.no, width: share(geometry.item, geometry.table), muted: true },
    ...perBox.sizes.flatMap((size): ReportColumn[] => [
      { key: `${size.size}:box`, label: words.boxNo, numeric: true, width: share(geometry.box, geometry.table), divided: true },
      { key: `${size.size}:defects`, label: words.defects, numeric: true, width: share(geometry.defects, geometry.table) },
    ]),
  ];
  const groups = [
    { span: 1 },
    ...perBox.sizes.map((size) => ({ label: <span className="block text-[10pt] leading-[1.25] font-bold text-brand-700">{size.label}</span>, span: 2 })),
  ];
  const rows: ReportRow[] = Array.from({ length: Math.max(0, to - from) }, (_, offset) => {
    const index = from + offset;
    const cells: Record<string, ReactNode> = { item: index + 1 };
    for (const size of perBox.sizes) {
      const box = size.boxes[index] ?? null;
      if (!box) continue;
      cells[`${size.size}:box`] = <Value value={box.boxNo} />;
      cells[`${size.size}:defects`] = <Value value={box.defects} />;
    }
    return { key: String(index + 1), cells };
  });
  // The total row closes the table on the page with its last rows.
  let totals: Record<string, ReactNode> | undefined;
  if (to >= perBox.items) {
    totals = { item: <span className="font-bold text-brand-700">{words.total}</span> };
    for (const size of perBox.sizes) totals[`${size.size}:defects`] = <Value value={size.total} />;
  }
  return (
    <ReportTable
      dense
      zebra
      caption={`${PER_BOX_TITLE}: ${words.boxNo} and ${words.defects} by size and ${words.no}`}
      columns={columns}
      groups={groups}
      rows={rows}
      totals={totals}
      className={TIGHT_ROWS}
    />
  );
}

/* ------------------------------------------------------------------ *
 * The defects by type and their definitions
 * ------------------------------------------------------------------ */

function Closing({ content }: { content: GloveDispensingSection }) {
  return (
    <div data-slot="report-dispensing-closing" className="grid grid-cols-2 items-start gap-x-[6mm]">
      <DefectsBlock defects={content.defects} sizes={content.sizes} from={0} to={content.defects.rows.length} />
      {content.definitions.length > 0 && <DefinitionsBlock definitions={content.definitions} continued={false} />}
    </div>
  );
}

/** A part on its own: in the left half where the defects table is half the page's width, else across it. */
function HalfColumn({ half, children }: { half: boolean; children: ReactNode }) {
  if (!half) return <>{children}</>;
  return <div className="grid grid-cols-2 items-start gap-x-[6mm]">{children}</div>;
}

const LABEL = "label";
const sizeKey = (size: string) => `size:${size}`;

function DefectsBlock({ defects, sizes, from, to }: { defects: DispensingDefects; sizes: Sizes; from: number; to: number }) {
  const continued = from > 0;
  const columns: ReportColumn[] = [
    { key: LABEL, label: defects.firstHeader, width: `${defects.widths.label}%` },
    ...sizes.map((size) => ({ key: sizeKey(size.size), label: size.label, numeric: true, width: `${defects.widths.value}%` })),
  ];
  const rows: ReportRow[] = defects.rows.slice(from, to).map((row) => ({
    key: row.key,
    emphasis: row.kind === "total",
    cells: {
      [LABEL]: <span className={row.kind === "defect" ? "text-slate-600" : undefined}>{row.label}</span>,
      ...Object.fromEntries(
        sizes.map((size, index) => {
          const status = row.statuses?.[index];
          const cell = status ? (
            <StatusTick status={status} size={3.8} label={`${row.label}, ${size.label}: ${STATUS_LABEL[status]}`} className="align-middle" />
          ) : (
            <Value value={row.values[index]} />
          );
          return [sizeKey(size.size), cell];
        }),
      ),
    },
  }));
  return (
    <section data-slot="report-dispensing-defects" data-continued={continued || undefined} className="flex flex-col gap-[1.5mm]">
      <BlockHeading title={defects.title} aside={continued ? "Continued" : undefined} />
      {/* A size or two keep the table to its own width (the plan's), under a heading across the column. */}
      <div className="max-w-full" style={{ width: `${defects.width}mm` }}>
        <ReportTable plain caption={continued ? `${defects.title}, continued` : defects.title} columns={columns} rows={rows} />
      </div>
    </section>
  );
}

function DefinitionsBlock({ definitions, continued }: { definitions: readonly DispensingDefinition[]; continued: boolean }) {
  return (
    <section data-slot="report-dispensing-definitions" data-continued={continued || undefined} className="flex flex-col gap-[2mm]">
      <BlockHeading title={DEFINITIONS_TITLE} aside={continued ? "Continued" : undefined} />
      <dl className={cn("grid grid-cols-[30mm_minmax(0,1fr)] gap-x-[3mm] gap-y-[1.2mm]", TYPE.small)}>
        {definitions.map((definition) => (
          <Fragment key={definition.code}>
            <dt data-defect={definition.code} className="font-semibold text-slate-900">
              {definition.label}
            </dt>
            <dd className="min-w-0 text-slate-600">{definitionText(definition)}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}
