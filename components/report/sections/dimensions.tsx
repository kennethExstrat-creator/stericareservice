// Section 03, Dimensions & Weight (TG35 page 3), from its slot's content
// (lib/report/sections/dimensions.ts): the heading and the lead, then on
// each page its parts in order. Glove Length (mm), Each Glove: a dot per
// glove, stacked where readings repeat, the statistic's teal triangle, each
// size's limits as dashed red lines over a tinted reject zone. Palm Width
// (mm) against Size Tolerance: each size's tolerance band, the range
// measured and the statistic's ring. Median Results by Size beside Weight
// per Glove (g). A page after the first repeats the heading, "Continued".
import type { ReactNode } from "react";
import type { DimensionsLengthChart, DimensionsPagePart, DimensionsResultsTable, DimensionsSection, DimensionsWeightBars, DimensionsWidthChart } from "@/lib/report/model";
import { LENGTH_DOT } from "@/lib/report/sections/dimension-shared";
import { cn } from "@/lib/utils";
import { HBars } from "../bars";
import { ChartKey } from "../chart-parts";
import { DotPlot } from "../dot-plot";
import { RangeBand } from "../range-band";
import { ReportTable, type ReportColumn, type ReportColumnGroup } from "../report-table";
import { BlockHeading, SectionHeading } from "../section-heading";
import { StatusChip } from "../status-chip";
import { TYPE } from "../theme";
import { defineSectionPages, type SectionPagesProps } from "./index";

/** The gaps between the page's blocks and inside a block: DIMENSIONS_ROOM's gap and blockGap (lib/report/sections/dimension-shared.ts). */
const PAGE = "flex flex-col gap-[4.6mm]";
const BLOCK = "flex flex-col gap-[2.4mm]";

function Pages({ entry, content }: SectionPagesProps<"dimensions">): ReactNode[] {
  return content.pages.map((page, index) => (
    <div key={index} data-slot="report-dimensions" data-part-page={index + 1} className={PAGE}>
      <SectionHeading
        kicker={index === 0 ? entry.kicker : `${entry.kicker} · Continued`}
        title={entry.title}
        lead={index === 0 && content.lead ? content.lead : undefined}
      />
      {page.parts.map((part) => (
        <Part key={part.block === "results" ? "results" : `${part.block}-${part.from}`} part={part} content={content} />
      ))}
    </div>
  ));
}

function Part({ part, content }: { part: DimensionsPagePart; content: DimensionsSection }) {
  if (part.block === "gloveLength") {
    return content.gloveLength ? <GloveLength chart={content.gloveLength} from={part.from} to={part.to} continued={part.continued} /> : null;
  }
  if (part.block === "palmWidth") {
    return content.palmWidth ? <PalmWidth chart={content.palmWidth} from={part.from} to={part.to} continued={part.continued} /> : null;
  }
  return <ResultsRow results={content.medianResults} weight={content.weightPerGlove} />;
}

/** A block's heading, "(continued)" on the page after. */
function blockTitle(title: string, continued: boolean): string {
  return continued ? `${title} (continued)` : title;
}

/* ------------------------------------------------------------------ *
 * Glove Length (mm), Each Glove
 * ------------------------------------------------------------------ */

