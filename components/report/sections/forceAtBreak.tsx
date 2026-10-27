// Section 05's pages, Force at Break (TG35 page 5; docs/REPORT.md, "Adding
// a section"), drawn from the content lib/report/sections/forceAtBreak.ts
// builds: each page opens with the section's heading (its lead on the
// first, "(Continued)" after) and draws its parts in order. The lab's
// details on a soft blue card; every specimen as a dot per size (DotPlot)
// against the minimum, its zone tinted, with the notes under it; Specimen
// Readings (zebra rows, a reading below the minimum red with "*", the
// Median under them) beside Laboratory Summary by Size (the lots, the
// readings' figures, the median, each size's verdict as a pill). Physical
// Properties: each average as a bar against its minimum, and the summary.
// Failing values print in red. Pure markup, as every page of the report.
import type { ReactNode } from "react";
import { formatNumber } from "@/lib/format";
import type { CheckStatus } from "@/lib/report/checks";
import type {
  ForceAtBreakAverage,
  ForceAtBreakDetail,
  ForceAtBreakPart,
  ForceAtBreakReading,
  ForceAtBreakSection,
  ForceAtBreakSize,
  ForceAtBreakTensile,
  ForceAtBreakTest,
} from "@/lib/report/model";
import { summaryLabelShare } from "@/lib/report/sections/forceAtBreak";
import { cn } from "@/lib/utils";
import { HBars } from "../bars";
import { ChartKey, type AsideLine } from "../chart-parts";
import { DotPlot } from "../dot-plot";
import { InfoCard, KeyValueGrid } from "../info-card";
import { ReportTable, type ReportColumn, type ReportRow } from "../report-table";
import { BlockHeading, SectionHeading } from "../section-heading";
import { StatusChip } from "../status-chip";
import { TYPE } from "../theme";
import { defineSectionPages, type SectionPagesProps } from "./index";

/** The design's headings for the section's blocks. */
export const FORCE_AT_BREAK_HEADINGS = {
  chart: "Maximum Load per Specimen (N)",
  readings: "Specimen Readings (N)",
  summary: "Laboratory Summary by Size",
} as const;

function Pages({ entry, content }: SectionPagesProps<"forceAtBreak">): ReactNode[] {
  return content.pages.map((page, index) => (
    <div key={`force-at-break-${index + 1}`} data-slot="report-force-at-break" data-section-page={index + 1} className="flex flex-col gap-[5mm]">
      <SectionHeading
        kicker={entry.kicker}
        title={index === 0 ? entry.title : `${entry.title} (Continued)`}
        lead={index === 0 && content.lead ? content.lead : undefined}
      />
      {page.parts.map((part, partIndex) => (
        <PagePart key={`${part.kind}-${partIndex}`} part={part} content={content} />
      ))}
    </div>
  ));
}

export const forceAtBreakPages = defineSectionPages({ key: "forceAtBreak", Pages });

function PagePart({ part, content }: { part: ForceAtBreakPart; content: ForceAtBreakSection }) {
  switch (part.kind) {
    case "details":
      return content.details ? <DetailsCard details={content.details} /> : null;
    case "forceChart":
      return content.force ? <ForceChart force={content.force} sizes={part.sizes} notes={part.notes} /> : null;
    case "forceTables":
      return content.force ? <ForceTables force={content.force} part={part} /> : null;
    case "tensileChart":
      return content.tensile ? <TensileCharts tensile={content.tensile} /> : null;
    case "tensileSummary":
      return content.tensile ? <TensileSummary tensile={content.tensile} /> : null;
  }
}

/* ------------------------------------------------------------------ *
 * Laboratory Details
 * ------------------------------------------------------------------ */

function DetailsCard({ details }: { details: readonly ForceAtBreakDetail[] }) {
  return (
    <InfoCard tone="soft" className="py-[4.4mm]">
      <div data-slot="report-lab-details">
        <KeyValueGrid columns={4} items={details.map((detail) => ({ key: detail.key, label: detail.label, value: detail.value }))} />
      </div>
    </InfoCard>
  );
}

