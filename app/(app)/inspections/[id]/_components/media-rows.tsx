"use client";

// The rows of Source Documents' Media (source-media.tsx), as the Files side
// lists its documents: a grip that drags the row to another category (or,
// pressed without moving, opens its Move To menu: WCAG 2.5.7, a way without
// dragging), a thumbnail, the name, and Preview, Download and Delete.
import { memo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import {
  DownloadIcon,
  EyeIcon,
  GripVerticalIcon,
  ImageIcon,
  PlayIcon,
  RotateCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { downloadUrl } from "@/components/capture/files/file-preview-dialog";
import { photoQueueStore } from "@/components/capture/photos/queue-store";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { MEDIA_SECTIONS, type MediaItem, type MediaSectionId } from "./media-board";
import type { MediaDrag } from "./use-media-drag";

/** The upload state, in the file rows' words. */
function stateText(item: MediaItem): string {
  switch (item.state) {
    case "uploaded":
      return "Uploaded";
    case "uploading":
      return `Uploading ${Math.round(item.progress * 100)}%`;
    case "failed":
      return "Upload Stopped";
    case "waiting":
      return "Waiting to Upload";
  }
}

/** What a row asks of the board. Stable, so a row redraws only when its own item changes. */
export type RowActions = {
  onPreview: (item: MediaItem) => void;
  onDelete: (item: MediaItem) => void;
  /** From the Move To menu. */
  onMove: (item: MediaItem, to: MediaSectionId) => void;
  /** pointerdown on the grip: a drag, or a click. */
  onPress: (item: MediaItem, event: ReactPointerEvent<HTMLElement>) => void;
  /** True while the grip's click ends a drag: no menu then. */
  endedDrag: () => boolean;
};

export const MediaRow = memo(function MediaRow({
  item,
  grip,
  canDelete,
  dragging,
  actions,
}: {
  item: MediaItem;
  /** move: drags, or opens Move To. wait: it cannot move yet (still uploading). none: a read-only screen. */
  grip: "move" | "wait" | "none";
  canDelete: boolean;
  /** This row's ghost is following the pointer. */
  dragging: boolean;
  actions: RowActions;
}) {
  return (
    <li
      data-slot="media-row"
      data-media-key={item.key}
      data-upload-state={item.state}
      data-dragging={dragging || undefined}
      // relative: anchors the buttons' sr-only names (docs/DESIGN.md).
      className="relative flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 transition-opacity data-dragging:opacity-40"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {grip !== "none" && <MoveGrip item={item} disabled={grip === "wait"} actions={actions} />}
        <MediaThumb item={item} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <p className="min-w-0 truncate font-medium text-foreground" title={item.name}>
              {item.name}
            </p>
            {item.tagLine && <p className="text-sm text-muted-foreground">{item.tagLine}</p>}
          </div>
          {item.state !== "uploaded" && <p className="text-sm text-muted-foreground">{stateText(item)}</p>}
          {item.state === "failed" && item.error && (
            <p className="mt-1 flex items-start gap-1.5 text-sm text-fail">
              <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              {item.error}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {item.url && (
          <>
            <Button type="button" variant="ghost" size="icon" title="Preview" onClick={() => actions.onPreview(item)}>
              <EyeIcon aria-hidden />
              <span className="sr-only">Preview {item.name}</span>
            </Button>
            <Button asChild variant="ghost" size="icon" title="Download">
              <a href={downloadUrl(item.url, item.downloadName)} download={item.downloadName}>
                <DownloadIcon aria-hidden />
                <span className="sr-only">Download {item.name}</span>
              </a>
            </Button>
          </>
        )}
        {item.state === "failed" && (
          <Button type="button" variant="ghost" size="sm" onClick={() => photoQueueStore.retryNow(item.id)}>
            <RotateCwIcon aria-hidden />
            Try Again<span className="sr-only">: {item.name}</span>
          </Button>
        )}
        {canDelete && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title={item.queued ? "Remove" : "Delete"}
            className="text-destructive hover:bg-fail-tint hover:text-destructive"
            onClick={() => actions.onDelete(item)}
          >
            <Trash2Icon aria-hidden />
            <span className="sr-only">
              {item.queued ? "Remove" : "Delete"} {item.name}
            </span>
          </Button>
        )}
      </div>
    </li>
  );
});

/**
 * The row's grip. Dragged, it moves the row (use-media-drag.ts); clicked,
 * or Enter pressed on it, it opens Move To, which names the four categories
 * and Other, the row's own checked.
 */
function MoveGrip({ item, disabled, actions }: { item: MediaItem; disabled: boolean; actions: RowActions }) {
  const [open, setOpen] = useState(false);
  // A press on the grip of an open menu closes it (the press dismissed it before the click came).
  const openAtPress = useRef(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title={disabled ? undefined : "Move"}
          data-media-grip=""
          // touch-none: a finger on the grip drags the row instead of scrolling the page.
          className="-ml-1.5 shrink-0 cursor-grab touch-none text-muted-foreground"
          onPointerDown={(event) => {
            openAtPress.current = open;
            actions.onPress(item, event);
          }}
          onClick={(event) => {
            if (actions.endedDrag()) return;
            // A click from the keyboard (detail 0) always opens.
            setOpen(event.detail === 0 || !openAtPress.current);
            openAtPress.current = false;
          }}
        >
          <GripVerticalIcon aria-hidden />
          <span className="sr-only">Move {item.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto min-w-56">
        <DropdownMenuLabel>Move To</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={item.section} onValueChange={(value) => actions.onMove(item, value as MediaSectionId)}>
          {MEDIA_SECTIONS.map((section) => (
            <DropdownMenuRadioItem key={section.id} value={section.id}>
              {section.title}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A photo's thumbnail; a video's play mark. The name beside it says what it is, so it is not read out. */
function MediaThumb({ item }: { item: MediaItem }) {
  const box = "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md ring-1 ring-border touch:size-11";
  if (item.kind === "video") {
    return (
      <span className={cn(box, "bg-slate-100 text-slate-600")}>
        <PlayIcon aria-hidden className="size-4 fill-current" />
      </span>
    );
  }
  if (item.thumbUrl) {
    // Not draggable: a dragged image would read as a file dropped on a category.
    // eslint-disable-next-line @next/next/no-img-element -- a signed or local link to a small thumbnail: nothing for next/image to do
    return <img src={item.thumbUrl} alt="" draggable={false} loading="lazy" decoding="async" className={cn(box, "bg-muted object-cover")} />;
  }
  // Undefined: its preview is still being read from this device; blank until then.
  return <span className={cn(box, "bg-muted text-muted-foreground")}>{item.thumbUrl === null && <ImageIcon aria-hidden className="size-4" />}</span>;
}

/** The row under the pointer while it is dragged; the hook moves it (use-media-drag.ts). */
export function DragGhost({ drag, ghostRef }: { drag: MediaDrag; ghostRef: (node: HTMLElement | null) => void }) {
  return createPortal(
    <div
      ref={ghostRef}
      aria-hidden
      data-slot="media-drag-ghost"
      className="pointer-events-none fixed top-0 left-0 z-50 flex items-center gap-3 rounded-lg bg-card px-3 py-2.5 shadow-lg ring-2 ring-primary"
      style={{ width: Math.min(drag.width, 448) }}
    >
      <GripVerticalIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <MediaThumb item={drag.item} />
      <p className="min-w-0 flex-1 truncate font-medium text-foreground">{drag.item.name}</p>
    </div>,
    document.body,
  );
}
