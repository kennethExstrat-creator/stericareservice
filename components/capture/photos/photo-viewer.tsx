"use client";

// A photo full size (BUILD_SPEC 8.1, "Desktop shows full size with arrow-key
// navigation"): the left and right arrow keys, or the buttons beside the
// photo, step through the list it was opened from; Escape closes. Light
// like the rest of the app: the photo sits on a slate-100 well.
import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon, FileWarningIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PhotoUploadState } from "./photo-model";

export interface ViewerPhoto {
  id: string;
  /** What the photo shows: its caption, else its tags. */
  alt: string;
  /** The full photo, else its preview. Null: nothing a browser can show (an unconverted HEIC). Falls back to "No preview" if it does not load. */
  src: string | null;
  /** "Dimensions · Size M · Box 253". */
  tagLine: string;
  caption: string | null;
  takenAt: string | null;
  state: PhotoUploadState;
  flagged: boolean;
}

type PhotoViewerProps = {
  photos: readonly ViewerPhoto[];
  /** The photo on screen; null when closed. */
  openId: string | null;
  onOpenIdChange: (id: string | null) => void;
  /** Edit, Delete and the report choice for the photo on screen. */
  actions?: (photo: ViewerPhoto) => ReactNode;
};

const TAKEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function takenLine(takenAt: string | null): string | null {
  if (!takenAt) return null;
  const date = new Date(takenAt);
  return Number.isNaN(date.getTime()) ? null : `Taken ${TAKEN.format(date)}`;
}

export function PhotoViewer({ photos, openId, onOpenIdChange, actions }: PhotoViewerProps) {
  const index = openId === null ? -1 : photos.findIndex((photo) => photo.id === openId);
  const photo = index >= 0 ? photos[index] : null;
  const count = photos.length;
  // An image the browser could not load or decode (an expired link, a type it cannot read): "No preview", not a broken icon.
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const src = photo?.src && photo.src !== brokenSrc ? photo.src : null;

  const step = (by: number) => {
    if (count === 0 || index < 0) return;
    onOpenIdChange(photos[(index + by + count) % count].id);
  };

  // The neighbours load while this one is looked at, so the arrow keys feel instant.
  useEffect(() => {
    if (index < 0 || count < 2) return;
    for (const neighbour of [photos[(index + 1) % count], photos[(index - 1 + count) % count]]) {
      if (neighbour.src) new Image().src = neighbour.src;
    }
  }, [index, count, photos]);

  return (
    <Dialog
      open={photo !== null}
      onOpenChange={(open) => {
        if (!open) onOpenIdChange(null);
      }}
    >
      {photo && (
        <DialogContent
          data-slot="photo-viewer"
          className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-6xl flex-col gap-4 overflow-y-auto p-4 sm:max-w-6xl md:p-6"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              step(event.key === "ArrowLeft" ? -1 : 1);
            }
          }}
        >
          <DialogHeader className="pr-10">
            <DialogTitle className="text-lg font-bold">{photo.tagLine || "Photo"}</DialogTitle>
            <DialogDescription aria-live="polite">
              Photo {index + 1} of {count}
              {takenLine(photo.takenAt) ? ` · ${takenLine(photo.takenAt)}` : ""}
              {count > 1 ? <span className="hidden fine:inline"> · Left and right arrow keys move between photos</span> : null}
            </DialogDescription>
          </DialogHeader>

          <div className="relative flex min-h-[40dvh] items-center justify-center overflow-hidden rounded-lg bg-slate-100 ring-1 ring-border">
            {src ? (
              // Signed or blob URLs of photos already resized at capture: nothing for next/image to do.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={photo.id}
                src={src}
                alt={photo.alt}
                onError={() => setBrokenSrc(src)}
                className="max-h-[calc(100dvh-16rem)] w-auto max-w-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
                <FileWarningIcon aria-hidden className="size-8 text-warn" />
                <p className="font-medium text-foreground">No preview</p>
                <p className="max-w-sm">
                  {photo.flagged
                    ? "This browser could not convert the photo, so the original was kept. It is converted later."
                    : "The photo could not be shown. Reload the page to try again."}
                </p>
                <span className="sr-only">{photo.alt}</span>
              </div>
            )}
            {count > 1 && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="absolute top-1/2 left-3 -translate-y-1/2 shadow-sm"
                  onClick={() => step(-1)}
                >
                  <ChevronLeftIcon aria-hidden />
                  <span className="sr-only">Previous Photo</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="absolute top-1/2 right-3 -translate-y-1/2 shadow-sm"
                  onClick={() => step(1)}
                >
                  <ChevronRightIcon aria-hidden />
                  <span className="sr-only">Next Photo</span>
                </Button>
              </>
            )}
          </div>

          {(photo.caption || actions) && (
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <p className="min-w-0 flex-1 text-base text-foreground">
                {photo.caption ?? <span className="text-muted-foreground">No caption</span>}
              </p>
              {actions && <div className="flex flex-wrap items-center gap-2">{actions(photo)}</div>}
            </div>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
