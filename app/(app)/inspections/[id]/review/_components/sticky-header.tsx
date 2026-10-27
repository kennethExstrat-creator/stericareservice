"use client";

// The review's header sticks below the shell's top bar while the page
// scrolls (layout A, Kenneth, 27 October 2026), so the reference, its status
// and Approve / Reopen stay in reach. It publishes where it ends as
// --review-header on <html>, for the page index that sticks below it, and
// adds itself to the page's scroll padding (app/globals.css keeps the shell's
// top bar in it), so a link to a section lands below the header, not under
// it. Measured, because its height depends on the width and the pointer.
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Space between the header and a section scrolled up to it. */
const GAP_PX = 16;

export function StickyHeader({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useIsomorphicLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const html = document.documentElement;
    const previous = html.style.scrollPaddingTop;
    let frame = 0;

    const update = () => {
      frame = 0;
      // It sticks at the shell's top bar: its `top` is --shell-top in px (0 from 1280 px).
      const top = Number.parseFloat(getComputedStyle(element).top) || 0;
      const end = Math.round(top + element.getBoundingClientRect().height);
      html.style.setProperty("--review-header", `${end}px`);
      html.style.scrollPaddingTop = `${end + GAP_PX}px`;
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    update();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    window.addEventListener("resize", schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
      html.style.scrollPaddingTop = previous;
      html.style.removeProperty("--review-header");
    };
  }, []);

  return (
    <div ref={ref} data-slot="review-header" className={cn("sticky top-(--shell-top) z-30", className)}>
      {children}
    </div>
  );
}
