// The photo records (TG35 pages 9 to 11), from their slot
// (lib/report/sections/photos.ts): a page per record, "Photo Record 1 of 3"
// over its title, then each group of photos under its heading with its note
// at the right (where and when, what the labels show, what was tested), in
// the design's grids: the warehouse large beside the sampling, labels four
// across, the packing and watertight photos five across, square. A caption
// naming a defect is bold. The images are the export's signed links, plain
// <img>, so the print route renders them on the server as they are.
//
// Typed by SectionPages, never importing the registry at run time, and the
// primitives from their own files (not ../index, which lists these pages).
import type { ReactNode } from "react";
import type { PhotoBlock } from "@/lib/report/model";
import { PhotoGrid } from "../photo-grid";
import { BlockHeading, SectionHeading } from "../section-heading";
import type { SectionPages, SectionPagesProps } from "./index";

function Pages({ content }: SectionPagesProps<"photos">): ReactNode[] {
  return content.pages.map((page, index) => (
    <div key={`${page.key}-${index}`} data-slot="report-photo-record" data-record={page.key} className="flex flex-col gap-[4.6mm]">
      <SectionHeading kicker={page.kicker} title={page.title} />
      {page.blocks.map((block) => (
        <PhotoBlockView key={block.key} block={block} />
      ))}
    </div>
  ));
}

export const photosPages: SectionPages<"photos"> = { key: "photos", Pages };

function PhotoBlockView({ block }: { block: PhotoBlock }) {
  return (
    <section data-slot="report-photo-block" data-block={block.key} className="flex flex-col gap-[2.4mm]">
      <BlockHeading title={block.title} aside={block.note ?? undefined} />
      <PhotoGrid photos={block.photos} columns={block.columns} aspect={block.aspect} lead={block.lead} />
    </section>
  );
}
