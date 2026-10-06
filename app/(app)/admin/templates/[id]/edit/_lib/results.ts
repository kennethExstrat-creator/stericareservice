// What the editor's Server Actions answer (actions.ts). Plain data: an action's
// return value is serialised to the browser.
import type { TemplateStatus } from "@/lib/templates";

/** A problem the server found, where the resolver put it. */
export type ServerProblem = { template: string; path: (string | number)[]; message: string };

export type SaveResult =
  | { status: "idle" }
  | { status: "saved"; message: string; updatedAt: string; coverageCleared: boolean }
  /** Someone else saved this draft after it was opened. */
  | { status: "conflict"; message: string }
  /** The version can no longer be changed: it is in use, active or retired. */
  | { status: "locked"; message: string }
  | { status: "error"; message: string; problems?: ServerProblem[] };

export const SAVE_IDLE: SaveResult = { status: "idle" };

export type VersionResult = { status: "idle" } | { status: "error"; message: string };

export const VERSION_IDLE: VersionResult = { status: "idle" };

/** Largest definition the editor sends, as JSON text: far above any real template. */
export const MAX_DEFINITION_CHARS = 400_000;

/** Why a version cannot be changed, in the words the page and the action both use. */
export function lockedReason(version: { version: number; status: TemplateStatus; inUse: number }): string | null {
  const name = `Version ${version.version}`;
  if (version.inUse > 0) {
    const inspections = version.inUse === 1 ? "1 inspection uses it" : `${version.inUse} inspections use it`;
    return `${name} cannot be changed: ${inspections}, and an inspection keeps the version it started with.`;
  }
  if (version.status === "active") {
    return `${name} is active: inspectors start from it, so it cannot be changed. Changes go into a new version.`;
  }
  if (version.status === "retired") return `${name} is retired, so it cannot be changed. Changes go into a new version.`;
  return null;
}
