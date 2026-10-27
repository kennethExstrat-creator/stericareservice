// The photo records (TG35 pages 9 to 11), from their slot
// (lib/report/sections/photos.ts): the records flowing from page to page,
// each under "Photo Record 1 of 3" and its title where it starts, a record
// starting under the one before where it fits; then each group of photos
// under its heading with its note at the right on one line (where and when,
// what the labels show, what was tested), or "Continued" where a group goes
// on from the page before, in the design's grids: the warehouse large beside
// the sampling, labels four across, the packing and watertight photos five
// across, square. A caption naming a defect is bold, the rings drawn on a
// photo red over it. The images are the export's signed links, plain <img>,
// so the print route renders them on the server as they are. The gaps are
// those the builder plans with (PHOTO_ROOM): change one, change the other.
//
// Typed by SectionPages, never importing the registry at run time, and the
// primitives from their own files (not ../index, which lists these pages).
import type { ReactNode } from "react";
import type { PhotoBlock } from "@/lib/report/model";
import { CONTINUED_GROUP } from "@/lib/report/sections/photos";
import { PhotoGrid } from "../photo-grid";
import { BlockHeading, SectionHeading } from "../section-heading";
import type { SectionPages, SectionPagesProps } from "./index";

function Pages({ content }: SectionPagesProps<"photos">): ReactNode[] {
  return content.pages.map((page, index) => (
    <div key={index} data-slot="report-photo-record-page" className="flex flex-col gap-[8mm]">
      {page.records.map((record) => (
        <div key={record.key} data-slot="report-photo-record" data-record={record.key} className="flex flex-col gap-[4.6mm]">
          <SectionHeading kicker={record.kicker} title={record.title} />
          {record.blocks.map((block) => (
            <PhotoBlockView key={block.key} block={block} />
          ))}
        </div>
      ))}
    </div>
  ));
}

export const photosPages: SectionPages<"photos"> = { key: "photos", Pages };

function PhotoBlockView({ block }: { block: PhotoBlock }) {
  // The builder words the note to fit beside the title: kept to its one line.
  const aside = block.continued ? CONTINUED_GROUP : block.note;
  return (
    <section data-slot="report-photo-block" data-block={block.key} data-continued={block.continued || undefined} className="flex flex-col gap-[2.4mm]">
      <BlockHeading title={block.title} aside={aside ? <span className="whitespace-nowrap">{aside}</span> : undefined} />
      <PhotoGrid photos={block.photos} columns={block.columns} aspect={block.aspect} lead={block.lead} />
    </section>
  );
}
