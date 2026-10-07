// A section's form code that did not arrive (section-body.tsx loads each
// module's form on demand): the connection dropped while it downloaded, or
// the app was updated since the page loaded and the old file is gone. Not a
// bug in the form, so the screen says so calmly and tries again, instead of
// the red "report this to a developer" (section-error-boundary.tsx).

/** The messages browsers and bundlers give a dynamic import that could not be fetched. */
const LOAD_FAILED =
  /Failed to load chunk|Loading chunk [\w./-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

export function isLoadFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "ChunkLoadError" || LOAD_FAILED.test(error.message);
}

/** How a failed section reads: a download while offline, a download that failed online, or the form itself. */
export type SectionFailure = "offline" | "not_loaded" | "crashed";

export function sectionFailure(error: unknown, online: boolean): SectionFailure {
  if (!online) return "offline";
  return isLoadFailure(error) ? "not_loaded" : "crashed";
}
