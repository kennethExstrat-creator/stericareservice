"use server";

import { unstable_rethrow } from "next/navigation";
import { sortMedia } from "@/lib/ai/media-sorter";
import { loadAiEnv } from "@/lib/ai/settings";
import { recordAiUsageLater } from "@/lib/ai/usage";
import { authorizeAction } from "@/lib/auth/session";
import {
  isMediaVideoKey,
  itemKey,
  MEDIA_MESSAGES,
  mediaPlace,
  moduleKeyFor,
  parseMoveInput,
  parseSortInput,
  sortCounts,
  type MediaKind,
} from "@/lib/inspections/media-moves";
import type { MediaCategoryKey } from "@/lib/inspections/source-documents";
import { postgrestFailure, type FailureReason } from "@/lib/offline/failures";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/*
 * Source Documents' Media (docs/AI.md, "Auto-Sort (Media)"): a photo or
 * video moved between Media's categories by hand (drag and drop), and the
 * AI's Auto-Sort. Server Actions are public endpoints, so each one checks the
 * session, validates its input with zod (lib/inspections/media-moves.ts),
 * checks the caller may still change the inspection's photos and files (the
 * database's own rule, can_edit_inspection: the inspector while it is a
 * draft or reopened, admins until it is approved, as for retagging a photo)
 * and that each item is this inspection's, then writes through the caller's
 * client, so Row Level Security and the media guard decide again. The audit
 * log is written with the secret key, naming who (an inspector records only
 * a few events themselves). Nothing is refreshed: the screen keeps its own
 * copy.
 */

/** A photo (an inspection photo) or a video (an inspection file) on the Media side. */
export type MediaItemRef = { kind: "photo" | "video"; id: string };
export type MoveMediaResult = { ok: true } | { ok: false; error: string };
/** A small JPEG of the photo or of a frame of the video: base64 without "data:", at most 1024 px on its long edge. */
export type SortMediaItem = MediaItemRef & { preview: string };
export type SortedMediaItem = MediaItemRef & { category: MediaCategoryKey | null };
export type SortMediaResult = { ok: true; sorted: SortedMediaItem[] } | { ok: false; error: string };

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** A photo's or video's row, as far as a move needs it. */
type MediaRow = { kind: MediaKind; id: string; moduleKey: string | null; target: string | null };

type Opened = { ok: true; supabase: Supabase; rows: Map<string, MediaRow> } | { ok: false; error: string };

/** Where Auto-Sort left an item (null: where it was), and the write that put it there, if one was needed. */
type Placement = { key: string; category: MediaCategoryKey | null; write: MoveMediaResult | null };

const goneMessage = (kind: MediaKind) => (kind === "photo" ? MEDIA_MESSAGES.photoGone : MEDIA_MESSAGES.videoGone);

/** Puts a photo or video in a Media category, or in Other (null). */
export async function moveMedia(
  inspectionId: string,
  item: MediaItemRef,
  category: MediaCategoryKey | null,
): Promise<MoveMediaResult> {
  try {
    const auth = await authorizeAction();
    if (!auth.ok) return { ok: false, error: auth.error };
    const input = parseMoveInput(inspectionId, item, category);
    if (!input.ok) return { ok: false, error: input.error };
    const { inspectionId: id, item: ref, category: to } = input.data;

    const media = await openMedia(id, [ref]);
    if (!media.ok) return { ok: false, error: media.error };
    const gone = goneMessage(ref.kind);
    const row = media.rows.get(itemKey(ref));
    if (!row) return { ok: false, error: gone };
    // Already there: nothing to write, and a photo in Other keeps the step's key it may have.
    if (mediaPlace(row.moduleKey) === to) return { ok: true };

    const moduleKey = moduleKeyFor(row.kind, to);
    const written = await writePlace(media.supabase, id, row, moduleKey, gone);
    if (!written.ok) return written;
    await logMediaEvent(id, "media_moved", { by: auth.user.id, ...moveRecord(row, moduleKey) });
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[media] moveMedia failed", error);
    return { ok: false, error: MEDIA_MESSAGES.unexpected };
  }
}

/** Claude puts each item in its category; one it is unsure of (category null) stays where it is. At most 12 items a call. */
export async function sortMediaWithAi(inspectionId: string, items: SortMediaItem[]): Promise<SortMediaResult> {
  try {
    const auth = await authorizeAction();
    if (!auth.ok) return { ok: false, error: auth.error };
    const input = parseSortInput(inspectionId, items);
    if (!input.ok) return { ok: false, error: input.error };
    const { inspectionId: id, items: list } = input.data;

    const media = await openMedia(id, list);
    if (!media.ok) return { ok: false, error: media.error };
    // Only this inspection's media goes to the AI; anything else comes back with no category, untouched.
    const sortable = list.filter((entry) => media.rows.has(itemKey(entry)));
    if (sortable.length === 0) return { ok: false, error: MEDIA_MESSAGES.noneLeft };

    const outcome = await sortMedia(
      sortable.map(({ kind, mediaType, preview }) => ({ kind, mediaType, base64: preview })),
      await loadAiEnv(),
      // Its cost (Steri-AI Cost), recorded after the response: one batch, the previews sent.
      recordAiUsageLater({ feature: "media_sort", inspectionId: id, actorId: auth.user.id, itemCount: sortable.length }),
    );
    if (!outcome.ok) return { ok: false, error: outcome.message };

    // Each category the AI is sure of goes in with moveMedia's write; the others stay where they are.
    const placements = await Promise.all(
      sortable.map(async (entry, index): Promise<Placement> => {
        const key = itemKey(entry);
        const row = media.rows.get(key);
        const to = outcome.categories[index] ?? null;
        if (!row || to === null) return { key, category: null, write: null };
        if (mediaPlace(row.moduleKey) === to) return { key, category: to, write: null };
        const write = await writePlace(media.supabase, id, row, moduleKeyFor(row.kind, to), goneMessage(row.kind));
        return { key, category: write.ok ? to : null, write };
      }),
    );
    const writes = placements.flatMap((placement) => (placement.write ? [placement.write] : []));
    const errors = writes.flatMap((write) => (write.ok ? [] : [write.error]));
    if (writes.length > 0 && errors.length === writes.length) return { ok: false, error: errors[0] };

    await logMediaEvent(id, "media_sorted", {
      by: auth.user.id,
      model: outcome.model,
      photos: sortable.filter((entry) => entry.kind === "photo").length,
      videos: sortable.filter((entry) => entry.kind === "video").length,
      ...sortCounts(outcome.categories),
      ...(errors.length > 0 ? { not_saved: errors.length } : {}),
    });
    const placed = new Map(placements.map((placement) => [placement.key, placement.category]));
    return {
      ok: true,
      sorted: list.map(({ kind, id: itemId }) => ({ kind, id: itemId, category: placed.get(itemKey({ kind, id: itemId })) ?? null })),
    };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[media] sortMediaWithAi failed", error);
    return { ok: false, error: MEDIA_MESSAGES.unexpected };
  }
}

