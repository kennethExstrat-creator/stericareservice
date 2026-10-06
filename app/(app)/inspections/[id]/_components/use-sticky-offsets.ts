"use client";

// Sticky offsets for the capture kit (docs/CAPTURE_KIT.md, "Layout
// conventions"). On its root the screen publishes:
//
// - --capture-sticky-top: where the bars stuck at the top end: the shell's
//   top bar and, below 1280 px, this screen's section tab bar. A module's
//   SizeTabs bar sticks there, and table headers that follow the size tabs
//   below it (SizeTabs adds its own --size-tabs-bar).
// - --capture-sticky-bottom: what the screen sticks to the bottom: nothing,
//   so 0, and a module's sticky totals sit on the screen's bottom edge.
//
// The page's scroll padding matches them, so a field reached with Enter or
// Tab is scrolled clear of every bar: the screen's own, plus the open
// module's sticky parts as they are on screen (its size bar and the header
// rows of a table that follows it at the top, a totals row at the bottom).
// Measured, because their heights depend on the pointer (44 px targets on
// touch), on the module, and on the width (the tab bar gives way to the
// sidebar from 1280 px). The class defaults in capture-screen.tsx hold
// until the first measurement, so server-rendered bars already stick in
// the right place.
import { useEffect, useLayoutEffect, type RefObject } from "react";

/** Space between a bar and the field scrolled up to it. */
const GAP_PX = 8;

/** A module's parts that may stick to the page while their section is open. */
const MODULE_STICKY = '[data-slot="size-tabs-bar"], thead, tfoot';

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export type StickyHeights = { top: number; bottom: number };

/**
 * Keeps --capture-sticky-top, --capture-sticky-bottom and the page's scroll
 * padding in step with the bars on screen.
 *
 * @param bar the screen's own sticky bar (hidden from 1280 px)
 * @param panelId the open section's panel, which holds the module's own sticky parts
 */
export function useStickyOffsets(
  root: RefObject<HTMLElement | null>,
  bar: RefObject<HTMLElement | null>,
  panelId: string,
): void {
  useIsomorphicLayoutEffect(() => {
    const rootElement = root.current;
    const barElement = bar.current;
    if (!rootElement || !barElement) return;
    const html = document.documentElement;
    const previous = { top: html.style.scrollPaddingTop, bottom: html.style.scrollPaddingBottom };
    let frame = 0;

    const update = () => {
      frame = 0;
      // The bar sticks at the shell's top bar (its `top` is --shell-top in px,
      // shown or not: 0 from 1280 px); hidden, its own height adds nothing.
      const top = Number.parseFloat(getComputedStyle(barElement).top) || 0;
      const shown = barElement.getClientRects().length > 0;
      const stickyTop = Math.round(top + (shown ? barElement.getBoundingClientRect().height : 0));
      const stickyBottom = 0;
      rootElement.style.setProperty("--capture-sticky-top", `${stickyTop}px`);
      rootElement.style.setProperty("--capture-sticky-bottom", `${stickyBottom}px`);

      const panel = document.getElementById(panelId);
      const own = panel ? moduleStickyHeights(panel) : { top: 0, bottom: 0 };
      html.style.scrollPaddingTop = `${stickyTop + own.top + GAP_PX}px`;
      html.style.scrollPaddingBottom = `${stickyBottom + own.bottom + GAP_PX}px`;
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    update();
    const resizes = new ResizeObserver(schedule);
    resizes.observe(barElement);
    // A section opening, a module's form arriving, a size bar appearing.
    const mutations = new MutationObserver(schedule);
    mutations.observe(rootElement, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      resizes.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      html.style.scrollPaddingTop = previous.top;
      html.style.scrollPaddingBottom = previous.bottom;
    };
  }, [root, bar, panelId]);
}

/**
 * Heights of the open module's parts that stick to the page: the size bar
 * plus the tallest table header that sticks below it, and the tallest
 * totals row stuck at the bottom. Parts inside a scroller of their own (a
 * measurement grid's header) stick there, not to the page, and do not count.
 */
export function moduleStickyHeights(panel: HTMLElement): StickyHeights {
  let sizeBar = 0;
  let header = 0;
  let footer = 0;
  for (const element of panel.querySelectorAll<HTMLElement>(MODULE_STICKY)) {
    if (element.getClientRects().length === 0) continue;
    if (getComputedStyle(element).position !== "sticky" || !sticksToPage(element, panel)) continue;
    const height = element.getBoundingClientRect().height;
    if (element.matches("tfoot")) footer = Math.max(footer, height);
    else if (element.matches("thead")) header = Math.max(header, height);
    else sizeBar = Math.max(sizeBar, height);
  }
  return { top: Math.round(sizeBar + header), bottom: Math.round(footer) };
}

/** No element between `element` and `stop` scrolls (or clips with a scroll box): it sticks to the page. */
function sticksToPage(element: HTMLElement, stop: HTMLElement): boolean {
  for (let node = element.parentElement; node && node !== stop; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (isScrollBox(style.overflowX) || isScrollBox(style.overflowY)) return false;
  }
  return true;
}

function isScrollBox(overflow: string): boolean {
  return overflow === "auto" || overflow === "scroll" || overflow === "hidden";
}
