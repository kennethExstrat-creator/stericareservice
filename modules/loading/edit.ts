// Pure edits of the saved data, for Capture's `update((current) => ...)`
// (useDataUpdater, docs/CAPTURE_KIT.md). Starting from the latest data, two
// changes in one event both land: a count committed on blur as the container
// no. is typed, say.
import type { LoadingData } from "./schema";

/** Some values replaced; null clears a value. */
export function withLoadingValues(data: LoadingData, values: Partial<LoadingData>): LoadingData {
  return { ...data, ...values };
}
