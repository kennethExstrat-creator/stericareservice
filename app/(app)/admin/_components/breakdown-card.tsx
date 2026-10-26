// The dashboard's By Client, By Manufacturer and By Inspector cards: the
// period's inspections per name, busiest first, each with a thin bar as long
// as its count (the busiest fills the width), split by result in the chart's
// colours and order. A client or manufacturer opens the inspections list
// filtered to it (every date: the list has no date filter). The first six
// show and a line counts the rest; each row reads out its results, which the
// bar only shows. No hooks: the server renders it.
import Link from "next/link";
import type { ReactNode } from "react";
import { RESULT_FILL_CLASS, RESULT_ORDER, inspectionCount, resultMix, type BreakdownRow } from "@/lib/admin/dashboard";

const SHOWN = 6;

const ROW = "-mx-2 flex flex-col gap-1.5 rounded-lg px-2 py-2 touch:min-h-11";

function Row({ row, top, href }: { row: BreakdownRow; top: number; href: string | null }) {
  const body: ReactNode = (
    <>
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-medium text-foreground">{row.label}</span>
        <span className="shrink-0 text-sm font-semibold text-foreground tabular-nums touch:text-base">
          {row.counts.total.toLocaleString("en-US")}
        </span>
      </span>
      <span
        aria-hidden
        title={resultMix(row.counts)}
        className="flex h-2 gap-[2px] overflow-hidden rounded-r-[4px]"
        style={{ width: `${(row.counts.total / top) * 100}%` }}
      >
        {RESULT_ORDER.map((key) =>
          row.counts[key] > 0 ? (
            <span key={key} className={RESULT_FILL_CLASS[key]} style={{ flexGrow: row.counts[key], flexBasis: 0, minWidth: 2 }} />
          ) : null,
        )}
      </span>
      <span className="sr-only">{`${inspectionCount(row.counts.total)}: ${resultMix(row.counts)}`}</span>
    </>
  );
  return href ? (
    <Link href={href} className={`${ROW} transition-colors hover:bg-slate-50 focus-ring`}>
      {body}
    </Link>
  ) : (
    <div className={ROW}>{body}</div>
  );
}

export function BreakdownCard({
  id,
  title,
  rows,
  noun,
  hrefFor,
}: {
  /** The heading's id, which names the card. */
  id: string;
  title: string;
  rows: readonly BreakdownRow[];
  /** What the rows are, for the line that counts the rest: "1 more client". */
  noun: { one: string; many: string };
  /** Where a row with an id opens; none for rows that do not link. */
  hrefFor?: (id: string) => string;
}) {
  const top = rows[0]?.counts.total ?? 0;
  const rest = rows.length - SHOWN;
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-3 rounded-xl bg-card p-5 shadow-sm ring-1 ring-border touch:p-6"
    >
      <h3 id={id} className="text-lg leading-tight font-bold text-foreground">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground touch:text-base">No inspections in this period.</p>
      ) : (
        <ul className="flex flex-col">
          {rows.slice(0, SHOWN).map((row) => (
            <li key={row.id ?? ""}>
              <Row row={row} top={top} href={row.id && hrefFor ? hrefFor(row.id) : null} />
            </li>
          ))}
        </ul>
      )}
      {rest > 0 && (
        <p className="text-sm text-muted-foreground touch:text-base">
          And {rest.toLocaleString("en-US")} more {rest === 1 ? noun.one : noun.many}.
        </p>
      )}
    </section>
  );
}
