// Photos in a grid with their captions (the design's pages 9 to 11, the photo
// records; page 6, the defect photos): rounded tiles of one shape, the first
// optionally spanning two rows and columns as the design's lead photo, each
// caption under its photo. The images are the export's signed links. Rings an
// inspector drew round a defect are drawn over the image in the fail red, in
// an SVG laid on the tile and clipped to it, so a tile keeps its height.
import { coverRings, type PhotoMarker, type PhotoSize } from "@/lib/report/markers";
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
  /** Rings drawn round a defect, in the image's own fractions (lib/schemas/export.ts). */
  markers?: readonly PhotoMarker[];
  /** The image's natural pixels, which place the rings on the tile's crop: without them no ring is drawn. */
  size?: PhotoSize | null;
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
/** Each shape's width over its height. */
const ASPECT_VALUE = { "3/2": 3 / 2, "4/3": 4 / 3, "1/1": 1 } as const;

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
              <Rings markers={photo.markers} size={photo.size} aspect={isLead ? null : ASPECT_VALUE[aspect]} />
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

/** A ring's stroke: the fail red, half a millimetre on paper whatever the tile's size. */
const RING = { fill: "none", stroke: "currentColor", strokeWidth: "0.5mm", vectorEffect: "non-scaling-stroke" } as const;

const SVG_CLASS = "pointer-events-none absolute inset-0 size-full text-fail";

/** Two decimals: enough for a ring on paper, short in the markup. */
const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The rings over a tile. A tile of a fixed shape places each by the cover
 * crop (coverRings: the image scaled to cover the tile and centred), in the
 * tile's own units, 100 tall. The large photo's box takes its rows' height,
 * so its shape is not fixed: its rings are drawn in the image's own pixels
 * and cropped as object-fit: cover crops the image ("slice"). None without
 * the image's size: a ring is never guessed into place.
 */
function Rings({ markers, size, aspect }: { markers?: readonly PhotoMarker[]; size?: PhotoSize | null; aspect: number | null }) {
  if (!markers || markers.length === 0 || !size) return null;
  if (aspect === null) {
    const shorter = Math.min(size.width, size.height);
    return (
      <svg aria-hidden data-slot="report-photo-rings" className={SVG_CLASS} viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="xMidYMid slice">
        {markers.map((marker, index) => (
          <circle key={index} cx={round(marker.x * size.width)} cy={round(marker.y * size.height)} r={round(marker.r * shorter)} {...RING} />
        ))}
      </svg>
    );
  }
  const rings = coverRings(markers, size, aspect);
  if (rings.length === 0) return null;
  return (
    <svg aria-hidden data-slot="report-photo-rings" className={SVG_CLASS} viewBox={`0 0 ${round(aspect * 100)} 100`} preserveAspectRatio="none">
      {rings.map((ring, index) => (
        <circle key={index} cx={round(ring.cx * 100)} cy={round(ring.cy * 100)} r={round(ring.r * 100)} {...RING} />
      ))}
    </svg>
  );
}
