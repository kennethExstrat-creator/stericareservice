"use client";

// Source Documents' Media (Kenneth, 11 October 2026): the photos and videos
// the inspector took on the visit, in four categories (MEDIA_CATEGORIES in
// lib/inspections/source-documents.ts). A category lists its photos
// (ModulePhotos) and its videos (FileSlot), both tagged with its key; with
// nothing yet it is one row: its title and count over its hint, and Add
// Photos and Add Videos. Files dropped on a category go in by their type.
// Photos and videos in no category (untagged ones, a step's from before the
// steps lost their photo box, the videos of the first Media tab) show under
// Other while there are any, so nothing disappears: the photo edit dialog
// moves a photo into a category. The AI does not read Media.
import { useCallback, useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { ImagePlusIcon, VideoIcon } from "lucide-react";
import { toast } from "sonner";
import { FileSlot } from "@/components/capture/files";
import {
  MediaLoadFailure,
  ModulePhotos,
  UploadNotices,
  useAddPhotos,
  useInspectionMedia,
  usePhotoQueue,
} from "@/components/capture/photos";
import { slotFiles, slotPhotos } from "@/components/capture/photos/photo-model";
import { moduleSlotKey, NOTHING_PREPARING, type PreparingCount } from "@/components/capture/photos/queue-state";
import { photoQueueStore } from "@/components/capture/photos/queue-store";
import { Button } from "@/components/ui/button";
import { countPhotos, countVideos } from "@/lib/inspections/photos/view";
import {
  MEDIA_CATEGORIES,
  MEDIA_CATEGORY_KEYS,
  mediaCounts,
  mediaKind,
  SOURCE_MEDIA_KEY,
  type MediaCategory,
  type MediaCount,
} from "@/lib/inspections/source-documents";
import { cn } from "@/lib/utils";

const VIDEO_NOUN = ["video", "videos"] as const;

/** Why a dropped file stayed out: Media holds photos and videos only. */
const NOT_MEDIA = "Media takes photos and videos. Add documents under Files.";

const OTHER_TITLE = "Other";

/** Under Other's title: what it holds, and how a photo leaves it. */
function otherHint(count: MediaCount, readOnly: boolean): string {
  return count.photos > 0 && !readOnly ? "Not in a category yet. Edit a photo to move it into one." : "Not in a category.";
}

/** "2 photos · 1 video". */
function mediaCountLine({ photos, videos }: MediaCount): string {
  return `${countPhotos(photos)} · ${countVideos(videos)}`;
}

/**
 * A section of Media: a category, or Other. Its padding reaches into the
 * card's, so a section a file is dragged over can show it round its text.
 */
const ROW = cn(
  "relative flex min-w-0 flex-col gap-3 p-3 transition-colors",
  "data-dragging:rounded-lg data-dragging:bg-brand-50 data-dragging:outline-2 data-dragging:-outline-offset-2 data-dragging:outline-dashed data-dragging:outline-primary",
);

type SourceMediaProps = {
  inspectionId: string;
  /** The screen's read-only state (approved, or not the user's): nothing to add, edit or delete. */
  readOnly: boolean;
};

export function SourceMedia({ inspectionId, readOnly }: SourceMediaProps) {
  const baseId = useId();
  const media = useInspectionMedia(inspectionId);
  const queue = usePhotoQueue();
  // Every photo and file of the inspection, uploaded or on this device, as the sections below list them.
  const photos = useMemo(
    () => slotPhotos({ media: media.media, queue, inspectionId, moduleKey: undefined }),
    [media.media, queue, inspectionId],
  );
  const files = useMemo(
    () => slotFiles({ files: media.media?.files ?? [], queue, inspectionId, moduleKey: undefined }),
    [media.media, queue, inspectionId],
  );
  const counts = useMemo(() => mediaCounts(photos, files), [photos, files]);

  const access = media.media?.access ?? null;
  // As ModulePhotos and FileSlot decide: adding works offline and before the media has loaded
  // (it queues); it stops only when the screen is read-only, the database said no, or the
  // queue cannot run on this device.
  const canAdd = !readOnly && queue.phase !== "unavailable" && media.status !== "not_found" && (access === null || access.canEdit);
  const loading = media.status === "idle" || media.status === "loading";
  const headingId = (key: string) => `${baseId}-${key}`;
  const lastCategory = headingId(MEDIA_CATEGORIES[MEDIA_CATEGORIES.length - 1].key);
  const showOther = counts.other.photos > 0 || counts.other.videos > 0;

  return (
    <div data-slot="source-media" className="flex flex-col gap-4">
      <UploadNotices inspectionId={inspectionId} />
      {media.status === "error" && <MediaLoadFailure inspectionId={inspectionId} />}
      {/* -m-3: the rows' own padding reaches into the card's, so the text lines up with the card's edge. */}
      <div className="-m-3 flex flex-col divide-y divide-border">
        {counts.categories.map(({ category, photos: photoCount, videos: videoCount }) => (
          <CategorySection
            key={category.key}
            inspectionId={inspectionId}
            readOnly={readOnly}
            category={category}
            headingId={headingId(category.key)}
            count={{ photos: photoCount, videos: videoCount }}
            loading={loading}
            canAdd={canAdd}
            preparing={queue.preparingByModule[moduleSlotKey(inspectionId, category.key)] ?? NOTHING_PREPARING}
          />
        ))}
        {showOther && (
          <OtherSection
            inspectionId={inspectionId}
            readOnly={readOnly}
            headingId={headingId("other")}
            count={counts.other}
            // Other goes with the last photo moved out of it: focus then lands on the last category.
            focusFallback={() => (document.getElementById(headingId("other")) ?? document.getElementById(lastCategory))?.focus()}
          />
        )}
      </div>
    </div>
  );
}

function CategorySection({
  inspectionId,
  readOnly,
  category,
  headingId,
  count,
  loading,
  canAdd,
  preparing,
}: {
  inspectionId: string;
  readOnly: boolean;
  category: MediaCategory;
  headingId: string;
  count: MediaCount;
  loading: boolean;
  canAdd: boolean;
  preparing: PreparingCount;
}) {
  const { key, title, hint } = category;
  const addPhotos = useAddPhotos({ inspectionId, moduleKey: key, focus: null });
  const addVideos = useCallback(
    (files: readonly File[]) => photoQueueStore.addFiles({ inspectionId, moduleKey: key, kind: "other", files }),
    [inspectionId, key],
  );
  const addDropped = useCallback(
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
      if (videos.length > 0) addVideos(videos);
    },
    [addPhotos, addVideos],
  );
  const drop = useFileDrop(addDropped, canAdd);
  const focusHeading = useCallback(() => document.getElementById(headingId)?.focus(), [headingId]);

  return (
    <section
      aria-labelledby={headingId}
      data-slot="media-category"
      data-category={key}
      data-dragging={drop.dragging || undefined}
      className={ROW}
      {...drop.handlers}
    >
      <SectionHeader
        id={headingId}
        title={title}
        hint={drop.dragging ? <span className="font-medium text-brand-700">Drop to add to {title}</span> : hint}
        count={loading && count.photos + count.videos === 0 ? "Loading…" : mediaCountLine(count)}
      >
        {canAdd && <MediaAddButtons title={title} onPhotos={addPhotos} onVideos={addVideos} />}
      </SectionHeader>
      {(count.photos > 0 || preparing.photos > 0) && (
        <ModulePhotos
          bare
          inspectionId={inspectionId}
          moduleKey={key}
          readOnly={readOnly}
          showAddControls={false}
          showNotices={false}
          focusFallback={focusHeading}
        />
      )}
      {(count.videos > 0 || preparing.files > 0) && (
        <FileSlot
          bare
          inspectionId={inspectionId}
          moduleKey={key}
          kind="other"
          readOnly={readOnly}
          canAdd={false}
          accept="video/*"
          compactRows
          noun={VIDEO_NOUN}
          focusFallback={focusHeading}
        />
      )}
    </section>
  );
}

