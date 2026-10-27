// Section 04, Measurements by Glove (TG35 page 4), from its slot's content
// (lib/report/sections/measurements.ts): the heading with "All values in mm
// · 13 gloves per size" at its right, then two tables side by side, row
// after row, and under them what the page's marks mean. Each table is headed
// by its size, with its lot and average weight at the right: a zebra row per
// glove, then the statistic tinted blue under a dark rule, the spec in grey
// and the result in its status colour. A reading outside the spec is red; a
// P/F set by hand carries a mark. A page after the first repeats the
// heading, "Continued".
import type { ReactNode } from "react";
import { STATUS_TEXT_CLASS } from "@/lib/design/status";
import type { DimensionsFigure, MeasurementsSection, MeasurementsTable } from "@/lib/report/model";
import { MEASUREMENTS_ROOM } from "@/lib/report/sections/dimension-shared";
import { cn } from "@/lib/utils";
import { ReportTable, type ReportColumn, type ReportRow } from "../report-table";
import { BlockHeading, SectionHeading } from "../section-heading";
import { TYPE } from "../theme";
import { defineSectionPages, type SectionPagesProps } from "./index";

/**
 * The design's rows on ReportTable (dense, zebra), as MEASUREMENTS_ROOM
 * counts them: a glove's row about 5 mm, cells 1.2 mm in from their edges,
 * the statistic under a dark rule with hairlines under it and under the
 * spec, the spec and the result rows white.
 */
const TABLE_CLASS = cn(
  "[&_td]:px-[1.2mm] [&_th]:px-[1.2mm] [&_tbody_td]:py-[0.4mm] [&_tbody_th]:py-[0.4mm]",
  "[&_tr[data-row=statistic]]:border-t-[0.4mm] [&_tr[data-row=statistic]]:border-t-slate-900",
  "[&_tr[data-row=statistic]]:border-b-[0.25mm] [&_tr[data-row=statistic]]:border-b-slate-200",
  "[&_tr[data-row=spec]]:border-b-[0.25mm] [&_tr[data-row=spec]]:border-b-slate-200",
  "[&_tr[data-row=spec]]:bg-white [&_tr[data-row=result]]:bg-white",
);

/** The gaps MEASUREMENTS_ROOM counts: under the heading and above the note (gap), between rows (rowGap) and tables (columnGap). */
function Pages({ entry, content }: SectionPagesProps<"measurements">): ReactNode[] {
  return content.pages.map((page, index) => (
    <div key={index} data-slot="report-measurements" data-part-page={index + 1} className="flex flex-col gap-[5mm]">
      <SectionHeading kicker={index === 0 ? entry.kicker : `${entry.kicker} · Continued`} title={entry.title} aside={content.aside} />
      <div className="flex flex-col gap-[6mm]">
        {page.rows.map((row) => (
          <div key={row.map((table) => table.key).join("+")} className="grid grid-cols-2 items-start gap-x-[7mm]">
            {row.map((table) => (
              <SizeTable key={table.key} table={table} content={content} />
            ))}
          </div>
        ))}
      </div>
      {page.note && (
        <p data-slot="report-measurements-note" className={cn("text-slate-600", TYPE.tiny)}>
          {page.note}
        </p>
      )}
    </div>
  ));
}

/** A row's taller cells: the statistic's, the spec's and the result's (about 6.4 mm). */
function Tall({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn("block py-[0.7mm]", className)}>{children}</span>;
}

/** A figure, red where it fails its spec. */
function Figure({ figure }: { figure: DimensionsFigure | undefined }) {
  if (!figure) return null;
  return figure.failed ? <span className="text-fail">{figure.text}</span> : <>{figure.text}</>;
}

function SizeTable({ table, content }: { table: MeasurementsTable; content: MeasurementsSection }) {
  const { labels } = content;
  const columns: ReportColumn[] = [
    { key: "no", label: labels.no, width: `${MEASUREMENTS_ROOM.noColumn}mm` },
    ...content.columns.map((column) => ({ key: column.measure, label: column.label, numeric: true })),
  ];
  const measures = content.columns.map((column) => column.measure);
  const byMeasure = (cell: (measure: string) => ReactNode) => Object.fromEntries(measures.map((measure) => [measure, cell(measure)]));
  const rows: ReportRow[] = table.gloves.map((glove) => ({
    key: String(glove.no),
    cells: { no: glove.no, ...byMeasure((measure) => <Figure figure={glove.cells[measure]} />) },
  }));
  const { summary } = table;
  if (summary) {
    rows.push(
      {
        key: "statistic",
        emphasis: true,
        cells: {
          no: <Tall className="whitespace-nowrap text-brand-700">{labels.statistic}</Tall>,
          ...byMeasure((measure) => (
            <Tall>
              <Figure figure={summary.statistic[measure]} />
            </Tall>
          )),
        },
      },
      {
        key: "spec",
        cells: {
          no: <Tall className="whitespace-nowrap text-slate-600">{labels.spec}</Tall>,
          ...byMeasure((measure) => <Tall className="text-slate-600">{summary.spec[measure]}</Tall>),
        },
      },
      {
        key: "result",
        cells: {
          no: <Tall className={cn("font-semibold whitespace-nowrap", STATUS_TEXT_CLASS[summary.status])}>{labels.result}</Tall>,
          ...byMeasure((measure) => {
            const result = summary.result[measure];
            if (!result) return null;
            return (
              <Tall className={cn("font-semibold", STATUS_TEXT_CLASS[result.status])}>
                {result.text}
                {result.byHand && (
                  <>
                    <span aria-hidden>*</span>
                    <span className="sr-only"> (set by the inspector)</span>
                  </>
                )}
              </Tall>
            );
          }),
        },
      },
    );
  }
  return (
    <section data-slot="report-glove-table" data-size={table.size} className="flex min-w-0 flex-col gap-[1.6mm]">
      <BlockHeading title={table.title} aside={table.aside ? <span className="tabular-nums">{table.aside}</span> : undefined} />
      <ReportTable dense zebra caption={`${table.title}: each glove's measurements in mm`} columns={columns} rows={rows} className={TABLE_CLASS} />
    </section>
  );
}

export const measurementsPages = defineSectionPages({ key: "measurements", Pages });
