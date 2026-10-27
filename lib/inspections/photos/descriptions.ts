// Steri-AI's photo descriptions on the screens (docs/AI.md, "Describing
// photos"; Kenneth, 27 October 2026): which photos the Report page has
// described in the background, what the describePhotos Server Action
// answers, and its words. Kept apart from the action because a "use server"
// file exports async functions only. Pure and client-safe.
import type { PhotoDescription } from "@/lib/schemas/photo-description";
import { parseTarget } from "@/lib/photos/target";

/**
 * Photos per Server Action call, each one Claude request. Next.js runs a
 * page's Server Actions one at a time, so the autosave waits behind one batch
 * at most (a few seconds), never behind a whole run.
 */
export const DESCRIBE_BATCH = 4;

/** Steri-AI's look at a photo: its description, or null when it could not tell what the photo shows. */
export type PhotoDescribed = { description: PhotoDescription | null; describedAt: string | null };

/** One photo the action described: what it now says, and when. */
export type DescribedPhoto = { id: string; description: PhotoDescription | null; describedAt: string };

export type DescribePhotosResult =
  | { ok: true; photos: DescribedPhoto[] }
  /** `quiet`: the server cannot describe photos yet (migration 20261027200000 not run), so a background run stops without a word. */
  | { ok: false; error: string; quiet?: boolean };

export type DescribePhotosOptions = {
  /** Describe these photos again, already described or not (the photo's dialog: Describe Again). */
  again?: boolean;
};

/** The describePhotos Server Action, as the photo screens are handed it for a role with Steri-AI Reading. */
export type DescribePhotos = (inspectionId: string, photoIds: string[], options?: DescribePhotosOptions) => Promise<DescribePhotosResult>;

export const DESCRIBE_MESSAGES = {
  invalid: "Those photos cannot be described.",
  gone: "These photos were deleted, or they can no longer be changed from this account.",
  forbidden: "The photos of this inspection can no longer be changed from this account.",
  notReady: "Photo descriptions are not set up on this server yet.",
  unreadable: "The photos could not be read. Try again.",
  noAnswer: "The server did not answer. Try again in a moment.",
  unexpected: "Something went wrong. Try again in a moment.",
} as const;

/** What the rule reads of a photo: MediaPhoto fits. */
export type DescribablePhoto = {
  id: string;
  moduleKey: string | null;
  target: string | null;
  flagged: boolean;
  includeInReport: boolean;
  takenAt: string | null;
  createdAt: string;
  describedAt: string | null;
};

/** Media's Product Defects (Source Documents). */
const PRODUCT_DEFECTS = "media_defects";

/**
 * The photos the Report page has Steri-AI describe, the most wanted first:
 * every photo the report can show that Steri-AI has not looked at yet. The
 * report shows a photo tagged with a step or one of Media's categories, and
 * one marked In Report; a photo in Media's Other is in no record. A flagged
 * original (often HEIC) is never sent: it is left out of the report too.
 * Defect photos first (a step's photo tagged with a defect, and Media's
 * Product Defects: what Section 06 chooses from), then those marked In
 * Report, then the rest, each in the order taken.
 */
export function photosToDescribe<T extends DescribablePhoto>(photos: readonly T[]): T[] {
  const rank = (photo: T) => {
    if (photo.moduleKey === PRODUCT_DEFECTS || defectTagged(photo.target)) return 0;
    return photo.includeInReport ? 1 : 2;
  };
  const time = (photo: T) => {
    const at = Date.parse(photo.takenAt ?? photo.createdAt);
    return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
  };
  return photos
    .filter((photo) => !photo.flagged && photo.describedAt === null && (photo.moduleKey !== null || photo.includeInReport))
    .map((photo, index) => ({ photo, index, rank: rank(photo), at: time(photo) }))
    .sort((a, b) => a.rank - b.rank || (a.at === b.at ? 0 : a.at < b.at ? -1 : 1) || a.index - b.index)
    .map(({ photo }) => photo);
}

function defectTagged(target: string | null): boolean {
  const parsed = parseTarget(target);
  return parsed.ok && parsed.target.defect !== undefined;
}

/** "Steri-AI is describing 4 photos…", the Report page's line while a run is on. */
export function describingLine(count: number): string {
  return `Steri-AI is describing ${count === 1 ? "1 photo" : `${count} photos`}…`;
}