/** What is in no category: photos listed with their own tag on each tile, the first Media tab's videos. Nothing is added here. */
function OtherSection({
  inspectionId,
  readOnly,
  headingId,
  count,
  focusFallback,
}: {
  inspectionId: string;
  readOnly: boolean;
  headingId: string;
  count: MediaCount;
  focusFallback: () => void;
}) {
  return (
    <section aria-labelledby={headingId} data-slot="media-category" data-category="other" className={ROW}>
      <SectionHeader id={headingId} title={OTHER_TITLE} hint={otherHint(count, readOnly)} count={mediaCountLine(count)} />
      {count.photos > 0 && (
        <ModulePhotos
          bare
          inspectionId={inspectionId}
          moduleKey={null}
          listExcept={MEDIA_CATEGORY_KEYS}
          readOnly={readOnly}
          showAddControls={false}
          showNotices={false}
          focusFallback={focusFallback}
        />
      )}
      {count.videos > 0 && (
        <FileSlot
          bare
          inspectionId={inspectionId}
          moduleKey={SOURCE_MEDIA_KEY}
          kind="other"
          readOnly={readOnly}
          canAdd={false}
          compactRows
          noun={VIDEO_NOUN}
          focusFallback={focusFallback}
        />
      )}
    </section>
  );
}

