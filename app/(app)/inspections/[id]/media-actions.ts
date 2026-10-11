"use server";
/* eslint-disable @typescript-eslint/no-unused-vars -- a stub: the server half replaces this file */
import type { MediaCategoryKey } from "@/lib/inspections/source-documents";

/** A photo (an inspection photo) or a video (an inspection file) on the Media side. */
export type MediaItemRef = { kind: "photo" | "video"; id: string };

export type MoveMediaResult = { ok: true } | { ok: false; error: string };

/** Puts a photo or video in a Media category, or in Other (null). */
export async function moveMedia(
  inspectionId: string,
  item: MediaItemRef,
  category: MediaCategoryKey | null,
): Promise<MoveMediaResult> {
  return { ok: false, error: "Auto-Sort is not ready yet." };
}

/** A small JPEG of the photo or of a frame of the video: base64 without "data:", at most 1024 px on its long edge. */
export type SortMediaItem = MediaItemRef & { preview: string };

export type SortedMediaItem = MediaItemRef & { category: MediaCategoryKey | null };

export type SortMediaResult = { ok: true; sorted: SortedMediaItem[] } | { ok: false; error: string };

/** Claude puts each item in its category; one it is unsure of (category null) stays where it is. At most 12 items a call. */
export async function sortMediaWithAi(inspectionId: string, items: SortMediaItem[]): Promise<SortMediaResult> {
  return { ok: false, error: "Auto-Sort is not ready yet." };
}
