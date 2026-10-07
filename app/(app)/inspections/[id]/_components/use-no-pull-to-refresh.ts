"use client";

// While the capture screen is open, the page neither bounces nor pulls to
// refresh at its edges (overscroll-behavior-y: none on the root scroller),
// so a swipe down at the top of the iPad's page is less likely to reload it.
// Scrolling itself is unchanged. A browser that refreshes anyway (Chrome on
// the iPad may) loses nothing: the autosave keeps every value and
// use-landing-spot.ts lands on the last field.
import { useEffect } from "react";

// Counted, so a screen that mounts before the one it replaces unmounts keeps the setting.
let holders = 0;
let before: { root: string; body: string } | null = null;

export function useNoPullToRefresh(): void {
  useEffect(() => {
    const { documentElement: root, body } = document;
    if (holders === 0) {
      before = { root: root.style.overscrollBehaviorY, body: body.style.overscrollBehaviorY };
      root.style.overscrollBehaviorY = "none";
      body.style.overscrollBehaviorY = "none";
    }
    holders += 1;
    return () => {
      holders -= 1;
      if (holders > 0 || !before) return;
      root.style.overscrollBehaviorY = before.root;
      body.style.overscrollBehaviorY = before.body;
      before = null;
    };
  }, []);
}