/**
 * A section's one row: the title with its count over the hint, and the add
 * buttons beside them (below them where the row is too narrow).
 */
function SectionHeader({
  id,
  title,
  hint,
  count,
  children,
}: {
  id: string;
  title: string;
  hint: ReactNode;
  count: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3">
          {/* A focus target after a deleted or moved photo, not a control: no ring. */}
          <h3 id={id} tabIndex={-1} className="text-base leading-snug font-semibold text-foreground outline-none">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground tabular-nums">{count}</p>
        </div>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}

/**
 * Add Photos and Add Videos for one category. On the iPad each opens the
 * system picker, which offers the library, the camera and Files; on a
 * desktop, files dropped anywhere on the category go in as well.
 */
function MediaAddButtons({
  title,
  onPhotos,
  onVideos,
}: {
  title: string;
  onPhotos: (files: readonly File[]) => void;
  onVideos: (files: readonly File[]) => void;
}) {
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const take = (add: (files: readonly File[]) => void) => (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Cleared, so choosing the same file again still fires.
    event.target.value = "";
    if (files.length > 0) add(files);
  };

  return (
    <div data-slot="media-add" className="relative flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" className="touch:text-base" onClick={() => photoInput.current?.click()}>
        <ImagePlusIcon aria-hidden />
        Add Photos<span className="sr-only"> to {title}</span>
      </Button>
      <Button type="button" variant="outline" size="sm" className="touch:text-base" onClick={() => videoInput.current?.click()}>
        <VideoIcon aria-hidden />
        Add Videos<span className="sr-only"> to {title}</span>
      </Button>
      {/* Visually hidden rather than display:none, which older iOS Safari will not open from a script. */}
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        multiple
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        data-photo-input="library"
        onChange={take(onPhotos)}
      />
      <input
        ref={videoInput}
        type="file"
        accept="video/*"
        multiple
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        data-video-input
        onChange={take(onVideos)}
      />
    </div>
  );
}

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/** Files dragged in from the desktop or another app onto a section; links and text are ignored. */
function useFileDrop(onFiles: (files: readonly File[]) => void, enabled: boolean) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  if (!enabled) return { dragging: false, handlers: {} };
  return {
    dragging,
    handlers: {
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
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) onFiles(files);
      },
    },
  };
}
