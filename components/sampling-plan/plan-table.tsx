// Sampling Plan by Size, as the design sets it: the ordered sizes as
// columns, each headed by its chip, then Total in a tinted column; SAMPLING
// QUANTITY and FOR EACH TEST in blue capitals over a blue rule; a row per
// count, numbers right-aligned in tabular figures, hairlines between. A
// count that stands apart from its row's usual one is bold (the per-case and
// per-box rows, where the factory must take a different number). Put Back
// is taken away (−8), and Gloves sampled, what the plan comes to, is tinted
// teal. No total where a sum means nothing (per case, per box); a dash for a
// count not entered yet.
import { SizeChip } from "@/components/report/size-chip";
import { TYPE } from "@/components/report/theme";
import { formatCount } from "@/lib/format";
import type { SamplingPlanGroup, SamplingPlanRow, SamplingPlanSize } from "@/lib/sampling-plan/model";
import { cn } from "@/lib/utils";

/** A count not entered yet. */
export const NO_COUNT = "—";

/** A count as printed: thousands separated, one taken away with a minus sign (−8), a blank as a dash. */
export function countText(value: number | null, negative = false): string {
  if (value === null) return NO_COUNT;
  return negative && value !== 0 ? `−${formatCount(Math.abs(value))}` : formatCount(value);
}

/**
 * The columns' shares of the table, in percent: the labels about a third
 * (less with more than five sizes), Total a tenth, the sizes the rest, each
 * no wider than with four sizes (the design's), the labels taking what is left.
 */
export function columnShares(sizes: number, total: boolean): { label: number; size: number; total: number } {
  const totalShare = total ? 10.9 : 0;
  const labelFloor = sizes <= 5 ? 34 : Math.max(22, 34 - (sizes - 5) * 4);
  const size = Math.min(13.8, (100 - labelFloor - totalShare) / Math.max(1, sizes));
  return { label: 100 - totalShare - size * sizes, size, total: totalShare };
}

const TOTAL_TINT = "bg-brand-50";
const HEAD_CELL = "px-[2.8mm] pt-[0.45mm] pb-[1.45mm] align-bottom";
const CELL = "px-[2.8mm] py-[1.4mm] align-middle";
const GROUP_TYPE = "text-[9pt] leading-[1.3] font-bold uppercase tracking-[0.16em]";

export type SamplingPlanTableProps = {
  sizes: readonly SamplingPlanSize[];
  /** Every size the template lists, in order: a size that is not a letter takes its chip's blue by its place. */
  templateSizes: readonly string[];
  groups: readonly SamplingPlanGroup[];
  showTotal: boolean;
  className?: string;
};

export function SamplingPlanTable({ sizes, templateSizes, groups, showTotal, className }: SamplingPlanTableProps) {
  const shares = columnShares(sizes.length, showTotal);
  const percent = (share: number) => `${share.toFixed(2)}%`;
  return (
    <table data-slot="sampling-plan-table" className={cn("w-full table-fixed border-collapse text-slate-900", TYPE.body, "leading-[1.45]", className)}>
      <caption className="sr-only">Sampling plan by size</caption>
      <colgroup>
        <col style={{ width: percent(shares.label) }} />
        {sizes.map((size) => (
          <col key={size.value} style={{ width: percent(shares.size) }} />
        ))}
        {showTotal && <col style={{ width: percent(shares.total) }} />}
      </colgroup>
      <thead>
        <tr className="border-b-[0.35mm] border-slate-900">
          <th scope="col" className={cn(HEAD_CELL, "text-left font-medium text-slate-600", TYPE.small)}>
            Size
          </th>
          {sizes.map((size) => (
            <th key={size.value} scope="col" data-size-head={size.value} className={cn(HEAD_CELL, "text-right")}>
              <SizeChip size={size.value} label={size.label} templateSizes={templateSizes} className="h-[5.9mm] min-w-[9mm] text-[10pt] leading-none" />
            </th>
          ))}
          {showTotal && (
            <th scope="col" className={cn(HEAD_CELL, TOTAL_TINT, "text-right font-bold text-slate-900", TYPE.small)}>
              Total
            </th>
          )}
        </tr>
      </thead>
      {groups.map((group) => (
        <tbody key={group.key} data-group={group.key}>
          <tr className="border-b-[0.35mm] border-brand-300">
            <th scope="rowgroup" colSpan={1 + sizes.length} className={cn("px-[2.8mm] pt-[2.9mm] pb-[1.2mm] text-left text-brand-600", GROUP_TYPE)}>
              {group.title}
            </th>
            {showTotal && <td aria-hidden className={TOTAL_TINT} />}
          </tr>
          {group.rows.map((row) => (
            <PlanRow key={row.key} row={row} showTotal={showTotal} />
          ))}
        </tbody>
      ))}
    </table>
  );
}

function PlanRow({ row, showTotal }: { row: SamplingPlanRow; showTotal: boolean }) {
  return (
    <tr
      data-row={row.key}
      data-highlight={row.highlight || undefined}
      className={row.highlight ? "border-b-[0.35mm] border-accent-200 bg-accent-50" : "border-b-[0.25mm] border-slate-200"}
    >
      <th scope="row" className={cn(CELL, "text-left text-slate-900", row.highlight ? "font-bold" : "font-normal")}>
        {row.label}
        {row.unit && <span className="font-normal text-slate-500"> {row.unit}</span>}
      </th>
      {row.cells.map((cell, index) => (
        <td
          key={index}
          data-odd={cell.odd || undefined}
          className={cn(
            CELL,
            "text-right tabular-nums",
            row.highlight ? "font-bold text-accent-700" : cell.value === null ? "text-slate-400" : cell.odd ? "font-bold text-slate-900" : "",
          )}
        >
          {countText(cell.value, row.negative)}
        </td>
      ))}
      {showTotal && (
        <td data-total className={cn(CELL, "text-right font-bold tabular-nums", row.highlight ? "text-accent-700" : cn(TOTAL_TINT, "text-slate-900"))}>
          {row.summed ? countText(row.total, row.negative) : null}
        </td>
      )}
    </tr>
  );
}
