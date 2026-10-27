"use client";

// "On This Page" (layout A, Kenneth, 27 October 2026): the review's parts
// down the left on the desktop layout (from 1280 px with no touchscreen),
// sticking below the header while the page scrolls, the part in view
// marked. Plain links: the browser scrolls to the anchor, and the page's
// scroll padding (StickyHeader) lands it below the header. On the iPad
// layout the page is one column and has no index.
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type PageIndexItem = {
  /** The section's id. */
  id: string;
  label: string;
  /** A number beside the label: the modules, the photos, the problems. */
  count?: number;
  /** Colours the count: errors red, warnings amber. */
  tone?: "warn" | "fail";
};

/** How far below the header a part's top may be and still count as the one in view. */
const SLACK_PX = 120;

const COUNT_TONE = {
  plain: "bg-slate-100 text-slate-700",
  warn: "bg-warn-tint text-warn ring-1 ring-warn-border",
  fail: "bg-fail-tint text-fail ring-1 ring-fail-border",
} as const;

export function PageIndex({ items, className }: { items: readonly PageIndexItem[]; className?: string }) {
  const [current, setCurrent] = useState(items[0]?.id ?? "");

  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((element): element is HTMLElement => element !== null);
    if (sections.length === 0) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      // The last part whose top is near the header (within SLACK_PX below it), or the first; the last at
      // the foot of the page. The slack marks a part as soon as its heading shows under the header.
      const offset = (Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0) + SLACK_PX;
      let active = sections[0].id;
      for (const section of sections) if (section.getBoundingClientRect().top - offset <= 0) active = section.id;
      const bottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      setCurrent(bottom ? sections[sections.length - 1].id : active);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [items]);

  return (
    <nav
      aria-label="On This Page"
      className={cn("sticky top-[calc(var(--review-header,0px)_+_1.25rem)] hidden self-start xl:block", className)}
    >
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const on = item.id === current;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={on ? "location" : undefined}
                className={cn(
                  "flex min-h-9 items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 focus-ring hover:bg-accent hover:text-accent-foreground",
                  on && "bg-brand-100 font-semibold text-brand-700 shadow-[inset_3px_0_0_var(--color-brand-500)] hover:bg-brand-100",
                )}
              >
                <span>{item.label}</span>
                {item.count !== undefined && (
                  <span
                    className={cn(
                      "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
                      COUNT_TONE[item.tone ?? "plain"],
                    )}
                  >
                    {item.count}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
