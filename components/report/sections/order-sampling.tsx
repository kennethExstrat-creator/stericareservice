// Section 02, Order, Product & Sampling (TG35 page 2): Glove Information
// beside Packing Configuration, the order lots and sampling plan in one
// table, and the sampled box/carton numbers as a strip per size. One body
// per page of the content's layout (lib/report/sections/
// order-sampling-layout.ts, whose ORDER_SAMPLING_ROOM counts the sizes set
// here: change one, change both); the frame adds the chrome. A value the app
// judged wrong prints in fail red, a warning in amber; one not entered reads
// "Not stated", or a dash in the table's figures.
import { ChevronRightIcon } from "lucide-react";
import { Fragment } from "react";
import { formatCount } from "@/lib/format";
import { shareText } from "@/lib/report/format";
import { NOT_STATED, type OrderSamplingSection } from "@/lib/report/model";
import type {
  CartonRow,
  CartonSlice,
  CartonStrips,
  CellTone,
  GloveCard,
  LotsCell,
  LotsColumn,
  OrderLotsTable,
  OrderSamplingPart,
  PackingCard,
  PackingTile,
} from "@/lib/report/sections/order-sampling";
import { captionText } from "@/lib/report/sections/order-sampling-layout";
import { cn } from "@/lib/utils";
import { ChartKey } from "../chart-parts";
import { InfoCard, KeyValueGrid } from "../info-card";
import { ReportTable, type ReportColumn, type ReportColumnGroup, type ReportRow } from "../report-table";
import { BlockHeading, SectionHeading } from "../section-heading";
import { StripPlot, type StripRow } from "../strip-plot";
import { TYPE } from "../theme";
import { defineSectionPages } from "./index";

export const orderSamplingPages = defineSectionPages({
  key: "orderSampling",
  Pages: ({ entry, content }) =>
    content.pages.map((page, index) => (
      <div key={index} data-slot="report-order-sampling" data-section-page={index + 1} className="flex flex-col gap-[4.6mm]">
        <SectionHeading
          kicker={index === 0 ? entry.kicker : `${entry.kicker} · Continued`}
          title={entry.title}
          lead={index === 0 ? content.lead : undefined}
        />
        {page.parts.map((part, partIndex) => (
          <Part key={`${part.kind}-${partIndex}`} part={part} content={content} />
        ))}
      </div>
    )),
});

function Part({ part, content }: { part: OrderSamplingPart; content: OrderSamplingSection }) {
  switch (part.kind) {
    case "cards":
      return <CardsRow glove={content.glove} packing={content.packing} />;
    case "lots":
      return content.lots ? <LotsBlock table={content.lots} /> : null;
    case "cartons":
      return content.cartons ? <CartonsBlock strips={content.cartons} continued={part.continued} slices={part.slices} /> : null;
  }
}

/* ------------------------------------------------------------------ *
 * Glove Information and Packing Configuration
 * ------------------------------------------------------------------ */

/** Side by side as the design sets them; either alone across the page. */
function CardsRow({ glove, packing }: { glove: GloveCard | null; packing: PackingCard | null }) {
  const both = glove !== null && packing !== null;
  return (
    <div data-slot="report-order-cards" className={cn("grid gap-[4.6mm]", both ? "grid-cols-2" : "grid-cols-1")}>
      {glove && <GloveInformation card={glove} columns={both ? 2 : 3} />}
      {packing && <PackingConfiguration card={packing} alone={!both} />}
    </div>
  );
}

function GloveInformation({ card, columns }: { card: GloveCard; columns: 2 | 3 }) {
  return (
    <InfoCard title={card.title}>
      <KeyValueGrid
        columns={columns}
        items={card.facts.map((fact) => ({
          key: fact.key,
          label: fact.label,
          muted: !fact.stated,
          value: fact.swatch ? (
            <span className="inline-flex items-center gap-[1.6mm]">
              <span
                aria-hidden
                data-slot="report-colour-swatch"
                className="size-[3.2mm] shrink-0 rounded-[0.8mm] border-[0.2mm] border-slate-300"
                style={{ backgroundColor: fact.swatch }}
              />
              {fact.value}
            </span>
          ) : (
            fact.value
          ),
        }))}
      />
    </InfoCard>
  );
}

