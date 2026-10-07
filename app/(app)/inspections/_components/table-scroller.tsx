"use client";

// The list's card, scrolling sideways when its one-line rows are wider than
// the screen (Kenneth: one neat row each, scroll for more columns). Touch
// scrolls it natively, without the page's own back-swipe at its edges
// (overscroll-x-contain); a mouse or trackpad scrolls it with Shift and the
// wheel or sideways. It takes Tab, so the arrow keys scroll it too, with the
// focus ring outside the card. It marks which way more of the table is
// hidden (data-scrolled: some is off to the left; data-more: some to the
// right), so the pinned Ref and actions columns show an edge only then. No
// scrollbar is drawn (Kenneth found it ugly): those edges show there is more.
//
// The card is positioned (relative), so the screen-reader-only text in its
// cells ("No PO yet" and the like, the caption) is clipped by it. sr-only
// text is position: absolute; without a positioned ancestor inside the card
// it would sit at its place in the wide table but outside the scroller's
// clipping, and widen the page itself (docs/DESIGN.md).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function TableScroller({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ scrolled: false, more: false });

  useEffect(() => {
    const scroller = ref.current;
    if (!scroller) return;
    const update = () => {
      const hidden = scroller.scrollWidth - scroller.clientWidth;
      const scrolled = scroller.scrollLeft > 1;
      const more = scroller.scrollLeft < hidden - 1;
      setEdges((current) => (current.scrolled === scrolled && current.more === more ? current : { scrolled, more }));
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(scroller);
    if (scroller.firstElementChild) resize.observe(scroller.firstElementChild);
    return () => {
      scroller.removeEventListener("scroll", update);
      resize.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      // A scroller takes the focus, so the arrow keys scroll it (WCAG 2.1.1).
      tabIndex={0}
      data-slot="table-scroller"
      data-scrolled={edges.scrolled || undefined}
      data-more={edges.more || undefined}
      className={cn(
        "group/scroller relative w-full overflow-x-auto overscroll-x-contain rounded-xl bg-card shadow-sm ring-1 ring-border focus-ring",
        // Scrolls, without drawing a scrollbar (Firefox and Chrome, then WebKit).
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}
