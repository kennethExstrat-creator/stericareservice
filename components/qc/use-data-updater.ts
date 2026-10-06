"use client";

// The one way a Capture changes its data (docs/CAPTURE_KIT.md): every kit
// callback calls `update((current) => next)` instead of onChange(set(data, ...)).
import { useLayoutEffect, useState } from "react";
import { createDataUpdater, type DataChange } from "./data-updater";

/**
 * Binds CaptureProps' `data` and `onChange` into `update(change)`: each change
 * starts from the latest data, including changes made earlier in the same
 * event that the screen has not rendered yet, so a pasted column reaches
 * onChange once with every value. Stable across renders.
 */
export function useDataUpdater<T>(data: T, onChange: (next: T) => void): (change: DataChange<T>) => void {
  const [updater] = useState(() => createDataUpdater(data, onChange));
  // After every commit: the data on screen is the base again, and the newest onChange is used.
  useLayoutEffect(() => {
    updater.sync(data, onChange);
  });
  return updater.update;
}
