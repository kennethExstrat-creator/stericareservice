"use client";

// Sticky offsets for the capture kit (docs/CAPTURE_KIT.md, "Layout
// conventions"): `--capture-sticky-top` is where a module's own sticky bars
// (SizeTabs) stick, below the shell's top bar and this screen's section
// tabs; `--capture-sticky-bottom` is what sticks at the bottom (nothing
// here). The page's scroll padding matches, so a field reached with Enter
// or Tab never hides under a bar. Measured, because the section tab bar's
// height depends on the pointer (44 px targets on touch) and it is not shown
// from 1280 px, where the sidebar takes over.
import { useEffect, useLayoutEffect, type RefObject } from "react";

/** Room for a module's own sticky size bar under ours, so focus scrolls clear of it too. */
const MODULE_BAR_ROOM_PX = 64;

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useStickyOffsets(root: RefObject<HTMLElement | null>, bar: RefObject<HTMLElement | null>): void {
  useIsomorphicLayoutEffect(() => {
    const rootElement = root.current;
    const barElement = bar.current;
    if (!rootElement || !barElement) return;
    const html = document.documentElement;
    const previousPadding = html.style.scrollPaddingTop;

    const update = () => {
      const shown = barElement.getClientRects().length > 0;
      // The bar sticks at the shell's top (its computed `top`, in px); hidden, it adds nothing.
      const top = shown ? Number.parseFloat(getComputedStyle(barElement).top) || 0 : shellTop(rootElement);
      const height = shown ? barElement.getBoundingClientRect().height : 0;
      rootElement.style.setProperty("--capture-sticky-top", `${Math.round(top + height)}px`);
      rootElement.style.setProperty("--capture-sticky-bottom", "0px");
      html.style.scrollPaddingTop = `${Math.round(top + height + MODULE_BAR_ROOM_PX)}px`;
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(barElement);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      html.style.scrollPaddingTop = previousPadding;
    };
  }, [root, bar]);
}

/** The shell's top bar height where the bar is hidden: 0 from 1280 px. */
function shellTop(element: HTMLElement): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;height:var(--shell-top,0px)";
  element.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height;
}
