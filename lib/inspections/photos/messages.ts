// Results and words of the photo and file actions (lib/inspections/photos/
// actions.ts). Kept apart because a "use server" file may export async
// functions only.
import type { FieldErrors, PhotoTagField } from "./schemas";

/** The fields of a photo row an action changed, for the screen's own copy. */
export type PhotoChange = {
  id: string;
  moduleKey: string | null;
  target: string | null;
  caption: string | null;
  includeInReport: boolean;
};

export type PhotoActionState =
  | { status: "idle" }
  | { status: "success"; message: string; photo?: PhotoChange; removedId?: string }
  | { status: "error"; message: string; fieldErrors?: FieldErrors<PhotoTagField | "photoId" | "form"> };

export const PHOTO_MESSAGES = {
  updated: "Photo updated.",
  deleted: "Photo deleted.",
  fileDeleted: "File deleted.",
  inReport: "The photo goes into the report.",
  outOfReport: "The photo stays out of the report.",
  photoGone: "This photo was deleted, or it can no longer be changed from this account.",
  fileGone: "This file was deleted, or it can no longer be changed from this account.",
  forbidden: "The photos and files of this inspection can no longer be changed from this account.",
  signedOut: "Your session has ended. Sign in again.",
  noAnswer: "The server did not answer. Try again in a moment.",
  refused: "The server refused the change. Reload the page and try again.",
  checkFields: "Check the highlighted fields.",
  unexpected: "Something went wrong. Try again in a moment.",
} as const;

export const IDLE_PHOTO_ACTION: PhotoActionState = { status: "idle" };