/** Gloves per inner unit › inner units per case › gloves per case, the last tinted teal, centred in the card's height. */
function PackingConfiguration({ card, alone }: { card: PackingCard; alone: boolean }) {
  return (
    <InfoCard title={card.title} className="flex flex-col">
      <div className="flex flex-1 items-center">
        <div
          data-slot="report-packing-tiles"
          className={cn("grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-[1.5mm]", alone && "max-w-[110mm]")}
        >
          {card.tiles.map((tile, index) => (
            <Fragment key={tile.key}>
              {index > 0 && <ChevronRightIcon aria-hidden strokeWidth={2.5} className="size-[3.2mm] text-slate-500" />}
              <Tile tile={tile} total={index === card.tiles.length - 1} />
            </Fragment>
          ))}
        </div>
      </div>
    </InfoCard>
  );
}

/** The count at the design's size, smaller where a long one would not fit the tile. */
function figureSize(figure: string): string {
  return figure.length <= 5 ? "text-[18pt]" : figure.length <= 7 ? "text-[15pt]" : "text-[12pt]";
}

function Tile({ tile, total }: { tile: PackingTile; total: boolean }) {
  const figure = tile.value === null ? null : formatCount(tile.value);
  return (
    <div
      data-slot="report-packing-tile"
      data-tile={tile.key}
      className={cn(
        "flex min-w-0 flex-col items-center rounded-[2.4mm] border-[0.3mm] px-[1.4mm] py-[3mm] text-center",
        total ? "border-accent-200 bg-accent-50" : "border-brand-200 bg-brand-50",
      )}
    >
      <p
        className={cn(
          "flex h-[7mm] items-center leading-[1.1] whitespace-nowrap",
          figure === null ? "text-[10pt] text-slate-600" : cn("font-bold", figureSize(figure), total ? "text-accent-700" : "text-brand-600"),
        )}
      >
        {figure ?? NOT_STATED}
      </p>
      <p className={cn("mt-[1mm] text-slate-600", TYPE.small)}>{tile.caption}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Order Lots & Sampling Plan
 * ------------------------------------------------------------------ */

/**
 * The design's cells: 1.2 mm either side, so the ten figures' columns fit
 * the page with their captions in two lines, and rows roomier than Results
 * by Check's, 1.6 mm above and below (ORDER_SAMPLING_ROOM.table).
 */
const LOTS_CELLS = "[&>*>tr>*]:px-[1.2mm] [&>tbody>tr>*]:py-[1.6mm] [&>tfoot>tr>*]:py-[1.6mm]";

const TONE_CLASS: Readonly<Record<Exclude<CellTone, null>, string>> = {
  fail: "font-semibold text-fail",
  warn: "font-semibold text-warn",
};

/** The share as a short bar filled to it, then the percentage, the bars lined up down the column. */
function ShareCell({ share }: { share: number }) {
  return (
    <span className="flex items-center justify-end gap-[1.6mm]">
      <span aria-hidden data-slot="report-share-bar" data-share={share} className="relative h-[1.7mm] w-[8mm] shrink-0 overflow-hidden rounded-full bg-brand-100">
        <span className="absolute inset-y-0 left-0 rounded-full bg-brand-500" style={{ width: `${Math.min(100, Math.max(0, share))}%` }} />
      </span>
      <span className="min-w-[9mm]">{shareText(share)}</span>
    </span>
  );
}

function Figure({ column, cell }: { column: LotsColumn; cell: LotsCell | undefined }) {
  const value = cell?.value ?? null;
  if (value === null) return <span className="text-slate-500">—</span>;
  if (column.id === "order.share") return <ShareCell share={value} />;
  const tone = cell?.tone ?? null;
  return (
    <span data-tone={tone ?? undefined} className={tone ? TONE_CLASS[tone] : undefined}>
      {formatCount(value)}
    </span>
  );
}

/** The lot numbers with a break point after each hyphen, where the width estimate may break them (lotPieces); spaces kept. */
function LotText({ text }: { text: string }) {
  return text.split(/(?<=-)/).map((piece, index) => (
    <Fragment key={index}>
      {index > 0 && <wbr />}
      {piece}
    </Fragment>
  ));
}

function LotsBlock({ table }: { table: OrderLotsTable }) {
  const width = (id: string) => `${(table.widths[id] ?? 0).toFixed(2)}%`;
  const columns: ReportColumn[] = [
    { key: "size", label: table.sizeHeader, strong: true, width: width("size") },
    { key: "lot", label: table.lotHeader, width: width("lot") },
    ...table.columns.map((column): ReportColumn => ({ key: column.id, label: captionText(column.label), numeric: true, width: width(column.id) })),
  ];
  const groups: ReportColumnGroup[] = [{ span: 2 }, ...table.groups.map((group) => ({ label: group.label, span: group.span }))];
  const rows: ReportRow[] = table.rows.map((row) => ({
    key: row.size,
    cells: {
      size: row.label,
      lot: row.lots.length > 0 ? <LotText text={row.lotText} /> : <span className="text-slate-600">{row.lotText}</span>,
      ...Object.fromEntries(table.columns.map((column) => [column.id, <Figure key={column.id} column={column} cell={row.cells[column.id]} />])),
    },
  }));
  const totals = {
    size: "Total",
    lot: "",
    ...Object.fromEntries(
      table.columns.map((column) => {
        const total = table.totals[column.id] ?? null;
        return [column.id, total === null ? "—" : column.id === "order.share" ? shareText(total) : formatCount(total)];
      }),
    ),
  };
  return (
    <section data-slot="report-order-lots" className="flex flex-col gap-[2mm]">
      <BlockHeading title={table.title} />
      <ReportTable caption={table.title} columns={columns} groups={groups} rows={rows} totals={totals} className={LOTS_CELLS} />
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Finished Goods Sampling
 * ------------------------------------------------------------------ */

function stripRow(row: CartonRow, slice: CartonSlice): StripRow {
  const failing = new Set(row.failing);
  const numbers = row.numbers.slice(slice.from, slice.to);
  return {
    key: `${row.size}-${slice.from}`,
    label: row.label,
    sublabel: slice.continued ? (
      "Continued"
    ) : (
      <span data-slot="report-carton-count" className={row.overCount ? "font-semibold text-fail" : undefined}>
        {formatCount(row.cartons.length)} of {formatCount(row.ordered)}
      </span>
    ),
    marks: row.cartons,
    failing: row.failing,
    total: row.ordered,
    numbers:
      numbers.length === 0
        ? NOT_STATED
        : numbers.map((number, index) => {
            const carton = row.cartons[slice.from + index];
            return (
              <Fragment key={index}>
                {index > 0 && " "}
                <span data-carton={carton} className={failing.has(carton) ? "font-semibold text-fail" : undefined}>
                  {number}
                </span>
              </Fragment>
            );
          }),
  };
}

function CartonsBlock({ strips, continued, slices }: { strips: CartonStrips; continued: boolean; slices: readonly CartonSlice[] }) {
  return (
    <section data-slot="report-carton-strips" data-continued={continued || undefined} className="flex flex-col">
      <BlockHeading
        title={strips.title}
        aside={<ChartKey items={[{ key: "carton", swatch: <span className="block h-[3.2mm] w-[0.5mm] rounded-full bg-brand-600" />, label: strips.legend }]} />}
      />
      {!continued && (
        <p data-slot="report-carton-summary" className="mt-[2mm] text-[9.5pt] leading-[1.5] text-slate-600">
          {strips.summary}
        </p>
      )}
      <StripPlot className="mt-[3mm]" label="Sampled box/carton numbers by size" rows={slices.map((slice) => stripRow(strips.rows[slice.row], slice))} />
    </section>
  );
}
