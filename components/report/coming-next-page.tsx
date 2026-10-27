// A planned page whose section is not built yet (Kenneth, 27 October 2026:
// the Summary first, the other sections after): its heading as it will
// print, "<Section title>: coming next", and the parts the options keep, so
// the page count and the options already read right in the preview. The
// photo records print one such page each.
import type { ReactNode } from "react";
import { counted } from "@/lib/report/format";
import type { ReportPhotosPlanEntry, ReportSectionPlanEntry } from "@/lib/report/model";
import { cn } from "@/lib/utils";
import { SectionHeading } from "./section-heading";
import { TYPE } from "./theme";

export function comingNextText(title: string): string {
  return `${title}: coming next`;
}

/** The bodies of an entry not built yet: one for a section, one per photo record. */
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