function GloveLength({ chart, from, to, continued }: { chart: DimensionsLengthChart; from: number; to: number; continued: boolean }) {
  const rows = chart.rows.slice(from, to);
  return (
    <section data-slot="report-glove-length" className={BLOCK}>
      <BlockHeading
        title={blockTitle(chart.title, continued)}
        aside={
          <ChartKey
            items={[
              { key: "glove", swatch: <span className="size-[2.2mm] rounded-full bg-brand-600" />, label: "One glove" },
              {
                key: "statistic",
                swatch: (
                  <svg viewBox="0 0 10 8" className="h-[2.1mm] w-[2.6mm] fill-accent-700">
                    <path d="M5 0 L10 8 L0 8 Z" />
                  </svg>
                ),
                label: chart.statisticLabel,
              },
              ...(chart.limitText
                ? [
                    {
                      key: "limit",
                      swatch: (
                        <span className="relative h-[3mm] w-[3.2mm] bg-fail-tint">
                          <span className="absolute inset-y-0 right-0 border-l-[0.3mm] border-dashed border-fail" />
                        </span>
                      ),
                      label: chart.limitText,
                      tone: "fail" as const,
                    },
                  ]
                : []),
            ]}
          />
        }
      />
      <DotPlot
        label={chart.title}
        axis={chart.axis}
        step={chart.step}
        geometry={LENGTH_DOT}
        rows={rows.map((row) => ({ key: row.size, label: row.label, values: row.values, median: row.statistic, aside: row.aside, limits: row.limits }))}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Palm Width (mm) against Size Tolerance
 * ------------------------------------------------------------------ */

function PalmWidth({ chart, from, to, continued }: { chart: DimensionsWidthChart; from: number; to: number; continued: boolean }) {
  const rows = chart.rows.slice(from, to);
  return (
    <section data-slot="report-palm-width" className={BLOCK}>
      <BlockHeading
        title={blockTitle(chart.title, continued)}
        aside={
          <ChartKey
            items={[
              { key: "tolerance", swatch: <span className="h-[2.8mm] w-[4.4mm] rounded-[0.8mm] border-[0.3mm] border-brand-300 bg-brand-100" />, label: "Tolerance" },
              { key: "range", swatch: <span className="h-[1.4mm] w-[4.4mm] rounded-full bg-brand-900" />, label: "Measured range" },
              { key: "statistic", swatch: <span className="size-[2.8mm] rounded-full border-[0.7mm] border-accent-700 bg-white" />, label: chart.statisticLabel },
            ]}
          />
        }
      />
      <RangeBand
        label={chart.title}
        axis={chart.axis}
        rows={rows.map((row) => ({ key: row.size, label: row.label, band: row.band, range: row.range, median: row.statistic, aside: row.aside }))}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Median Results by Size, and Weight per Glove (g)
 * ------------------------------------------------------------------ */

function ResultsRow({ results, weight }: { results: DimensionsResultsTable | null; weight: DimensionsWeightBars | null }) {
  if (results && weight) {
    return (
      <div data-slot="report-dimensions-results" className="grid grid-cols-[minmax(0,1fr)_62mm] items-start gap-x-[6mm]">
        <MedianResults results={results} />
        <WeightPerGlove weight={weight} />
      </div>
    );
  }
  if (results) return <MedianResults results={results} />;
  // Alone, the bars keep about the width they have beside the table, so they read the same.
  return weight ? <WeightPerGlove weight={weight} className="w-[88mm]" /> : null;
}

function MedianResults({ results }: { results: DimensionsResultsTable }) {
  const statistic = results.columns.filter((column) => column.group === "statistic");
  const thickness = results.columns.filter((column) => column.group === "thickness");
  const columns: ReportColumn[] = [
    { key: "size", label: "Size", width: "11%", strong: true },
    ...results.columns.map((column) => ({ key: column.measure, label: column.label, numeric: true })),
    { key: "result", label: "Result", align: "right", width: "27%" },
  ];
  const groups: ReportColumnGroup[] = [
    { span: 1 },
    ...(statistic.length > 0 ? [{ label: results.statisticGroup, span: statistic.length }] : []),
    ...(thickness.length > 0 ? [{ label: "Thickness (mm)", span: thickness.length }] : []),
    { span: 1 },
  ];
  return (
    <section data-slot="report-median-results" className={BLOCK}>
      <BlockHeading title={results.title} />
      <div className="flex flex-col gap-[2.4mm]">
        <ReportTable
          caption={results.title}
          columns={columns}
          groups={groups}
          rows={results.rows.map((row) => ({
            key: row.size,
            cells: {
              size: row.label,
              ...Object.fromEntries(
                results.columns.map((column) => {
                  const figure = row.cells[column.measure];
                  return [column.measure, figure?.failed ? <span className="font-semibold text-fail">{figure.text}</span> : (figure?.text ?? "")];
                }),
              ),
              result: (
                <span className="inline-flex items-center justify-end gap-[0.8mm]">
                  <StatusChip status={row.status} />
                  {row.byHand && (
                    <>
                      <span aria-hidden className="font-bold text-slate-600">
                        *
                      </span>
                      <span className="sr-only">Set by the inspector</span>
                    </>
                  )}
                </span>
              ),
            },
          }))}
        />
        {results.note && <p className={cn("text-slate-600", TYPE.tiny)}>{results.note}</p>}
      </div>
    </section>
  );
}

function WeightPerGlove({ weight, className }: { weight: DimensionsWeightBars; className?: string }) {
  return (
    <section data-slot="report-weight-per-glove" className={cn(BLOCK, className)}>
      <BlockHeading title={weight.title} />
      <div className="flex flex-col gap-[2.4mm]">
        <HBars
          label={weight.title}
          axis={{ min: 0, max: weight.max }}
          minimum={weight.minimum}
          rows={weight.rows.map((row) => ({ key: row.size, label: row.label, value: row.value, display: row.display, tone: row.tone }))}
        />
        {weight.note && <p className={cn("text-slate-600", TYPE.small)}>{weight.note}</p>}
      </div>
    </section>
  );
}

export const dimensionsPages = defineSectionPages({ key: "dimensions", Pages });
