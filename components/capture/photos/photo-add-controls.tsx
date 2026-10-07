"use client";

// How photos get in (BUILD_SPEC 8.1). On the iPad (coarse pointer): "Take
// Photo" opens the rear camera, "Add From Library" picks several at once.
// On a desktop (fine pointer): drop several files, or choose them. Either
// way the files go straight to onFiles; processing and uploading are not
// this component's job, and nothing here waits for them.
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { CameraIcon, ImagePlusIcon, ImagesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PhotoAddControlsProps = {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** Where the photos go, for the drop hint and screen readers: "Dimensions". */
  target?: string;
  /** A one-line drop strip on desktop, for gallery sections. */
  compact?: boolean;
  className?: string;
};

/** Files dragged in from the desktop or another app; links and text are ignored. */
function droppedFiles(event: DragEvent): File[] {
  return Array.from(event.dataTransfer?.files ?? []);
}

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export function PhotoAddControls({ onFiles, disabled = false, target, compact = false, className }: PhotoAddControlsProps) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const take = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Cleared, so choosing the same photo again still fires.
    event.target.value = "";
    if (files.length > 0) onFiles(files);
  };

  const dropHandlers = disabled
    ? {}
    : {
        onDragEnter: (event: DragEvent) => {
          if (!carriesFiles(event)) return;
          event.preventDefault();
          depth.current += 1;
          setDragging(true);
        },
        onDragOver: (event: DragEvent) => {
          if (!carriesFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        },
        onDragLeave: () => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        },
        onDrop: (event: DragEvent) => {
          if (!carriesFiles(event)) return;
          event.preventDefault();
          depth.current = 0;
          setDragging(false);
          const files = droppedFiles(event);
          if (files.length > 0) onFiles(files);
        },
      };

  return (
    <div data-slot="photo-add" data-dragging={dragging || undefined} className={cn("relative", className)} {...dropHandlers}>
      {/* iPad: the camera and the photo library. */}
      <div className="flex flex-wrap items-center gap-2 fine:hidden">
        <Button type="button" variant="outline" disabled={disabled} onClick={() => camera.current?.click()}>
          <CameraIcon aria-hidden />
          Take Photo
        </Button>
        <Button type="button" variant="outline" disabled={disabled} onClick={() => library.current?.click()}>
          <ImagesIcon aria-hidden />
          Add From Library
        </Button>
      </div>

      {/* Desktop: drop several, or choose them. */}
      <div
        className={cn(
          // h-full: fills the room its parent gives it (beside the inspector comment, the comment box's height).
          "hidden h-full items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-card text-sm text-muted-foreground fine:flex",
          "transition-colors data-dragging:border-primary data-dragging:bg-brand-50",
          compact ? "px-3 py-2" : "flex-col justify-center px-4 py-6 text-center",
        )}
        data-dragging={dragging || undefined}
      >
        <ImagePlusIcon aria-hidden className={cn("shrink-0 text-brand-600", compact ? "size-4" : "size-6")} />
        <p className={cn(compact ? "min-w-0 flex-1" : "max-w-xs")}>
          {dragging ? (
            <span className="font-medium text-brand-700">Drop to add {target ? `to ${target}` : "the photos"}</span>
          ) : (
            <>
              Drop photos here, several at once{target ? <span className="sr-only">, to add them to {target}</span> : null},
              or
            </>
          )}
        </p>
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => library.current?.click()}>
          Choose Photos
          {target ? <span className="sr-only"> for {target}</span> : null}
        </Button>
      </div>

      {/* Visually hidden rather than display:none, which older iOS Safari will not open from a script. */}
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        data-photo-input="camera"
        disabled={disabled}
        onChange={take}
      />
      <input
        ref={library}
        type="file"
        accept="image/*"
        multiple
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        data-photo-input="library"
        disabled={disabled}
        onChange={take}
      />
    </div>
  );
}
