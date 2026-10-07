"use client";

// Sticky in-page index. Below 1280 px it is a scrolling bar under the header;
// from 1280 px it is a sidebar, the same split the app shell uses.
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { SECTIONS, type SectionId } from "./sections";

export function DesignIndex({ variant, className }: { variant: "bar" | "sidebar"; className?: string }) {
  const [active, setActive] = useState<SectionId>(SECTIONS[0].id);
  const links = useRef(new Map<string, HTMLAnchorElement>());

  // Highlight the section crossing the upper part of the viewport.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length > 0) setActive(visible[0].target.id as SectionId);
      },
      { rootMargin: "-15% 0px -75% 0px" },
    );
    for (const { id } of SECTIONS) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, []);

  // Keep the active link in view inside the horizontal bar.
  useEffect(() => {
    if (variant === "bar") links.current.get(active)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, variant]);

  return (
    <nav
      aria-label="Sections"
      className={cn(
        variant === "bar"
          ? "sticky top-0 z-30 border-b border-border bg-card"
          : "sticky top-0 max-h-svh overflow-y-auto px-3 py-8",
        className,
      )}
    >
      {variant === "sidebar" && (
        <p className="px-3 pb-3 text-xs font-bold tracking-[0.2em] text-brand-600 uppercase">On This Page</p>
      )}
      <ul
        className={cn(
          variant === "bar" ? "no-scrollbar flex gap-1 overflow-x-auto px-4 py-2 md:px-6" : "space-y-0.5",
        )}
      >
        {SECTIONS.map(({ id, label }) => (
          <li key={id} className="shrink-0">
            <a
              ref={(element) => {
                if (element) links.current.set(id, element);
                else links.current.delete(id);
              }}
              href={`#${id}`}
              aria-current={active === id ? "location" : undefined}
              className={cn(
                "flex items-center rounded-full px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-ring-inset",
                "aria-[current=location]:bg-accent aria-[current=location]:text-accent-foreground",
                variant === "bar" ? "h-9 whitespace-nowrap touch:h-11" : "h-9 rounded-md touch:h-11",
              )}
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
