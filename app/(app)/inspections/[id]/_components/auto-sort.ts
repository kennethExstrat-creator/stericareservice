"use client";

// Auto-Sort on Source Documents' Media (Kenneth, 12 October 2026): the
// inspector drops every photo and video of the visit in one go. Each one
// uploads into Other through the page's queue, as any photo or video does;
// once they are up, the AI looks at a small JPEG of each, made from the file
// on this device (lib/photos/media-preview.ts), and moves it into its
// category (sortMediaWithAi writes it). What it is unsure of, or never saw,
// stays in Other to drag into place. The inspector's own moves win: an item
// moved by hand while it uploads or while the AI looks is left out, and a
// sort answered later never moves it back. A run belongs to the page, not to
// the screen: it goes on while the inspector opens another step or the Files
// side, and its progress is there again on their return.
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { mediaStore } from "@/components/capture/photos/media-store";
import { photoQueueStore } from "@/components/capture/photos/queue-store";
import { mediaKind, SOURCE_MEDIA_KEY } from "@/lib/inspections/source-documents";
import { mediaPreview } from "@/lib/photos/media-preview";
import { sortMediaWithAi, type MediaItemRef, type SortedMediaItem, type SortMediaItem } from "../media-actions";
import { autoSortLine, mediaKey, moduleKeyFor, NOT_MEDIA, sectionOf, sortBatches, type MediaKind } from "./media-board";
import { unreachable } from "./unreachable";

export type AutoSortView =
  | { step: "idle" }
  | { step: "uploading"; current: number; total: number }
  | { step: "sorting" }
  | { step: "done"; line: string; failed: boolean };

const IDLE: AutoSortView = { step: "idle" };

/** Said when a run stops on something unexpected. */
const STOPPED = "Auto-Sort stopped. They are in Other to drag into place.";

const views = new Map<string, AutoSortView>();
const listeners = new Set<() => void>();

