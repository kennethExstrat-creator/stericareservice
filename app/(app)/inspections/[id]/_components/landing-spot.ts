// Where the inspector stopped, for a page loaded again in place: a pull to
// refresh on the iPad, a reload, a tab the system dropped. Every value is
// kept already (autosave, the local copy), and ?module= reopens the section;
// this remembers the last field that stored a value, per user and
// inspection (as the local copies are), in the tab's sessionStorage, so the
// screen can bring that field back into view.
// These are the parts without the DOM: the stored spot, whether this load
// lands on it, and which field on screen it is. use-landing-spot.ts does the
// DOM.
import { z } from "zod";
import type { IssuePath } from "@/lib/validation";

const STORAGE_PREFIX = "stericare:capture-landing:";

const LandingSpotSchema = z.object({
  v: z.literal(1),
  /** The section the field is in (a module or custom module key), also where its page shows another. */
  section: z.string().min(1),
  /** The issue path of the field or of its closest marked container, as issuePathKey writes it. */
  path: z.string().nullable(),
  /** The field's accessible name: its label. */
  name: z.string().nullable(),
  /** Which of the fields with the same path and name it is, in reading order. */
  nth: z.number().int().min(0),
});

export type LandingSpot = z.infer<typeof LandingSpotSchema>;

/** How a field on screen is told apart from the others in its section. */
export type FieldSignature = { path: string | null; name: string | null };

/** Whose spot, in which inspection: another account signed in on the same tab never lands on it. */
export type LandingOwner = { userId: string; inspectionId: string };

export function landingStorageKey({ userId, inspectionId }: LandingOwner): string {
  return `${STORAGE_PREFIX}${userId}:${inspectionId}`;
}

/** The spot stored for the user and inspection; null when none, or unreadable. Storage may be missing or refuse (private mode). */
export function readLandingSpot(storage: Pick<Storage, "getItem"> | null, owner: LandingOwner): LandingSpot | null {
  try {
    const raw = storage?.getItem(landingStorageKey(owner));
    if (!raw) return null;
    const parsed = LandingSpotSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Stores the spot; false when storage refused it. Nothing else depends on it: the values are saved anyway. */
export function writeLandingSpot(storage: Pick<Storage, "setItem"> | null, owner: LandingOwner, spot: LandingSpot): boolean {
  try {
    if (!storage) return false;
    storage.setItem(landingStorageKey(owner), JSON.stringify(spot));
    return true;
  } catch {
    return false;
  }
}

/** How the document was loaded: PerformanceNavigationTiming's type and URL, and Chrome's document.wasDiscarded. */
export type DocumentLoad = { type: string | null; url: string | null; wasDiscarded?: boolean };

/**
 * Whether the screen at `pathname` came with a document loaded again in
 * place: a reload (pull to refresh), Back or Forward into a page the browser
 * no longer kept, or a tab the system discarded and loaded again. Not when
 * it was opened afresh, or inside the app after the document loaded another
 * page.
 */
export function isReturnLoad(load: DocumentLoad, pathname: string): boolean {
  if (!load.url) return false;
  let loadedPath: string;
  try {
    loadedPath = new URL(load.url).pathname;
  } catch {
    return false;
  }
  if (trimSlash(loadedPath) !== trimSlash(pathname)) return false;
  return load.type === "reload" || load.type === "back_forward" || load.wasDiscarded === true;
}

function trimSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * Whether the spot is on the page that opened: one of the sections it shows
 * (lib/inspections/capture/sections.ts pageSectionKeys). A spot kept in
 * packing configuration lands on the order's page, which shows it.
 */
export function landsOnPage(spot: Pick<LandingSpot, "section">, sectionKeys: readonly string[]): boolean {
  return sectionKeys.includes(spot.section);
}

function sameSignature(a: FieldSignature, b: FieldSignature): boolean {
  return a.name === b.name && a.path === b.path;
}

/** Which of the fields with the same signature `fields[index]` is, in reading order. */
export function nthOfSignature(fields: readonly FieldSignature[], index: number): number {
  let nth = 0;
  for (let earlier = 0; earlier < index; earlier++) if (sameSignature(fields[earlier], fields[index])) nth++;
  return nth;
}

/**
 * The field on screen the spot points at: the nth with its path and name
 * (the last of them when there are fewer now), else the first with its path
 * (a label that changed with its value, such as a picker's), else the only
 * one with its name when it had no path. -1 when none.
 */
export function matchLandingField(fields: readonly FieldSignature[], spot: Pick<LandingSpot, "path" | "name" | "nth">): number {
  const same = indicesWhere(fields, (field) => sameSignature(field, spot));
  if (same.length > 0) return same[Math.min(spot.nth, same.length - 1)];
  if (spot.path !== null) {
    const onPath = indicesWhere(fields, (field) => field.path === spot.path);
    if (onPath.length > 0) return onPath[0];
    return -1;
  }
  if (spot.name === null) return -1;
  const named = indicesWhere(fields, (field) => field.name === spot.name);
  return named.length === 1 ? named[0] : -1;
}

function indicesWhere<T>(items: readonly T[], test: (item: T) => boolean): number[] {
  return items.flatMap((item, index) => (test(item) ? [index] : []));
}

/** The issue path a spot's path key stands for (issuePathKey's JSON), for the module to reveal; null when it is not one. */
export function parsePathKey(key: string | null): IssuePath | null {
  if (key === null) return null;
  try {
    const parsed: unknown = JSON.parse(key);
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every((part) => typeof part === "string" || typeof part === "number")
      ? parsed
      : null;
  } catch {
    return null;
  }
}