/* ------------------------------------------------------------------ *
 * Maximum Load per Specimen
 * ------------------------------------------------------------------ */

type KeyItem = { key: string; swatch: ReactNode; label: string; tone?: "fail" };

/** The teal triangle the dot plot marks a median with. */
function MedianMark() {
  return (
    <svg aria-hidden viewBox="0 0 10 8" className="h-[2.1mm] w-[2.6mm] fill-accent-700">
      <path d="M5 0 L10 8 L0 8 Z" />
    </svg>
  );
}

/** A limit's swatch: the zone it rejects, tinted, edged by the dashed red line. */
function LimitSwatch({ zone = true }: { zone?: boolean }) {
  return <span className={cn("block h-[3.2mm] border-r-[0.3mm] border-dashed border-fail", zone ? "w-[3.2mm] bg-fail-tint" : "w-[1.6mm]")} />;
}

function forceKey(force: ForceAtBreakTest): KeyItem[] {
  const items: KeyItem[] = [
    { key: "specimen", swatch: <span className="block size-[2.4mm] rounded-full bg-brand-600" />, label: "One specimen" },
    { key: "median", swatch: <MedianMark />, label: force.medianLabel },
  ];
  if (force.specText) items.push({ key: "below", swatch: <LimitSwatch />, label: `Below ${force.specText}`, tone: "fail" });
  return items;
}

/** At a row's right: the median and the range, or how many readings are in while the median waits for the rest. */
function asideOf(size: ForceAtBreakSize, force: ForceAtBreakTest): AsideLine[] {
  const entered = size.readings.filter((reading) => reading !== null).length;
  if (entered === 0) return [{ text: "No readings" }];
  const range: AsideLine[] = size.range ? [{ text: `Range ${size.range}` }] : [];
  if (size.medianText === null) return [{ text: `${entered} of ${size.n} readings` }, ...range];
  const median: AsideLine = { text: force.medianLabel, strong: `${size.medianText} N` };
  return [size.status === "fail" ? { ...median, tone: "fail" } : median, ...range];
}

