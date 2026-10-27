// A planned page whose builder gives nothing: its heading as it prints,
// "<Section title>: nothing entered yet", and the parts the options keep, so
// the page count and the options read right in the preview of an inspection
// still being entered. It began as the "coming next" page of sections not
// built yet (Kenneth, 27 October 2026); every section has its builder now,
// so it only stands for data not entered. The photo records print one such
// page each.
import type { ReactNode } from "react";
import { counted } from "@/lib/report/format";
import type { ReportPhotosPlanEntry, ReportSectionPlanEntry } from "@/lib/report/model";
import { cn } from "@/lib/utils";
import { SectionHeading } from "./section-heading";
import { TYPE } from "./theme";

export function comingNextText(title: string): string {
  return `${title}: nothing entered yet`;
}

/** The bodies of an entry its builder left empty: one for a section, one per photo record. */
export function comingNextPages(entry: ReportSectionPlanEntry | ReportPhotosPlanEntry): ReactNode[] {
  if (entry.kind === "section") {
    return [<ComingNextPage key={entry.key} slot={entry.key} kicker={entry.kicker} title={entry.title} parts={entry.blocks.map((block) => block.label)} />];
  }
  return entry.records.map((record) => (
    <ComingNextPage key={record.key} slot={record.key} kicker={record.kicker} title={record.title} parts={[counted(record.photos.length, "photo")]} />
  ));
}

export function ComingNextPage({ slot, kicker, title, parts }: { slot: string; kicker: string; title: string; parts: readonly string[] }) {
  return (
    <div data-slot="report-coming-next" data-entry={slot} className="flex flex-col gap-[6mm]">
      <SectionHeading kicker={kicker} title={title} />
      <div className="flex flex-col gap-[2.4mm] rounded-[2.8mm] border-[0.3mm] border-dashed border-slate-300 bg-slate-50 px-[6mm] py-[8mm]">
        <p className={cn("font-semibold text-slate-700", TYPE.block)}>{comingNextText(title)}</p>
        {parts.length > 0 && (
          <ul aria-label="On this page" className={cn("flex flex-wrap gap-x-[2.4mm] gap-y-[1.6mm] text-slate-600", TYPE.small)}>
            {parts.map((part) => (
              <li key={part} className="rounded-full border-[0.3mm] border-slate-200 bg-white px-[2.4mm] py-[0.6mm]">
                {part}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
