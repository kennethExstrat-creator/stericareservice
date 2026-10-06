// Photos and files waiting on this device for one inspection (BUILD_SPEC
// 8.1: a badge shows pending uploads; submit waits until none are left).
// The upload queue (lib/photos) keeps every item in the offline database's
// "uploads" store until its row is written; any record there that belongs
// to this user and inspection is still waiting, whatever its format version
// and whichever tab or page queued it. The same rule as
// UploadQueue.isEmptyNow(), counted.
import { z } from "zod";

const ItemOwnerSchema = z.object({ userId: z.string(), inspectionId: z.string() });

export function countWaitingUploads(
  rows: readonly unknown[],
  owner: { userId: string; inspectionId: string },
): number {
  let count = 0;
  for (const row of rows) {
    const parsed = ItemOwnerSchema.safeParse(row);
    if (parsed.success && parsed.data.userId === owner.userId && parsed.data.inspectionId === owner.inspectionId) {
      count += 1;
    }
  }
  return count;
}

/** "1 photo is still uploading", "3 photos are still uploading". */
export function describeWaitingUploads(count: number): string {
  return count === 1 ? "1 photo or file is still uploading" : `${count} photos or files are still uploading`;
}