function show(inspectionId: string, view: AutoSortView): void {
  views.set(inspectionId, view);
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The inspection's Auto-Sort: idle, a run under way, or what the last run did. */
export function useAutoSort(inspectionId: string): AutoSortView {
  return useSyncExternalStore(
    subscribe,
    () => views.get(inspectionId) ?? IDLE,
    () => IDLE,
  );
}

export function isSorting(view: AutoSortView): boolean {
  return view.step === "uploading" || view.step === "sorting";
}

/**
 * Items the inspector is moving by hand, their move not answered yet, by
 * board key (mediaKey). Auto-Sort neither sends them to the AI nor applies
 * a sort to them.
 */
const handMoves = new Map<string, number>();

/** Marks the item as moved by hand until the function it returns is called. */
export function moveByHand(key: string): () => void {
  handMoves.set(key, (handMoves.get(key) ?? 0) + 1);
  return () => {
    const left = (handMoves.get(key) ?? 1) - 1;
    if (left > 0) handMoves.set(key, left);
    else handMoves.delete(key);
  };
}

/** A file of this run, on the queue: its id, and its preview for the AI (null: this browser could not draw it). */
type Queued = { kind: MediaKind; id: string; preview: string | null };

/** Where an upload stands: on its way, up, stopped on a failure that needs the inspector, or taken off this device. */
function uploadOf(inspectionId: string, id: string): "waiting" | "uploaded" | "stopped" | "gone" {
  const { queue, settled } = photoQueueStore.getSnapshot();
  const queued = queue.items.find((item) => item.id === id);
  if (queued) return queued.state === "failed" ? "stopped" : "waiting";
  if (id in settled) return "uploaded";
  // The queue lets go of a finished upload's own copy only once its row is read.
  const media = mediaStore(inspectionId).getSnapshot().media;
  return media?.photos.some((photo) => photo.id === id) || media?.files.some((file) => file.id === id) ? "uploaded" : "gone";
}

/** Still in Other, and not on its way elsewhere: the inspector may have moved it since the run began. */
function stillInOther(inspectionId: string, { kind, id }: MediaItemRef): boolean {
  if (handMoves.has(mediaKey(kind, id))) return false;
  const media = mediaStore(inspectionId).getSnapshot().media;
  const row = kind === "photo" ? media?.photos.find((photo) => photo.id === id) : media?.files.find((file) => file.id === id);
  const { queue, settled } = photoQueueStore.getSnapshot();
  const known = row ?? settled[id] ?? queue.items.find((item) => item.id === id);
  return known !== undefined && sectionOf(kind, known.moduleKey) === "other";
}

/** Shows where the AI put each item: the server has written it. Not one moved by hand meanwhile, whose own move follows. */
function place(inspectionId: string, sorted: readonly SortedMediaItem[]): void {
  for (const item of sorted) {
    if (item.category === null || !stillInOther(inspectionId, item)) continue;
    mediaStore(inspectionId).applyModuleKey(item.kind === "photo" ? "photo" : "file", item.id, moduleKeyFor(item.kind, item.category));
  }
}

/** Hands the file to the page's queue, into Other: its future row id, or null when the queue refused it (it said why). */
function queueInOther(inspectionId: string, file: File, kind: MediaKind): Promise<string | null> {
  let id: string | null = null;
  const onQueued = (queued: { id: string }) => {
    id = queued.id;
  };
  const added =
    kind === "photo"
      ? photoQueueStore.addPhotos({ inspectionId, files: [file], tag: { moduleKey: null, target: {} }, onQueued })
      : photoQueueStore.addFiles({ inspectionId, moduleKey: SOURCE_MEDIA_KEY, kind: "other", files: [file], onQueued });
  return added.then(() => id);
}

/**
 * Uploads the photos and videos among `files` into Other, then has the AI
 * sort them, twelve at a time. Other files are refused with a message. One
 * run at a time: a call while one is under way does nothing.
 */
export async function autoSort(inspectionId: string, files: readonly File[]): Promise<void> {
  if (isSorting(views.get(inspectionId) ?? IDLE)) return;
  const accepted: { file: File; kind: MediaKind }[] = [];
  for (const file of files) {
    const kind = mediaKind(file);
    if (kind) accepted.push({ file, kind });
    else toast.error(`${file.name || "The file"} was not added`, { description: NOT_MEDIA });
  }
  if (accepted.length === 0) return;

  const total = accepted.length;
  show(inspectionId, { step: "uploading", current: 1, total });
  try {
    const queued = await upload(inspectionId, accepted);
    if (queued.length === 0) {
      // The queue refused every one, and said why.
      show(inspectionId, IDLE);
      return;
    }
    show(inspectionId, { step: "sorting" });
    // What is up and could be drawn. Each batch is chosen as it is sent: a sort takes a while, and
    // the inspector may move items meanwhile.
    let left: SortMediaItem[] = queued.flatMap(({ kind, id, preview }) =>
      preview !== null && uploadOf(inspectionId, id) === "uploaded" ? [{ kind, id, preview }] : [],
    );
    const nextBatch = (): SortMediaItem[] | undefined => {
      left = left.filter((item) => stillInOther(inspectionId, item));
      const [batch] = sortBatches(left);
      left = left.slice(batch?.length ?? 0);
      return batch;
    };
    const sorted: SortedMediaItem[] = [];
    let error: string | null = null;
    for (let batch = nextBatch(); batch; batch = error === null ? nextBatch() : undefined) {
      const result = await sortMediaWithAi(inspectionId, batch).catch((thrown: unknown) => ({
        ok: false as const,
        error: unreachable(thrown).message,
      }));
      if (result.ok) {
        sorted.push(...result.sorted);
        place(inspectionId, result.sorted);
      } else {
        error = result.error;
      }
    }
    show(inspectionId, { step: "done", line: autoSortLine({ sorted, total: queued.length, error }), failed: error !== null });
  } catch (thrown) {
    console.error("Auto-Sort stopped", thrown);
    show(inspectionId, { step: "done", line: STOPPED, failed: true });
  }
}

/**
 * Queues each file while making its preview, one file at a time, then waits
 * until every upload is up, stopped or gone. The count on screen follows
 * the uploads: "Uploading 3 of 12…".
 */
async function upload(inspectionId: string, accepted: readonly { file: File; kind: MediaKind }[]): Promise<Queued[]> {
  const total = accepted.length;
  const queued: Queued[] = [];
  let refused = 0;
  let adding = true;
  let shown = 1;
  let release = () => {};
  const finished = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  const check = () => {
    const done = refused + queued.filter((item) => uploadOf(inspectionId, item.id) !== "waiting").length;
    const current = Math.min(total, done + 1);
    if (current !== shown) {
      shown = current;
      show(inspectionId, { step: "uploading", current, total });
    }
    if (!adding && done === total) release();
  };
  const stop = photoQueueStore.subscribe(check);
  try {
    for (const { file, kind } of accepted) {
      const [preview, id] = await Promise.all([mediaPreview(file, kind), queueInOther(inspectionId, file, kind)]);
      if (id) queued.push({ kind, id, preview });
      else refused += 1;
      check();
    }
    adding = false;
    check();
    await finished;
  } finally {
    stop();
  }
  return queued;
}