/**
 * The caller's client, once they may change the inspection's photos and
 * files, with the rows of the items that are its media (by itemKey): any of
 * its photos, and its videos on Media, a category's or Other's. Source
 * Documents' own files and a step's lab reports are not media.
 */
async function openMedia(inspectionId: string, items: readonly { kind: MediaKind; id: string }[]): Promise<Opened> {
  const supabase = await createClient();
  const photoIds = items.filter((item) => item.kind === "photo").map((item) => item.id);
  const videoIds = items.filter((item) => item.kind === "video").map((item) => item.id);
  const [allowed, photos, videos] = await Promise.all([
    supabase.rpc("can_edit_inspection", { inspection_id: inspectionId }),
    photoIds.length > 0
      ? supabase.from("inspection_photos").select("id, module_key, target").eq("inspection_id", inspectionId).in("id", photoIds)
      : null,
    videoIds.length > 0
      ? supabase.from("inspection_files").select("id, module_key").eq("inspection_id", inspectionId).in("id", videoIds)
      : null,
  ]);
  const failed = allowed.error ?? photos?.error ?? videos?.error;
  if (failed) {
    console.error("[media] reading the inspection's media failed", failed.code, failed.message);
    return { ok: false, error: MEDIA_MESSAGES.noAnswer };
  }
  if (allowed.data !== true) return { ok: false, error: MEDIA_MESSAGES.forbidden };

  const rows = new Map<string, MediaRow>();
  for (const row of photos?.data ?? []) {
    rows.set(itemKey({ kind: "photo", id: row.id }), { kind: "photo", id: row.id, moduleKey: row.module_key, target: row.target });
  }
  for (const row of videos?.data ?? []) {
    if (!isMediaVideoKey(row.module_key)) continue;
    rows.set(itemKey({ kind: "video", id: row.id }), { kind: "video", id: row.id, moduleKey: row.module_key, target: null });
  }
  return { ok: true, supabase, rows };
}

/**
 * Writes the module_key that puts the item in its new place, through the
 * caller's client. A photo's target goes with its old tag: categories record
 * no size, hand or defect, as in the tag picker.
 */
async function writePlace(
  supabase: Supabase,
  inspectionId: string,
  row: MediaRow,
  moduleKey: string | null,
  gone: string,
): Promise<MoveMediaResult> {
  const { data, error, status } =
    row.kind === "photo"
      ? await supabase
          .from("inspection_photos")
          .update({ module_key: moduleKey, target: null })
          .eq("id", row.id)
          .eq("inspection_id", inspectionId)
          .select("id")
          .maybeSingle()
      : await supabase
          .from("inspection_files")
          .update({ module_key: moduleKey })
          .eq("id", row.id)
          .eq("inspection_id", inspectionId)
          .select("id")
          .maybeSingle();
  if (error) {
    console.error("[media] move refused", { code: error.code, status, message: error.message });
    const reason: FailureReason = postgrestFailure(error, status).reason;
    const messages: Record<FailureReason, string> = {
      unauthorized: MEDIA_MESSAGES.signedOut,
      forbidden: MEDIA_MESSAGES.forbidden,
      not_found: gone,
      network: MEDIA_MESSAGES.noAnswer,
      server: MEDIA_MESSAGES.noAnswer,
      invalid: MEDIA_MESSAGES.refused,
      too_large: MEDIA_MESSAGES.refused,
    };
    return { ok: false, error: messages[reason] };
  }
  // Row Level Security hides a row this user may not change: no row back means gone, or not allowed now.
  return data ? { ok: true } : { ok: false, error: gone };
}

/** media_moved's record: which item, from which tag to which; a photo's target as it was. */
function moveRecord(row: MediaRow, to: string | null): Record<string, string | null> {
  return row.kind === "photo"
    ? { photo_id: row.id, from: row.moduleKey, to, target: row.target }
    : { file_id: row.id, from: row.moduleKey, to };
}

/**
 * Records a move or a sort in the inspection's audit log (docs/DATABASE.md,
 * "Audit log") with the secret key, `by` naming who: an inspector may record
 * only a few events themselves. The move has happened either way, so a
 * failed record is only logged.
 */
async function logMediaEvent(inspectionId: string, action: "media_moved" | "media_sorted", changes: Json): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc("log_inspection_event", { inspection_id: inspectionId, action, changes });
    if (error) console.error(`[media] could not record ${action}`, error.code, error.message);
  } catch (error) {
    console.error(`[media] could not record ${action}`, error);
  }
}
