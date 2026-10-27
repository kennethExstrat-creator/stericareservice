// Section 06's pages, Freedom from Holes & Visual Inspection (TG35 page 6),
// from the content lib/report/sections/holes-visual.ts builds and plans:
// the heading and lead; Defects Found against Acceptance Limit, a table of
// the sizes against each check, each cell the count found over a track that
// ends at the reject number (a limit of 0, the critical defects, with a
// chip instead: None, or Failed in red); then each page's columns of
// defect tables and photos. The tables are the report's own (plain: no
// hairlines, a class's heading in blue, totals tinted), a defect found in
// bold, a zero in grey, a total over its limit and any critical defect in
// red. The sizes here are those the plan's room estimates
// (HOLES_VISUAL_ROOM) count with: change one, change the other.
import type { ReactNode } from "react";
import type {
  DefectLimitCell,
  DefectLimits,
  DefectRow,
  DefectValue,
  HolesVisualContent,
  HolesVisualPage,
  HolesVisualSlot,
} from "@/lib/report/sections/holes-visual";
import { cn } from "@/lib/utils";
import { ChartKey } from "../chart-parts";
import { PhotoGrid } from "../photo-grid";
import { ReportTable, type ReportColumn, type ReportRow } from "../report-table";
import { BlockHeading, SectionHeading } from "../section-heading";
import { StatusChip } from "../status-chip";
import { TYPE } from "../theme";
import { TrackBar } from "../track-bar";
import { defineSectionPages, type SectionPagesProps } from "./index";

type Sizes = HolesVisualContent["sizes"];

function HolesVisualPages({ entry, content }: SectionPagesProps<"holesVisual">): ReactNode[] {
  return content.pages.map((page, index) => (
    <div key={index} data-slot="report-holes-visual" data-part={index + 1} className="flex flex-col gap-[5mm]">
      {index === 0 ? (
        <SectionHeading kicker={entry.kicker} title={entry.title} lead={content.lead || undefined} />
      ) : (
        <SectionHeading kicker={`${entry.kicker} · Continued`} title={entry.title} />
      )}
      {index === 0 && content.limits && <LimitsGrid limits={content.limits} />}
      <PageColumns page={page} sizes={content.sizes} />
    </div>
  ));
}

export const holesVisualPages = defineSectionPages({ key: "holesVisual", Pages: HolesVisualPages });

/* ------------------------------------------------------------------ *
 * Defects Found against Acceptance Limit
 * ------------------------------------------------------------------ */

/** The legend's swatches: the track's own parts. */
const SWATCH = "h-[1.8mm] w-[3.6mm] rounded-full";

/** A size's row: 11 mm with its hairline (HOLES_VISUAL_ROOM.gridRow; Kenneth, 27 October 2026). */
const ROW = "h-[10.75mm] pt-[0.8mm]";

/**
 * The sizes down, the checks across, at least three columns wide so a
 * single check's track keeps the design's length. A real table: its cells
 * spaced apart (border-spacing), so each header's dark rule and each row's
 * hairline stop short of the next column, as the design draws them.
 */
