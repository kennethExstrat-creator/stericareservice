"use client";

// The defect marking tool (Kenneth, 27 October 2026: "in the preview of the
// photos, add in tools to mark defect (red circle), with the red circle being
// able to drag, inrease and decrease size"): a photo with its red circles
// (lib/schemas/photo-markers.ts) and, for whoever may change the photo, the
// tools. Mark Defect adds a circle in the middle of the photo; a circle is
// dragged to move it, and the handle on its edge dragged to size it; − and +
// size the selected one, and Remove Mark takes it off. Pointer events,
// captured, so a mouse, a trackpad and a finger drag alike and a drag never
// scrolls the page or loses its circle; 44 px targets on any touchscreen, and
// nothing that needs a pinch. Keys: Tab reaches each circle, the arrows move
// it (further with Shift), + and − size it, Delete or Backspace takes it off.
// Read-only (no onMarkersChange), the circles show and there are no tools.
//
// Reusable: it knows nothing of saving. The caller keeps the marks
// (onMarkersChange hears each change: a drag once, when it ends) and shows
// its save state in `status`. Media's preview (Source Documents) uses it; a
// photo dialog elsewhere can take it the same way. The geometry is
// lib/photos/markers.ts.
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { CirclePlusIcon, MinusIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  canGrow,
  canShrink,
  fitImage,
  grownMarker,
  handleSpot,
  markerBox,
  markerKeyChange,
  movedMarker,
  newMarker,
  radiusAt,
  shrunkMarker,
  type HandleCorner,
} from "@/lib/photos/markers";
import { MAX_PHOTO_MARKERS, type PhotoMarker, type PhotoSize } from "@/lib/schemas/photo-markers";
import { cn } from "@/lib/utils";

export type PhotoMarkupProps = {
  /** The photo, as the preview shows it. */
  src: string;
  /** The photo's name ("Photo 3"): its alternative text. */
  alt: string;
  /** The circles, as kept. */
  markers: readonly PhotoMarker[];
  /**
   * Each change, with the image's natural size once it has loaded (a photo
   * stored without one keeps it with its marks). Without it the marks are
   * read-only: no tools.
   */
  onMarkersChange?: (markers: PhotoMarker[], naturalSize: PhotoSize | null) => void;
  /** The photo's stored size: the circles are placed before the image has loaded. */
  size?: PhotoSize | null;
  /** Shown at the end of the tools: the save state. */
  status?: ReactNode;
  className?: string;
};

/** A press that moves less than this is a tap, not a drag. */
const DRAG_SLOP_PX = 4;

/** Greyed but focusable at a limit (docs/DESIGN.md, Stepper). */
const AT_LIMIT =
  "aria-disabled:cursor-not-allowed aria-disabled:text-slate-400 aria-disabled:hover:border-input aria-disabled:hover:bg-card aria-disabled:hover:text-slate-400";

/** A circle: the app's fail red, stroke only. */
const CIRCLE = "absolute rounded-full border-[3px] border-fail";

const HANDLE_CURSOR: Record<HandleCorner, string> = {
  "bottom-right": "cursor-nwse-resize",
  "top-left": "cursor-nwse-resize",
  "bottom-left": "cursor-nesw-resize",
  "top-right": "cursor-nesw-resize",
};

type Drag = {
  kind: "move" | "resize";
  index: number;
  pointerId: number;
  /** The image's box on screen when the drag began, and the image's width over its height. */
  area: DOMRect;
  aspect: number;
  /** Where the pointer went down, in fractions of the image. */
  start: { x: number; y: number };
  origin: PhotoMarker;
  moved: boolean;
};