function ForceChart({ force, sizes, notes }: { force: ForceAtBreakTest; sizes: readonly string[]; notes: boolean }) {
  const shown = force.sizes.filter((size) => sizes.includes(size.size));
  const decimals = force.tickDecimals;
  return (
    <section data-slot="report-force-chart" className="flex flex-col gap-[2.4mm]">
      <BlockHeading title={FORCE_AT_BREAK_HEADINGS.chart} aside={<ChartKey items={forceKey(force)} />} />
      <DotPlot
        label={`Maximum load per specimen in newtons, by size${force.specText ? `, against the ${force.specText} minimum` : ""}`}
        axis={force.axis}
        limit={force.specMin === null ? null : { value: force.specMin }}
        step={force.step}
        format={(value) => formatNumber(value, { decimals })}
        rows={shown.map((size) => ({
          key: size.size,
          label: size.label,
          values: size.readings.flatMap((reading) => (reading ? [reading.value] : [])),
          median: size.median,
          aside: asideOf(size, force),
        }))}
      />
      {notes && force.notes.length > 0 && (
        <div data-slot="report-force-notes" className={cn("flex flex-col gap-[0.8mm] text-slate-700", TYPE.small)}>
          {force.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Specimen Readings and Laboratory Summary by Size
 * ------------------------------------------------------------------ */

const DASH = <span className="font-normal text-slate-400">—</span>;

/** A reading as entered; below the minimum in red with "*". */
function readingText(reading: ForceAtBreakReading | null, mark = false): ReactNode {
  if (!reading) return DASH;
  if (!reading.low) return reading.text;
  return (
    <span data-low className="font-semibold text-fail">
      {reading.text}
      {mark && "*"}
    </span>
  );
}

/** The median as judged, red when it fails; a dash until every reading is in. */
function medianText(size: ForceAtBreakSize): ReactNode {
  if (size.medianText === null) return DASH;
  return size.status === "fail" ? <span className="text-fail">{size.medianText}</span> : size.medianText;
}

/** A row label in the design's blue: the Median rows. */
function blueLabel(label: string): ReactNode {
  return <span className="text-brand-700">{label}</span>;
}

function sizeColumns(sizes: readonly { size: string; label: string }[]): ReportColumn[] {
  return sizes.map((size) => ({ key: size.size, label: size.label, numeric: true }));
}

/** A summary's label column, narrower as sizes are added. */
function labelColumn(sizes: number, tensile = false): ReportColumn {
  return { key: "label", label: <span className="sr-only">Measure</span>, width: `${Math.round(summaryLabelShare(sizes, tensile) * 100)}%` };
}

/** A size's verdict in the summary: the word on its tint, as the design sets it in the narrow columns (no glyph). */
function verdict(status: CheckStatus): ReactNode {
  return <StatusChip status={status} size="sm" className="[&>svg]:hidden" />;
}

/** A row across the sizes: its label, then each size's cell. */
function sizeRow<T extends { size: string }>(sizes: readonly T[], key: string, label: ReactNode, cell: (size: T) => ReactNode, emphasis = false): ReportRow {
  return { key, emphasis, cells: Object.fromEntries([["label", label], ...sizes.map((size) => [size.size, cell(size)])]) };
}

function ForceTables({ force, part }: { force: ForceAtBreakTest; part: Extract<ForceAtBreakPart, { kind: "forceTables" }> }) {
  return (
    <div data-slot="report-force-tables" className={cn("grid items-start gap-x-[8mm]", part.paired ? "grid-cols-[76mm_minmax(0,1fr)]" : "grid-cols-1")}>
      {part.readings && <ReadingsTable force={force} {...part.readings} />}
      {part.summary && <ForceSummary force={force} />}
    </div>
  );
}

function ReadingsTable({ force, from, to, median }: { force: ForceAtBreakTest; from: number; to: number; median: boolean }) {
  const columns: ReportColumn[] = [{ key: "label", label: force.rowLabel, width: "22%" }, ...sizeColumns(force.sizes)];
  const rows = Array.from({ length: Math.max(0, to - from) }, (_, offset) => from + offset).map((index) =>
    // Past a size's own specimens its cell stays empty; a reading still to enter is a dash.
    sizeRow(force.sizes, String(index + 1), index + 1, (size) => (index < size.n ? readingText(size.readings[index] ?? null, true) : null)),
  );
  const totals = median ? sizeRow(force.sizes, "median", blueLabel(force.medianLabel), medianText).cells : undefined;
  return (
    <section data-slot="report-force-readings" data-from={from + 1} data-to={to} className="flex min-w-0 flex-col gap-[1mm]">
      <BlockHeading title={FORCE_AT_BREAK_HEADINGS.readings} />
      <ReportTable dense zebra caption="Specimen readings in newtons, by size" columns={columns} rows={rows} totals={totals} />
    </section>
  );
}

const NOT_STATED = <span className="font-normal text-slate-600">Not stated</span>;

function ForceSummary({ force }: { force: ForceAtBreakTest }) {
  const columns: ReportColumn[] = [labelColumn(force.sizes.length), ...sizeColumns(force.sizes)];
  const rows: ReportRow[] = [
    ...(force.sizes.some((size) => size.lots) ? [sizeRow(force.sizes, "lots", force.lotLabel, (size) => size.lots ?? NOT_STATED)] : []),
    sizeRow(force.sizes, "average", "Average (N)", (size) => size.average ?? DASH),
    sizeRow(force.sizes, "sd", "SD (N)", (size) => size.sd ?? DASH),
    sizeRow(force.sizes, "minimum", "Minimum (N)", (size) => readingText(size.minimum)),
    sizeRow(force.sizes, "maximum", "Maximum (N)", (size) => readingText(size.maximum)),
    sizeRow(force.sizes, "median", blueLabel(`${force.medianLabel} (N)`), medianText, true),
    sizeRow(force.sizes, "result", "Result", (size) => verdict(size.status)),
  ];
  return (
    <section data-slot="report-force-summary" className="flex min-w-0 flex-col gap-[1mm]">
      <BlockHeading title={FORCE_AT_BREAK_HEADINGS.summary} />
      <ReportTable dense caption="Laboratory summary by size" columns={columns} rows={rows} />
      {force.labNote && <p className={cn("mt-[1mm] text-slate-600", TYPE.small)}>{force.labNote}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Physical Properties: the averages
 * ------------------------------------------------------------------ */

function AverageBars({
  title,
  minimum,
  axis,
  rows,
}: {
  title: string;
  minimum: { value: number; text: string } | null;
  axis: { min: number; max: number };
  rows: readonly { key: string; label: string; average: ForceAtBreakAverage | null }[];
}) {
  return (
    <section data-slot="report-tensile-bars" className="flex min-w-0 flex-col gap-[2.4mm]">
      <BlockHeading title={title} />
      <HBars
        label={minimum ? `${title}, by size, against the ${minimum.text} minimum` : `${title}, by size`}
        axis={axis}
        minimum={minimum?.value ?? null}
        rows={rows.map((row) => ({
          key: row.key,
          label: row.label,
          value: row.average?.value ?? null,
          display: row.average?.text,
          ...(row.average?.fail ? { tone: "fail" as const } : {}),
        }))}
      />
      {minimum && <ChartKey className="justify-start" items={[{ key: "minimum", swatch: <LimitSwatch zone={false} />, label: `Minimum ${minimum.text}`, tone: "fail" }]} />}
    </section>
  );
}

function TensileCharts({ tensile }: { tensile: ForceAtBreakTensile }) {
  return (
    <div data-slot="report-tensile-chart" className="grid grid-cols-2 gap-x-[8mm]">
      <AverageBars
        title={tensile.tensileLabel}
        minimum={tensile.tensileMin}
        axis={tensile.tensileAxis}
        rows={tensile.sizes.map((size) => ({ key: size.size, label: size.label, average: size.tensile }))}
      />
      <AverageBars
        title={tensile.elongationLabel}
        minimum={tensile.elongationMin}
        axis={tensile.elongationAxis}
        rows={tensile.sizes.map((size) => ({ key: size.size, label: size.label, average: size.elongation }))}
      />
    </div>
  );
}

/** An average's figure (the row's label gives the unit), red when below its minimum. */
function averageText(average: ForceAtBreakAverage | null): ReactNode {
  if (!average) return DASH;
  return average.fail ? <span className="font-semibold text-fail">{average.figure}</span> : average.figure;
}

function TensileSummary({ tensile }: { tensile: ForceAtBreakTensile }) {
  const columns: ReportColumn[] = [labelColumn(tensile.sizes.length, true), ...sizeColumns(tensile.sizes)];
  const rows: ReportRow[] = [
    ...(tensile.sizes.some((size) => size.lots) ? [sizeRow(tensile.sizes, "lots", tensile.lotLabel, (size) => size.lots ?? NOT_STATED)] : []),
    sizeRow(tensile.sizes, "tensile", tensile.tensileLabel, (size) => averageText(size.tensile)),
    sizeRow(tensile.sizes, "elongation", tensile.elongationLabel, (size) => averageText(size.elongation)),
    sizeRow(tensile.sizes, "result", "Result", (size) => verdict(size.status)),
  ];
  return (
    <section data-slot="report-tensile-summary" className="flex min-w-0 flex-col gap-[1mm]">
      <BlockHeading title={FORCE_AT_BREAK_HEADINGS.summary} />
      <ReportTable dense caption="Laboratory summary by size" columns={columns} rows={rows} />
      {tensile.labNote && <p className={cn("mt-[1mm] text-slate-600", TYPE.small)}>{tensile.labNote}</p>}
    </section>
  );
}
