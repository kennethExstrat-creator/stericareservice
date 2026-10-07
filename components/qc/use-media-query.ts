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

/** The `xl` variant (app/globals.css): the desktop layout, 1280 px and wider on a device with no touchscreen. */
export const WIDE_QUERY = "(min-width: 80rem) and (not (any-pointer: coarse))";
/** The `touch:` variant: any touchscreen (an iPad, also with a trackpad attached) gets iPad sizes for targets and text. */
export const COARSE_QUERY = "(any-pointer: coarse)";
