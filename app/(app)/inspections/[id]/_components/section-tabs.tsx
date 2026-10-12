"use client";

// The section tabs of the capture screen below 1280 px (BUILD_SPEC 8: on the
// iPad, modules show as a top tab bar). One tab per page
// (lib/inspections/capture/sections.ts capturePages) with its result chip:
// a section, or a module with the modules shown on its page (packing
// configuration on the order's tab), named by the first's short name, its
// full title on hover (docs/DESIGN.md, Step Names). Then the sections an
// admin switched off for this inspection, marked off. The bar scrolls
// sideways; the page never does. WAI-ARIA tabs with automatic activation:
// arrow keys, Home and End move between tabs and open the page.
import { useEffect, useRef, type KeyboardEvent } from "react";
import { CircleOffIcon } from "lucide-react";
import { ResultChip } from "@/components/qc";
import { isStepPage, pageSectionKeys, type CapturePage } from "@/lib/inspections/capture/sections";
import { cn } from "@/lib/utils";

type SectionTabsProps = {
  pages: readonly CapturePage[];
  /** The open page's key. */
  activeKey: string;
  onSelect: (key: string) => void;
  /** The id of the section panel the tabs control. */
  panelId: string;
  /** Prefix for tab ids, so the panel can name its tab. */
  idPrefix: string;
  className?: string;
};

export function tabId(prefix: string, key: string): string {
  return `${prefix}-tab-${key}`;
}

/** Arrow keys, Home and End over a row of `count` tabs, wrapping. Null for any other key. */
export function nextTabIndex(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowRight":
      return (index + 1) % count;
    case "ArrowLeft":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

export function SectionTabs({ pages, activeKey, onSelect, panelId, idPrefix, className }: SectionTabsProps) {
  const ordered = [...pages.filter(isStepPage), ...pages.filter((page) => !isStepPage(page))];
  // A section switched off moves to the end of the bar: its tab must stay in view there too.
  const order = ordered.map((page) => page.key).join(" ");
  const scroller = useRef<HTMLDivElement>(null);
  const tabs = useRef(new Map<string, HTMLButtonElement>());

  // Keep the active tab in view when the bar scrolls sideways, without
  // scrolling the page (scrollIntoView would).
  useEffect(() => {
    const bar = scroller.current;
    const tab = tabs.current.get(activeKey);
    if (!bar || !tab || bar.scrollWidth <= bar.clientWidth) return;
    const left = tab.getBoundingClientRect().left - bar.getBoundingClientRect().left + bar.scrollLeft;
    if (left < bar.scrollLeft) bar.scrollLeft = Math.max(0, left - 16);
    else if (left + tab.offsetWidth > bar.scrollLeft + bar.clientWidth) {
      bar.scrollLeft = left + tab.offsetWidth - bar.clientWidth + 16;
    }
  }, [activeKey, order]);

  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextTabIndex(event.key, index, ordered.length);
    if (next === null) return;
    event.preventDefault();
    const key = ordered[next].key;
    tabs.current.get(key)?.focus();
    if (key !== activeKey) onSelect(key);
  };

  const firstExcluded = ordered.findIndex((page) => !isStepPage(page));

  return (
    <div
      ref={scroller}
      data-slot="section-tabs"
      className={cn("relative min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]", className)}
    >
      <div role="tablist" aria-label="Sections" aria-orientation="horizontal" className="flex w-max items-stretch">
        {ordered.map((page, index) => {
          const selected = page.key === activeKey;
          const excluded = !isStepPage(page);
          return (
            <button
              key={page.key}
              ref={(element) => {
                if (element) tabs.current.set(page.key, element);
                else tabs.current.delete(page.key);
              }}
              type="button"
              role="tab"
              id={tabId(idPrefix, page.key)}
              aria-selected={selected}
              aria-controls={selected ? panelId : undefined}
              tabIndex={selected ? 0 : -1}
              title={page.title}
              data-section={page.key}
              // Every section on the page, so a module's tab is found by its key ([data-sections~=packing_config]).
              data-sections={pageSectionKeys(page).join(" ")}
              data-active={selected || undefined}
              data-excluded={excluded || undefined}
              onClick={() => page.key !== activeKey && onSelect(page.key)}
              onKeyDown={onKeyDown(index)}
              className={cn(
                "relative inline-flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap outline-none transition-colors focus-ring-inset touch:h-11",
                selected
                  ? "border-brand-500 font-semibold text-foreground"
                  : "border-transparent font-medium text-muted-foreground hover:text-foreground",
                index === firstExcluded && "ml-2 border-l border-l-border pl-4",
              )}
            >
              {excluded && <CircleOffIcon aria-hidden className="size-4 shrink-0 text-slate-500" />}
              <span className="max-w-56 truncate">{page.shortTitle}</span>
              {page.kind === "documents" ? (
                <ResultChip status={page.status} label={page.status === "pass" ? "Steri-AI Verified" : "Not read yet"} />
              ) : isStepPage(page) ? (
                <ResultChip status={page.status} />
              ) : (
                <span className="sr-only">, switched off for this inspection</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
