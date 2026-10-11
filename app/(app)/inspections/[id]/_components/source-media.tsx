"use client";

// Source Documents' Media (Kenneth, 11 and 12 October 2026): the photos and
// videos the inspector took on the visit, in four categories (MEDIA_CATEGORIES
// in lib/inspections/source-documents.ts) and Other. A category lists its
// photos and videos as rows, as the Files side lists documents
// (media-rows.tsx): Preview, Download and Delete; with nothing yet it is one
// row: its title, an "i" that shows what goes there (Kenneth, 12 October
// 2026: no explanation line), its count, and Add. Files dropped on a
// category go in by their type. A row's grip drags it into another category,
// or opens its Move To menu (use-media-drag.ts); the row moves at once, and
// goes back with a message if the move is refused. Other, always listed last
// (Kenneth, 12 October 2026), holds what Steri-AI could not place and what is in
// no category (untagged photos, a step's from before the categories, the
// first Media tab's videos); photos and videos can be added there too.
// Auto-Sort, at the top, uploads a heap of photos and videos into Other and
// has Steri-AI sort them (auto-sort.ts). Files dropped on a section come in
// through useFileDrop (../../_components/use-file-drop.ts).
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { ImagePlusIcon, InfoIcon, LoaderCircleIcon, PlusIcon, SparklesIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { FileDeleteDialog } from "@/components/capture/files/file-delete-dialog";
import { FilePreviewDialog } from "@/components/capture/files/file-preview-dialog";
import { MediaLoadFailure, UploadNotices, useAddPhotos, useInspectionMedia, usePhotoQueue } from "@/components/capture/photos";
import { mediaStore } from "@/components/capture/photos/media-store";
import { PhotoDeleteDialog } from "@/components/capture/photos/photo-delete-dialog";
import { slotFiles, slotPhotos } from "@/components/capture/photos/photo-model";
import { moduleSlotKey, NOTHING_PREPARING, type PreparingCount } from "@/components/capture/photos/queue-state";
import { photoQueueStore } from "@/components/capture/photos/queue-store";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { countPhotos, countVideos, EMPTY_TAG_OPTIONS } from "@/lib/inspections/photos/view";
import { MEDIA_CATEGORIES, mediaKind, SOURCE_MEDIA_KEY, type MediaCategory } from "@/lib/inspections/source-documents";
import { cn } from "@/lib/utils";
import { useFileDrop } from "../../_components/use-file-drop";
import { moveMedia, type MoveMediaResult } from "../media-actions";
import { autoSort, isSorting, moveByHand, useAutoSort, type AutoSortView } from "./auto-sort";
import {
  categoryOf,
  mediaItems,
  moduleKeyFor,
  NOT_MEDIA,
  OTHER_HINT,
  OTHER_TITLE,
  placeItems,
  sectionTitle,
  withMove,
  withoutMove,
  type Box,
  type MediaItem,
  type MediaSectionId,
  type PendingMoves,
} from "./media-board";
import { DragGhost, MediaRow, type RowActions } from "./media-rows";
import { unreachable } from "./unreachable";
import { useMediaDrag } from "./use-media-drag";

/** What Media's pickers offer: photos and videos together. */
const MEDIA_ACCEPT = "image/*,video/*";

/** "2 photos · 1 video". */
function mediaCountLine(items: readonly MediaItem[]): string {
  const photos = items.filter((item) => item.kind === "photo").length;
  return `${countPhotos(photos)} · ${countVideos(items.length - photos)}`;
}

/** "2 photos and 1 video": what is being made ready for upload. */
function preparingLine({ photos, files }: PreparingCount): string {
  return [photos > 0 && countPhotos(photos), files > 0 && countVideos(files)].filter(Boolean).join(" and ");
}

/**
 * A section of Media: a category, or Other. Its padding reaches into the
 * card's, so a section a file or a row is dragged over can show it round
 * its text.
 */
const SECTION = cn(
  "relative flex min-w-0 flex-col gap-3 p-3 transition-colors",
  "data-dragging:rounded-lg data-dragging:bg-brand-50 data-dragging:outline-2 data-dragging:-outline-offset-2 data-dragging:outline-dashed data-dragging:outline-primary",
);

/**
 * Moves a photo or video: a photo still on this device in the upload queue
 * (offline too), anything else on the server, and then this page's copy.
 * A call that never got an answer comes back as a message, never a throw.
 */
async function moveItem(inspectionId: string, item: MediaItem, to: MediaSectionId): Promise<MoveMediaResult> {
  const category = categoryOf(to);
  try {
    // False once it has left the queue: its row is in, so the server moves it.
    if (item.kind === "photo" && item.queued && (await photoQueueStore.retag(item.id, { tag: { moduleKey: category, target: {} } }))) {
      return { ok: true };
    }
    const result = await moveMedia(inspectionId, { kind: item.kind, id: item.id }, category);
    if (result.ok) mediaStore(inspectionId).applyModuleKey(item.kind === "photo" ? "photo" : "file", item.id, moduleKeyFor(item.kind, to));
    return result;
  } catch (error) {
    return { ok: false, error: unreachable(error).message };
  }
}

type SourceMediaProps = {
  inspectionId: string;
  /** The screen's read-only state (approved, or not the user's): nothing to add, move or delete. */
  readOnly: boolean;
};

export function SourceMedia({ inspectionId, readOnly }: SourceMediaProps) {
  const baseId = useId();
  const media = useInspectionMedia(inspectionId);
  const queue = usePhotoQueue();
  const options = media.media?.options ?? EMPTY_TAG_OPTIONS;
  // Every photo and file of the inspection, uploaded or on this device; the board keeps the media.
  const photos = useMemo(
    () => slotPhotos({ media: media.media, queue, inspectionId, moduleKey: undefined }),
    [media.media, queue, inspectionId],
  );
  const files = useMemo(
    () => slotFiles({ files: media.media?.files ?? [], queue, inspectionId, moduleKey: undefined }),
    [media.media, queue, inspectionId],
  );
  const items = useMemo(
    () =>
      mediaItems({
        photos,
        files,
        options,
        photoPaths: new Map((media.media?.photos ?? []).map((photo) => [photo.id, photo.storagePath] as const)),
        readFiles: new Set((media.media?.files ?? []).map((file) => file.id)),
      }),
    [photos, files, options, media.media],
  );
  const [moves, setMoves] = useState<PendingMoves>({});
  const placed = useMemo(() => placeItems(items, moves), [items, moves]);

  // Photos kept from an earlier page have no preview in memory yet: read it from the device.
  useEffect(() => {
    for (const photo of photos) if (photo.queued && photo.thumbUrl === undefined) photoQueueStore.loadPreview(photo.id);
  }, [photos]);

  const access = media.media?.access ?? null;
  // As FileSlot decides: adding works offline and before the media has loaded (it queues); it stops
  // only when the screen is read-only, the database said no, or the queue cannot run on this device.
  const canAdd = !readOnly && queue.phase !== "unavailable" && media.status !== "not_found" && (access === null || access.canEdit);
  const canEditUploaded = !readOnly && access?.canEdit === true;
  const loading = media.status === "idle" || media.status === "loading";
  const headingId = useCallback((section: MediaSectionId) => `${baseId}-${section}`, [baseId]);

  /* -------------------------------------------------------------- *
   * Moving
   * -------------------------------------------------------------- */

  const ticket = useRef(0);
  const [announcement, setAnnouncement] = useState("");
  // A row moved from its menu is drawn in another section: its grip there takes the focus, and
  // again where it was if the move is refused.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const move = useCallback(
    async (item: MediaItem, to: MediaSectionId, fromMenu = false) => {
      if (item.section === to) return;
      const mine = ++ticket.current;
      setMoves((current) => withMove(current, item.key, to, mine));
      if (fromMenu) setFocusKey(item.key);
      const done = moveByHand(item.key);
      const result = await moveItem(inspectionId, item, to);
      done();
      setMoves((current) => withoutMove(current, item.key, mine));
      if (result.ok) {
        setAnnouncement(`${item.name} moved to ${sectionTitle(to)}.`);
        return;
      }
      toast.error(`${item.name} was not moved`, { description: result.error });
      if (fromMenu) setFocusKey(item.key);
    },
    [inspectionId],
  );

  useEffect(() => {
    if (focusKey === null) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-media-key="${focusKey}"] [data-media-grip]`)?.focus();
      setFocusKey(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusKey, placed]);

  // Where each section is on screen, read as the pointer moves: the page scrolls and sections grow under a drag.
  const board = useRef<HTMLDivElement>(null);
  const boxes = useCallback(
    (): [MediaSectionId, Box][] =>
      Array.from(board.current?.querySelectorAll<HTMLElement>('[data-slot="media-category"]') ?? [], (node) => [
        node.dataset.category as MediaSectionId,
        node.getBoundingClientRect(),
      ]),
    [],
  );
  const onDrop = useCallback((item: MediaItem, to: MediaSectionId) => void move(item, to), [move]);
  const { drag, ghost, press, endedDrag } = useMediaDrag({ boxes, onDrop });

  /* -------------------------------------------------------------- *
   * Preview and delete
   * -------------------------------------------------------------- */

  const [previewing, setPreviewing] = useState<MediaItem | null>(null);
  const [deleting, setDeleting] = useState<MediaItem | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeDelete = () => {
    const section = deleting?.section ?? "other";
    setDeleting(null);
    requestAnimationFrame(() => {
      // The row and its button are gone after a delete: its section's heading takes the focus.
      const target = returnFocus.current;
      returnFocus.current = null;
      if (target?.isConnected) target.focus();
      else document.getElementById(headingId(section))?.focus();
    });
  };

  const actions = useMemo<RowActions>(
    () => ({
      onPreview: setPreviewing,
      onDelete: (item) => {
        returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setDeleting(item);
      },
      onMove: (item, to) => void move(item, to, true),
      onPress: press,
      endedDrag,
    }),
    [move, press, endedDrag],
  );

  const sections = [
    ...MEDIA_CATEGORIES.map((category) => ({ id: category.key, category })),
    { id: "other" as const, category: null },
  ].map(({ id, category }) => ({ id, category, items: placed.filter((item) => item.section === id) }));
  const otherPreparing = {
    photos: queue.preparingByModule[moduleSlotKey(inspectionId, null)]?.photos ?? 0,
    files: queue.preparingByModule[moduleSlotKey(inspectionId, SOURCE_MEDIA_KEY)]?.files ?? 0,
  };

  return (
    <div data-slot="source-media" className="relative flex flex-col gap-4">
      {canAdd && <AutoSortBox inspectionId={inspectionId} />}
      <UploadNotices inspectionId={inspectionId} />
      {media.status === "error" && <MediaLoadFailure inspectionId={inspectionId} />}
      {/* -m-3: the sections' own padding reaches into the card's, so the text lines up with the card's edge. */}
      <div ref={board} className="-m-3 flex flex-col divide-y divide-border">
        {sections.map(({ id, category, items: listed }) => {
          const preparing = category
            ? (queue.preparingByModule[moduleSlotKey(inspectionId, category.key)] ?? NOTHING_PREPARING)
            : otherPreparing;
          return (
            <MediaSection
              key={id}
              inspectionId={inspectionId}
              id={id}
              category={category}
              headingId={headingId(id)}
              items={listed}
              loading={loading}
              canAdd={canAdd}
              canEditUploaded={canEditUploaded}
              preparing={preparing}
              dropTarget={drag !== null && drag.over === id && drag.item.section !== id}
              draggingKey={drag?.item.key ?? null}
              actions={actions}
            />
          );
        })}
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {drag && <DragGhost drag={drag} ghostRef={ghost} />}
      <FilePreviewDialog
        file={
          previewing?.url
            ? {
                name: previewing.name,
                url: previewing.url,
                kind: previewing.kind === "photo" ? "image" : "video",
                downloadName: previewing.downloadName,
              }
            : null
        }
        onClose={() => setPreviewing(null)}
      />
      {deleting?.photo && (
        <PhotoDeleteDialog inspectionId={inspectionId} photo={deleting.photo} alt={deleting.name} onClose={closeDelete} />
      )}
      {deleting?.file && <FileDeleteDialog inspectionId={inspectionId} file={deleting.file} onClose={closeDelete} />}
    </div>
  );
}

function MediaSection({
  inspectionId,
  id,
  category,
  headingId,
  items,
  loading,
  canAdd,
  canEditUploaded,
  preparing,
  dropTarget,
  draggingKey,
  actions,
}: {
  inspectionId: string;
  id: MediaSectionId;
  /** Null for Other. */
  category: MediaCategory | null;
  headingId: string;
  items: readonly MediaItem[];
  loading: boolean;
  canAdd: boolean;
  canEditUploaded: boolean;
  preparing: PreparingCount;
  /** A row dragged from another section is over this one. */
  dropTarget: boolean;
  draggingKey: string | null;
  actions: RowActions;
}) {
  const title = category?.title ?? OTHER_TITLE;
  const addPhotos = useAddPhotos({ inspectionId, moduleKey: category?.key ?? null, focus: null });
  const add = useCallback(
    (files: readonly File[]) => {
      const photos: File[] = [];
      const videos: File[] = [];
      for (const file of files) {
        const kind = mediaKind(file);
        if (kind === "photo") photos.push(file);
        else if (kind === "video") videos.push(file);
        else toast.error(`${file.name || "The file"} was not added`, { description: NOT_MEDIA });
      }
      if (photos.length > 0) addPhotos(photos);
      // Other's videos keep the first Media tab's key.
      if (videos.length > 0) void photoQueueStore.addFiles({ inspectionId, moduleKey: category?.key ?? SOURCE_MEDIA_KEY, kind: "other", files: videos });
    },
    [addPhotos, category, inspectionId],
  );
  const drop = useFileDrop(add, canAdd);
  const preparingCount = preparing.photos + preparing.files;
  // While something is dragged over: where it goes, in the count's place, so the section keeps its height.
  const notice = drop.dragging ? `Drop to add to ${title}` : dropTarget ? `Drop to move to ${title}` : null;
  // Rows move between sections: a grip on each wherever anything can move, waiting on those that cannot yet.
  const movable = canAdd || canEditUploaded;

  return (
    <section
      aria-labelledby={headingId}
      data-slot="media-category"
      data-category={id}
      data-dragging={drop.dragging || dropTarget || undefined}
      className={SECTION}
      {...drop.handlers}
    >
      <SectionHeader
        id={headingId}
        title={title}
        info={category?.hint ?? OTHER_HINT}
        notice={notice}
        count={loading && items.length === 0 ? "Loading…" : mediaCountLine(items)}
      >
        {canAdd && <MediaAddButton title={title} onFiles={add} />}
      </SectionHeader>
      {items.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-lg bg-card ring-1 ring-border">
          {items.map((item) => {
            const editable = item.queued ? canAdd : canEditUploaded;
            return (
              <MediaRow
                key={item.key}
                item={item}
                grip={!movable ? "none" : editable && item.movable ? "move" : "wait"}
                canDelete={editable || item.state === "failed"}
                dragging={item.key === draggingKey}
                actions={actions}
              />
            );
          })}
        </ul>
      )}
      {preparingCount > 0 && (
        <p role="status" className="flex items-center gap-2 text-sm text-brand-700">
          <LoaderCircleIcon aria-hidden className="size-4 animate-spin" />
          Preparing {preparingLine(preparing)}…
        </p>
      )}
    </section>
  );
}

/**
 * A section's one row: the title and its "i" (what goes there, in a popover
 * a tap opens on the iPad as well as a click); at the end, the count then
 * Add, so every section's count lines up (Kenneth, 12 October 2026).
 */
function SectionHeader({
  id,
  title,
  info,
  notice,
  count,
  children,
}: {
  id: string;
  title: string;
  info: string;
  /** Shown in the count's place while something is dragged over. */
  notice: string | null;
  count: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 items-center gap-x-1">
        {/* A focus target after a deleted row, not a control: no ring. */}
        <h3 id={id} tabIndex={-1} className="text-base leading-snug font-semibold text-foreground outline-none">
          {title}
        </h3>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" className="relative text-muted-foreground hover:text-foreground">
              <InfoIcon aria-hidden />
              <span className="sr-only">About {title}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto max-w-72 text-sm touch:text-base">
            {info}
          </PopoverContent>
        </Popover>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <p className={cn("text-sm whitespace-nowrap tabular-nums", notice ? "font-medium text-brand-700" : "text-muted-foreground")}>
          {notice ?? count}
        </p>
        {children}
      </div>
    </div>
  );
}

/**
 * The picker behind a button: photos and videos, several at once. On the
 * iPad it offers the library, the camera and Files.
 */
function MediaInput({
  inputRef,
  onFiles,
  use,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onFiles: (files: readonly File[]) => void;
  use: "category" | "auto-sort";
}) {
  const take = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Cleared, so choosing the same file again still fires.
    event.target.value = "";
    if (files.length > 0) onFiles(files);
  };
  return (
    // Visually hidden rather than display:none, which older iOS Safari will not open from a script.
    <input
      ref={inputRef}
      type="file"
      accept={MEDIA_ACCEPT}
      multiple
      tabIndex={-1}
      aria-hidden
      className="sr-only"
      data-media-input={use}
      onChange={take}
    />
  );
}

/** Add, for one category: photos and videos together, each going in by its type. */
function MediaAddButton({ title, onFiles }: { title: string; onFiles: (files: readonly File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div data-slot="media-add" className="relative">
      <Button type="button" variant="outline" size="sm" className="touch:text-base" onClick={() => input.current?.click()}>
        <PlusIcon aria-hidden />
        Add<span className="sr-only"> Photos and Videos to {title}</span>
      </Button>
      <MediaInput inputRef={input} onFiles={onFiles} use="category" />
    </div>
  );
}

/**
 * Auto-Sort, at the top of Media: photos and videos dropped here (or
 * chosen) upload into Other, and Steri-AI sorts each into its category.
 */
function AutoSortBox({ inspectionId }: { inspectionId: string }) {
  const titleId = useId();
  const view = useAutoSort(inspectionId);
  const busy = isSorting(view);
  const input = useRef<HTMLInputElement>(null);
  const start = useCallback(
    (files: readonly File[]) => {
      if (busy) {
        toast("Wait for Auto-Sort to finish, then add more.");
        return;
      }
      void autoSort(inspectionId, files);
    },
    [busy, inspectionId],
  );
  const drop = useFileDrop(start, true);

  return (
    <section
      aria-labelledby={titleId}
      data-slot="auto-sort"
      data-dragging={drop.dragging || undefined}
      className={cn(
        "relative flex flex-col gap-3 rounded-lg border border-dashed border-brand-300 bg-brand-50 p-3 transition-colors",
        "data-dragging:border-primary data-dragging:outline-2 data-dragging:-outline-offset-2 data-dragging:outline-dashed data-dragging:outline-primary",
      )}
      {...drop.handlers}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <SparklesIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-600" />
          <div className="min-w-0">
            <h3 id={titleId} className="text-base leading-snug font-semibold text-foreground">
              Auto-Sort
            </h3>
            <p className="text-sm text-muted-foreground">
              {drop.dragging ? (
                <span className="font-medium text-brand-700">Drop to sort</span>
              ) : (
                "Drop all photos and videos here. Steri-AI sorts each into its category."
              )}
            </p>
          </div>
        </div>
        <div className="relative">
          <Button type="button" variant="outline" size="sm" className="touch:text-base" disabled={busy} onClick={() => input.current?.click()}>
            <ImagePlusIcon aria-hidden />
            Add Photos and Videos
          </Button>
          <MediaInput inputRef={input} onFiles={start} use="auto-sort" />
        </div>
      </div>
      <AutoSortStatus view={view} />
    </section>
  );
}

/** The run's progress, then its one line. A live region, there from the start, so each change is read out. */
function AutoSortStatus({ view }: { view: AutoSortView }) {
  return (
    <div role="status" className="empty:hidden">
      {view.step === "uploading" && (
        <p className="flex items-center gap-2 text-sm text-brand-700">
          <Spinner aria-hidden />
          Uploading {view.current} of {view.total}…
        </p>
      )}
      {view.step === "sorting" && (
        <p className="flex items-center gap-2 text-sm text-brand-700">
          <Spinner aria-hidden />
          Sorting…
        </p>
      )}
      {view.step === "done" && !view.failed && <p className="text-sm text-foreground">{view.line}</p>}
      {view.step === "done" && view.failed && (
        <p className="flex items-start gap-2 rounded-md border border-warn-border bg-warn-tint px-3 py-2 text-sm text-warn">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {view.line}
        </p>
      )}
    </div>
  );
}