export function PhotoMarkup({ src, alt, markers, onMarkersChange, size = null, status, className }: PhotoMarkupProps) {
  const editable = onMarkersChange !== undefined;
  const hintId = useId();
  const frame = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const circles = useRef<(HTMLButtonElement | null)[]>([]);
  const frameSize = useBoxSize(frame);
  const [natural, setNatural] = useState<PhotoSize | null>(null);
  const shape = natural ?? size;
  const fitted = shape && frameSize ? fitImage(shape, frameSize) : null;
  const aspect = shape ? shape.width / shape.height : 1;

  const [selected, setSelected] = useState<number | null>(null);
  // The circle being dragged, where the pointer has it; kept on change only once the drag ends.
  const [draft, setDraft] = useState<{ index: number; marker: PhotoMarker } | null>(null);
  const drag = useRef<Drag | null>(null);
  const shown = draft && draft.index < markers.length ? markers.map((marker, index) => (index === draft.index ? draft.marker : marker)) : markers;
  const selectedIndex = selected !== null && selected < shown.length ? selected : null;
  const selectedMarker = selectedIndex === null ? null : shown[selectedIndex];

  // Where the focus goes after the circles change: a new circle, the next one after a removal, or Mark Defect.
  const pendingFocus = useRef<number | "add" | null>(null);
  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    const node = target === "add" ? addButton.current : circles.current[target];
    if (!node) return;
    pendingFocus.current = null;
    node.focus();
  });

  const commit = (next: PhotoMarker[]) => onMarkersChange?.(next, natural ?? size);
  const replaced = (index: number, marker: PhotoMarker) => markers.map((current, at) => (at === index ? marker : current));

  const add = () => {
    const marker = newMarker(markers);
    if (!marker) return;
    const next = [...markers, marker];
    commit(next);
    setSelected(next.length - 1);
    pendingFocus.current = next.length - 1;
  };

  const resize = (grow: boolean) => {
    if (selectedIndex === null) return;
    const marker = markers[selectedIndex];
    if (grow ? !canGrow(marker) : !canShrink(marker)) return;
    commit(replaced(selectedIndex, grow ? grownMarker(marker) : shrunkMarker(marker)));
  };

  const remove = (index: number, by: "key" | "button") => {
    const next = markers.filter((_, at) => at !== index);
    commit(next);
    setSelected(null);
    // From the keyboard, on to the circle in its place (or the one before); else back to Mark Defect.
    pendingFocus.current = by === "key" && next.length > 0 ? Math.min(index, next.length - 1) : "add";
  };

  /* -------------------------------------------------------------- *
   * Dragging: a circle moves, its handle sizes it
   * -------------------------------------------------------------- */

  const pointIn = (area: DOMRect, event: ReactPointerEvent<HTMLElement>) => ({
    x: (event.clientX - area.left) / area.width,
    y: (event.clientY - area.top) / area.height,
  });

  /** The dragged circle where the pointer has it; null while the press has not moved far enough to be a drag. */
  const dragged = (current: Drag, event: ReactPointerEvent<HTMLElement>): PhotoMarker | null => {
    const point = pointIn(current.area, event);
    const dx = point.x - current.start.x;
    const dy = point.y - current.start.y;
    if (!current.moved && Math.hypot(dx * current.area.width, dy * current.area.height) < DRAG_SLOP_PX) return null;
    current.moved = true;
    return current.kind === "move" ? movedMarker(current.origin, dx, dy) : { ...current.origin, r: radiusAt(current.origin, point, current.aspect) };
  };

  const startDrag = (event: ReactPointerEvent<HTMLElement>, kind: Drag["kind"], index: number) => {
    if (!editable || (event.pointerType === "mouse" && event.button !== 0)) return;
    const area = overlay.current?.getBoundingClientRect();
    if (!area || area.width === 0 || area.height === 0) return;
    try {
      // Every move and the release come here, wherever the pointer goes.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser no longer tracks: the drag still follows it over the circle.
    }
    drag.current = { kind, index, pointerId: event.pointerId, area, aspect, start: pointIn(area, event), origin: markers[index], moved: false };
    setSelected(index);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const marker = dragged(current, event);
    if (marker) setDraft({ index: current.index, marker });
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    const marker = dragged(current, event);
    setDraft(null);
    if (current.moved && marker) commit(replaced(current.index, marker));
  };

  const cancelDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDraft(null);
  };

  const dragHandlers = { onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: cancelDrag };

  const onCircleKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const change = markerKeyChange(markers[index], event.key, event.shiftKey);
    if (change === null) return;
    event.preventDefault();
    if (change === "remove") remove(index, "key");
    else commit(replaced(index, change));
  };

  const full = markers.length >= MAX_PHOTO_MARKERS;
  const boxStyle = (marker: PhotoMarker): CSSProperties => {
    const box = markerBox(marker, aspect);
    return { left: `${box.left * 100}%`, top: `${box.top * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` };
  };
  const handle = selectedMarker ? handleSpot(selectedMarker, aspect) : null;
  const count = markers.length;

  return (
    <div data-slot="photo-markup" className={cn("flex min-h-0 flex-1 flex-col gap-3", className)}>
      {editable && (
        <div role="group" aria-label="Defect Marks" data-slot="photo-markup-tools" className="flex flex-wrap items-center gap-2">
          <Button
            ref={addButton}
            type="button"
            variant="outline"
            size="sm"
            aria-disabled={full || undefined}
            title={full ? `At most ${MAX_PHOTO_MARKERS} marks on one photo` : undefined}
            className={cn("touch:text-base", AT_LIMIT)}
            onClick={() => !full && add()}
          >
            <CirclePlusIcon aria-hidden className="text-fail" />
            Mark Defect
          </Button>
          {selectedMarker && selectedIndex !== null && (
            <>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-disabled={!canShrink(selectedMarker) || undefined}
                  className={AT_LIMIT}
                  onClick={() => resize(false)}
                >
                  <MinusIcon aria-hidden />
                  <span className="sr-only">Make Mark Smaller</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-disabled={!canGrow(selectedMarker) || undefined}
                  className={AT_LIMIT}
                  onClick={() => resize(true)}
                >
                  <PlusIcon aria-hidden />
                  <span className="sr-only">Make Mark Larger</span>
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-fail-tint hover:text-destructive touch:text-base"
                onClick={() => remove(selectedIndex, "button")}
              >
                <Trash2Icon aria-hidden />
                Remove Mark
              </Button>
            </>
          )}
          {status && <div className="ml-auto flex items-center">{status}</div>}
        </div>
      )}
      <div
        ref={frame}
        data-slot="photo-markup-frame"
        className="relative min-h-0 flex-1 overflow-hidden rounded-lg bg-muted ring-1 ring-border"
        onPointerDown={(event) => {
          // A press beside the circles lets the selected one go.
          if (!(event.target as Element).closest('[data-slot="photo-marker"], [data-slot="photo-marker-handle"]')) setSelected(null);
        }}
      >
        {/* The photo's own box, placed as object-fit: contain would: the circles are fractions of it. */}
        <div
          className="absolute"
          style={fitted ? { left: fitted.left, top: fitted.top, width: fitted.width, height: fitted.height } : { inset: 0 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a signed link to a private photo: not for next/image */}
          <img
            src={src}
            alt={alt}
            draggable={false}
            className="size-full object-contain select-none"
            onLoad={(event) => {
              const image = event.currentTarget;
              if (image.naturalWidth > 0 && image.naturalHeight > 0) setNatural({ width: image.naturalWidth, height: image.naturalHeight });
            }}
          />
          {fitted && (
            <div ref={overlay} data-slot="photo-markers" className="absolute inset-0 select-none">
              {shown.map((marker, index) =>
                editable ? (
                  <button
                    // A circle is its place in the list: the list only grows at its end and loses one at a time.
                    key={index}
                    ref={(node) => {
                      circles.current[index] = node;
                    }}
                    type="button"
                    data-slot="photo-marker"
                    data-selected={index === selectedIndex || undefined}
                    aria-label={`Defect Mark ${index + 1}`}
                    aria-pressed={index === selectedIndex}
                    aria-describedby={hintId}
                    className={cn(
                      CIRCLE,
                      // touch-none: a finger drags the circle, never the page. On a touchscreen a small circle still takes a 44 px press.
                      "cursor-move touch-none outline-none focus-ring",
                      "touch:after:absolute touch:after:top-1/2 touch:after:left-1/2 touch:after:size-11 touch:after:-translate-x-1/2 touch:after:-translate-y-1/2 touch:after:rounded-full",
                      index === selectedIndex && "border-4 ring-2 ring-white",
                    )}
                    style={boxStyle(marker)}
                    onPointerDown={(event) => startDrag(event, "move", index)}
                    {...dragHandlers}
                    onFocus={() => setSelected(index)}
                    onKeyDown={(event) => onCircleKey(event, index)}
                  />
                ) : (
                  <span key={index} aria-hidden data-slot="photo-marker" className={CIRCLE} style={boxStyle(marker)} />
                ),
              )}
              {editable && handle && selectedIndex !== null && (
                <span
                  aria-hidden
                  data-slot="photo-marker-handle"
                  className={cn(
                    // 16 px (22 on touch) with its border; an invisible ring around it makes the press 32 px (44 px on touch).
                    "absolute size-4 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-fail bg-white shadow-sm after:absolute after:-inset-2.5 after:rounded-full touch:size-[22px] touch:after:-inset-[13px]",
                    HANDLE_CURSOR[handle.corner],
                  )}
                  style={{ left: `${handle.x * 100}%`, top: `${handle.y * 100}%` }}
                  onPointerDown={(event) => startDrag(event, "resize", selectedIndex)}
                  {...dragHandlers}
                />
              )}
            </div>
          )}
        </div>
        {editable && (
          <p id={hintId} className="sr-only">
            The arrow keys move a mark, plus and minus size it, and Delete removes it.
          </p>
        )}
        {count > 0 && (
          <p className="sr-only">
            {count === 1 ? "1 defect mark" : `${count} defect marks`}
          </p>
        )}
      </div>
    </div>
  );
}

/** An element's laid-out size in CSS pixels (untransformed: a dialog's opening zoom does not count), kept as it changes. */
function useBoxSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } | null {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const width = node.clientWidth;
      const height = node.clientHeight;
      setBox((current) => (current && current.width === width && current.height === height ? current : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return box;
}
