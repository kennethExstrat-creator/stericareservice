"use client";

// A CSS media query as a value, for behaviour CSS alone cannot switch
// (accessible roles, widths a parent must know). Layout itself stays in CSS.
import { useCallback, useSyncExternalStore } from "react";

/** True while `query` matches; `serverValue` on the server and during hydration. */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** Tailwind's `xl` breakpoint: the desktop layout. */
export const WIDE_QUERY = "(min-width: 80rem)";
/** The `touch:` variant: iPad sizes for targets and text. */
export const COARSE_QUERY = "(pointer: coarse)";
