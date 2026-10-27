// Photos in a grid with their captions (the design's pages 9 to 11, the photo
// records; page 6, the defect photos): rounded tiles of one shape, the first
// optionally spanning two rows and columns as the design's lead photo, each
// caption under its photo. The images are the export's signed links.
import { cn } from "@/lib/utils";
import { TYPE } from "./theme";

export type GridPhoto = {
  id: string;
  url: string;
  caption?: string | null;
  /** What a screen reader hears; the caption, else "Photo". */
  alt?: string;
  /** This photo's caption in bold, or not, whatever `strongCaptions` says: a defect named among other photos (TG35 pages 10 and 11). */
  strong?: boolean;
};

export type PhotoGridProps = {
  photos: readonly GridPhoto[];
  columns?: 2 | 3 | 4 | 5;
  /** The tiles' shape: 3/2 for the photo records' sampling and labels (TG35 page 9). */
  aspect?: "3/2" | "4/3" | "1/1";
  /** The first photo over two rows and two columns. */
  lead?: boolean;
  /** Captions in bold: a defect named ("Pinhole, palm"). */
  strongCaptions?: boolean;
  className?: string;
};

const COLUMNS_CLASS = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4", 5: "grid-cols-5" } as const;
const ASPECT_CLASS = { "3/2": "aspect-[3/2]", "4/3": "aspect-[4/3]", "1/1": "aspect-square" } as const;

export function PhotoGrid({ photos, columns = 4, aspect = "4/3", lead = false, strongCaptions = false, className }: PhotoGridProps) {
  return (
    <ul data-slot="report-photo-grid" className={cn("grid gap-x-[3mm] gap-y-[2.4mm]", COLUMNS_CLASS[columns], className)}>
      {photos.map((photo, index) => {
        const isLead = lead && index === 0 && photos.length > 1;
        return (
          <li key={photo.id} data-photo={photo.id} className={cn("flex min-w-0 flex-col gap-[1.4mm]", isLead && "col-span-2 row-span-2")}>
            <div className={cn("relative overflow-hidden rounded-[2mm] bg-slate-100", isLead ? "flex-1" : ASPECT_CLASS[aspect])}>
              {/* Signed links to photos already resized at capture: nothing for next/image to do, and printed as they are. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt={photo.alt ?? photo.caption ?? "Photo"} className="absolute inset-0 size-full object-cover" />
            </div>
            {photo.caption && !isLead && (
              <p className={cn("text-slate-900", (photo.strong ?? strongCaptions) ? "font-semibold" : "text-slate-600", TYPE.small)}>{photo.caption}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
