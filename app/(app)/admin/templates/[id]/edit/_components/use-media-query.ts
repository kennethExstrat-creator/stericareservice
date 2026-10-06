"use client";

import { useSyncExternalStore } from "react";

/** Whether a media query matches, kept up to date; `serverValue` on the server and during hydration. */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** Where the module list and its details sit side by side (iPad landscape and wider). */
export const SIDE_BY_SIDE = "(min-width: 1024px)";