function LimitsGrid({ limits }: { limits: DefectLimits }) {
  const blanks = Array.from({ length: Math.max(0, 3 - limits.columns.length) }, (_, index) => `blank-${index}`);
  return (
    <section data-slot="report-defect-limits" className="flex flex-col gap-[2.4mm]">
      <BlockHeading
        title={limits.title}
        aside={
          <ChartKey
            className={TYPE.tiny}
            items={[
              { key: "found", swatch: <span className={cn(SWATCH, "bg-brand-600")} />, label: limits.legend.found },
              { key: "reject", swatch: <span className={cn(SWATCH, "bg-fail-border")} />, label: limits.legend.reject },
              { key: "track", swatch: <span className={cn(SWATCH, "bg-slate-200")} />, label: limits.legend.track },
            ]}
          />
        }
      />
      <table className="-mx-[4.6mm] w-[calc(100%+9.2mm)] table-fixed border-separate border-spacing-x-[4.6mm] border-spacing-y-0">
        <caption className="sr-only">{limits.title}</caption>
        <colgroup>
          <col style={{ width: "17mm" }} />
          {[...limits.columns.map((column) => column.key), ...blanks].map((key) => (
            <col key={key} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className={cn("border-b-[0.4mm] border-slate-900 pb-[1.6mm] text-left align-middle font-normal text-slate-600", TYPE.small)}>
              Size
            </th>
            {limits.columns.map((column) => (
              <th key={column.key} scope="col" data-column={column.key} className="border-b-[0.4mm] border-slate-900 pb-[1.6mm] text-left align-bottom">
                <span className="block text-[9.5pt] leading-[1.3] font-semibold text-slate-900">{column.label}</span>
                {column.aql && <span className={cn("block font-normal text-slate-600", TYPE.small)}>{column.aql}</span>}
              </th>
            ))}
            {blanks.map((key) => (
              <td key={key} aria-hidden />
            ))}
          </tr>
        </thead>
        <tbody>
          {limits.rows.map((row) => (
            <tr key={row.size} data-row={row.size}>
              <th scope="row" className="border-b-[0.25mm] border-slate-200 p-0 text-left align-top font-normal">
                <div className={ROW}>
                  <span className="block text-[12pt] leading-[1.15] font-bold text-slate-900">{row.label}</span>
                  <span className="mt-[0.6mm] block text-[8.5pt] leading-[1.25] text-slate-600 tabular-nums">{row.n}</span>
                </div>
              </th>
              {row.cells.map((cell) => (
                <td key={cell.key} data-cell={cell.key} data-status={cell.status} className="border-b-[0.25mm] border-slate-200 p-0 align-top">
                  <div className={ROW}>
                    <LimitCell cell={cell} />
                  </div>
                </td>
              ))}
              {blanks.map((key) => (
                <td key={key} aria-hidden />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** "2 found · accept ≤ 10" over its track; a limit of 0 with its chip; Not Done until calc can judge the size. Set close, for the row's 11 mm. */
function LimitCell({ cell }: { cell: DefectLimitCell }) {
  const words = "[&>p]:whitespace-nowrap [&>p]:leading-[1.15]";
  if (cell.status === "not_done" || cell.accept === null) {
    return (
      <div className="flex flex-col items-start gap-[0.8mm]">
        {cell.found > 0 && (
          <p className="text-[8.5pt] leading-[1.15] whitespace-nowrap text-slate-900 tabular-nums">
            <span className="text-[11pt] font-bold">{cell.found}</span> found
          </p>
        )}
        <StatusChip status="not_done" size="sm" />
      </div>
    );
  }
  const failed = cell.status === "fail";
  if (cell.accept === 0) {
    return (
      <div className="flex flex-col items-start gap-[0.8mm]">
        <TrackBar found={cell.found} accept={0} reject={cell.reject} bar={false} failed={failed} className={words} />
        <StatusChip status={failed ? "fail" : "pass"} label={failed ? undefined : "None"} size="sm" />
      </div>
    );
  }
  return <TrackBar found={cell.found} accept={cell.accept} reject={cell.reject} failed={failed} className={words} />;
}

/* ------------------------------------------------------------------ *
 * The columns: defect tables and photos
 * ------------------------------------------------------------------ */

function PageColumns({ page, sizes }: { page: HolesVisualPage; sizes: Sizes }) {
  if (page.columns.every((column) => column.length === 0)) return null;
  const column = (slots: readonly HolesVisualSlot[], index: number) => (
    <div key={index} data-column={index + 1} className="flex min-w-0 flex-col gap-[4mm]">
      {slots.map((slot, position) => (
        <Slot key={slot.kind === "table" ? `${slot.table.key}-${slot.table.rows[0]?.key ?? position}` : `photos-${position}`} slot={slot} sizes={sizes} />
      ))}
    </div>
  );
  if (page.layout === "stack") return column(page.columns[0] ?? [], 0);
  return (
    <div data-slot="report-holes-visual-columns" className="grid grid-cols-[minmax(0,84fr)_minmax(0,93fr)] items-start gap-x-[7mm]">
      {page.columns.map(column)}
    </div>
  );
}

/** The defect photos where the tables left room: headed where they open a column, in the tiles' shape the room took, captioned plain, the rings drawn on them. */
function Slot({ slot, sizes }: { slot: HolesVisualSlot; sizes: Sizes }) {
  if (slot.kind === "photos") {
    return (
      <section data-slot="report-defect-photos" aria-label={slot.title ?? "Defect photos"} className="flex flex-col gap-[1mm]">
        {slot.title && <BlockHeading title={slot.title} />}
        <PhotoGrid columns={slot.columns} aspect={slot.aspect} photos={slot.photos} />
      </section>
    );
  }
  return <DefectTableView slot={slot} sizes={sizes} />;
}

const LABEL = "label";
const sizeKey = (size: string) => `size:${size}`;

/** A figure's look: a defect found in bold, a zero in grey, a total over its limit and a critical defect in red. */
const TONE: Readonly<Record<DefectValue["tone"], string>> = {
  plain: "text-slate-900",
  muted: "text-slate-600",
  zero: "text-slate-600",
  found: "font-bold text-slate-900",
  total: "font-bold text-slate-900",
  fail: "font-bold text-fail",
  missing: "text-slate-400",
};

/** A defect table's piece under its heading; a class moved under the critical defects without it, its header row and class heading enough. */
function DefectTableView({ slot, sizes }: { slot: Extract<HolesVisualSlot, { kind: "table" }>; sizes: Sizes }) {
  const { table, widths, continued, heading } = slot;
  const columns: ReportColumn[] = [
    { key: LABEL, label: table.firstHeader, width: `${widths.label}%` },
    ...sizes.map((size) => ({ key: sizeKey(size.size), label: size.label, numeric: true, width: `${widths.value}%` })),
  ];
  const rows: ReportRow[] = table.rows.map((row) =>
    row.kind === "group"
      ? { key: row.key, group: true, cells: { [LABEL]: <GroupHeading row={row} /> } }
      : {
          key: row.key,
          emphasis: row.kind === "total",
          cells: {
            [LABEL]: <RowLabel row={row} />,
            ...Object.fromEntries(sizes.map((size, index) => [sizeKey(size.size), <Figure key={size.size} value={row.values[index]} />])),
          },
        },
  );
  return (
    <section data-slot="report-defect-table" data-table={table.key} data-continued={continued || undefined} className="flex flex-col gap-[1mm]">
      {heading && <BlockHeading title={table.title} aside={continued ? "Continued" : (table.aside ?? undefined)} />}
      <ReportTable plain caption={continued ? `${table.title}, continued` : table.title} columns={columns} rows={rows} />
    </section>
  );
}

/** A class's heading: "Major · AQL 2.5", the class in blue. */
function GroupHeading({ row }: { row: DefectRow }) {
  return (
    <>
      <span className="font-bold text-brand-700">{row.label}</span>
      {row.detail && <span className="font-medium text-slate-600"> · {row.detail}</span>}
      {row.continued && <span className="font-normal text-slate-500"> (Continued)</span>}
    </>
  );
}

/** A row's label: a defect or a limit in grey, a one-off's "Defect Not in the List" under it. */
function RowLabel({ row }: { row: DefectRow }) {
  return (
    <>
      <span className={row.kind === "defect" || row.kind === "limits" ? "text-slate-600" : undefined}>{row.label}</span>
      {row.note && <span className={cn("block text-slate-500", TYPE.tiny)}>{row.note}</span>}
    </>
  );
}

function Figure({ value }: { value: DefectValue | undefined }) {
  if (!value) return null;
  return <span className={cn("whitespace-nowrap", TONE[value.tone])}>{value.text}</span>;
}
