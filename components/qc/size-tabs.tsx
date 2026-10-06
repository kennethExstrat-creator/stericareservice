"use client";

// Size tabs for per-size modules (BUILD_SPEC 6.2 rule 4 and 8 "Speed"): one
// tab per ordered size with its result, in a bar that sticks to the top of
// the module body (below the screen's own bars: --capture-sticky-top).
// Arrow keys, Home and End move between tabs (WAI-ARIA tabs, automatic
// activation). On touch a horizontal swipe on the panel turns to the next or
// previous size while vertical scrolling stays native; a swipe never starts
// in the field being edited, and a half-typed value elsewhere is stored for
// its own size before the panel changes. Controlled: the module owns the
// active size. With wide="all" the tab bar hides from 1280 px and every size
// shows side by side instead. SizeStatusStrip is the compact form for
// summary rows.
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import type { Status } from "@/lib/design/status";
import { formatSize, type SizeOption } from "@/lib/format";
import { ResultChip } from "./result-chip";
import { rovingIndex } from "./roving";
import { NO_SWIPE_SELECTOR, stepValue, swipeStep, type SwipePoint } from "./swipe";

/** A result as a status, or a per-size result from calc (`evaluation.result.perSize`). */
export type ResultLike = Status | { readonly status: Status; readonly summary?: string };
export type SizeResults = Readonly<Record<string, ResultLike | undefined>>;

function statusOf(result: ResultLike | undefined): Status {
  if (result === undefined) return "not_done";
  return typeof result === "string" ? result : result.status;
}

type SizeTabsProps = {
  /** Ordered sizes, canonical, in template order (`context.sizes`). */
  sizes: readonly string[];
  value: string;
  onValueChange: (size: string) => void;
  /** The template's sizes (`context.templateSizes`), for labels such as "Medium". */
  templateSizes?: readonly SizeOption[];
  /** A result chip per size; a size without an entry shows "Not done". Omit for no chips. */
  results?: SizeResults;
  /** Accessible name of the tab list. */
  label?: string;
  /** "tabs" keeps tabs at every width; "all" shows every size side by side from 1280 px. */
  wide?: "tabs" | "all";
  /** Turn sizes with a horizontal swipe on touch. */
  swipe?: boolean;
  /** Controls at the end of the sticky bar, e.g. a HandToggle. */
  actions?: ReactNode;
  /**
   * The panel. A function renders one size (all sizes side by side with
   * wide="all"); a node is shown as is, e.g. a CounterTable given
   * `activeColumn`. Keep content inside so the bar stays stuck over it.
   */
  children?: ReactNode | ((size: string) => ReactNode);
  /** Shown instead of tabs while no size is ordered (BUILD_SPEC 6.2 rule 4). */
  emptyMessage?: ReactNode;
  className?: string;
  panelClassName?: string;
};

export function SizeTabs({
  sizes,
  value,
  onValueChange,
  templateSizes,
  results,
  label = "Sizes",
  wide = "tabs",
  swipe = true,
  actions,
  children,
  emptyMessage = "No sizes ordered yet. Add them to the order table first.",
  className,
  panelClassName,
}: SizeTabsProps) {
  const baseId = useId();
  const tabId = (index: number) => `${baseId}-tab-${index}`;
  const panelId = (index: number) => `${baseId}-panel-${index}`;
  // A value that is no longer ordered falls back to the first size.
  const activeIndex = Math.max(0, sizes.indexOf(value));
  const current = sizes[activeIndex];
  const sizeText = (size: string) => formatSize(size, { sizes: templateSizes });

  const scrollerRef = useRef<HTMLDivElement>(null);
  const tabs = useRef(new Map<number, HTMLButtonElement>());
  const gesture = useRef<{ pointerId: number; start: SwipePoint } | null>(null);
  // When a swipe ended: the click its lifted finger may still produce is not a press.
  const swipedAt = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // Keep the active tab in view when the bar scrolls sideways, without
  // scrolling the page (scrollIntoView would).
  useEffect(() => {
    const scroller = scrollerRef.current;
    const tab = tabs.current.get(activeIndex);
    if (!scroller || !tab || scroller.scrollWidth <= scroller.clientWidth) return;
    const left = tab.offsetLeft - scroller.offsetLeft;
    if (left < scroller.scrollLeft) scroller.scrollLeft = left - 8;
    else if (left + tab.offsetWidth > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollLeft = left + tab.offsetWidth - scroller.clientWidth + 8;
    }
  }, [activeIndex]);

  const onTabKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = rovingIndex(event.key, index, sizes.length);
    if (next === null) return;
    event.preventDefault();
    tabs.current.get(next)?.focus();
    if (sizes[next] !== current) onValueChange(sizes[next]);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // Any new press is a real one.
    swipedAt.current = null;
    if (!swipe || event.pointerType === "mouse" || !event.isPrimary) return;
    const target = event.target;
    if (target instanceof Element && target.closest(NO_SWIPE_SELECTOR)) return;
    // A drag in the field being edited belongs to its text.
    if (target instanceof HTMLInputElement && target === document.activeElement) return;
    gesture.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY, time: event.timeStamp },
    };
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const started = gesture.current;
    gesture.current = null;
    if (!started || started.pointerId !== event.pointerId) return;
    const step = swipeStep(started.start, { x: event.clientX, y: event.clientY, time: event.timeStamp });
    const next = stepValue(sizes, current, step);
    if (next === null) return;
    swipedAt.current = event.timeStamp;
    // Leave the field in focus first: a half-typed value is stored for the
    // size it was typed for, before that size's panel goes.
    const active = document.activeElement;
    if (active instanceof HTMLElement && event.currentTarget.contains(active)) active.blur();
    onValueChange(next);
    setAnnouncement(`Size ${sizeText(next)}`);
  };

  const swipeHandlers = {
    onPointerDownCapture: onPointerDown,
    onPointerUp,
    onPointerCancel: () => {
      gesture.current = null;
    },
    // The finger that ends a swipe on a button must not also press it: drop a
    // pointer click that follows the swipe before any new press. Keyboard
    // clicks (detail 0) always go through.
    onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
      const swiped = swipedAt.current;
      swipedAt.current = null;
      if (swiped === null || event.detail === 0 || event.timeStamp - swiped > 600) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };

  const hideTabsWhenWide = wide === "all";

  if (sizes.length === 0 || current === undefined) {
    return (
      <div data-slot="size-tabs" className={cn("min-w-0", className)}>
        <p className="rounded-lg border border-dashed border-not-done-border bg-not-done-tint px-4 py-3 text-sm text-not-done touch:text-base">
          {emptyMessage}
        </p>
      </div>
    );
  }

  let panels: ReactNode = null;
  if (typeof children === "function") {
    panels =
      wide === "all" ? (
        <div className="min-w-0 xl:grid xl:grid-cols-[repeat(auto-fit,minmax(18rem,1fr))] xl:gap-6">
          {sizes.map((size, index) => (
            <div
              key={size}
              role="tabpanel"
              id={panelId(index)}
              aria-labelledby={tabId(index)}
              data-active={size === current || undefined}
              className={cn("min-w-0 space-y-3", size !== current && "max-xl:hidden", panelClassName)}
            >
              <p className="hidden font-display text-base font-semibold text-foreground xl:block">
                Size {sizeText(size)}
              </p>
              {children(size)}
            </div>
          ))}
        </div>
      ) : (
        // Keyed by size: a half-typed cell never carries over to the next size.
        <div
          key={current}
          role="tabpanel"
          id={panelId(activeIndex)}
          aria-labelledby={tabId(activeIndex)}
          className={cn("min-w-0", panelClassName)}
        >
          {children(current)}
        </div>
      );
  } else if (children !== undefined && children !== null && children !== false) {
    panels = (
      <div
        role="tabpanel"
        id={panelId(activeIndex)}
        aria-labelledby={tabId(activeIndex)}
        className={cn("min-w-0", panelClassName)}
      >
        {children}
      </div>
    );
  }

  return (
    <div data-slot="size-tabs" className={cn("min-w-0 space-y-4", className)}>
      <div
        data-slot="size-tabs-bar"
        className={cn(
          "sticky top-[var(--capture-sticky-top,0px)] z-20 flex items-center gap-3 border-b border-border bg-card py-2",
          hideTabsWhenWide && !actions && "xl:hidden",
        )}
      >
        <div
          ref={scrollerRef}
          className={cn("relative min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]", hideTabsWhenWide && "xl:hidden")}
        >
          <div
            role="tablist"
            aria-label={label}
            aria-orientation="horizontal"
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted p-1"
          >
            {sizes.map((size, index) => {
              const selected = index === activeIndex;
              const status = results ? statusOf(results[size]) : null;
              return (
                <button
                  key={size}
                  ref={(element) => {
                    if (element) tabs.current.set(index, element);
                    else tabs.current.delete(index);
                  }}
                  type="button"
                  role="tab"
                  id={tabId(index)}
                  aria-selected={selected}
                  aria-controls={panels ? panelId(index) : undefined}
                  tabIndex={selected ? 0 : -1}
                  data-active={selected || undefined}
                  data-size={size}
                  onClick={() => size !== current && onValueChange(size)}
                  onKeyDown={onTabKeyDown(index)}
                  className={cn(
                    "inline-flex h-8 min-w-12 shrink-0 items-center justify-center gap-2 rounded-full px-3 text-sm font-semibold whitespace-nowrap tabular-nums outline-none transition-colors",
                    "text-slate-700 hover:bg-card hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                    "data-active:bg-primary data-active:text-primary-foreground data-active:shadow-sm data-active:hover:bg-brand-600",
                    "touch:h-11 touch:min-w-14 touch:px-4 touch:text-base",
                  )}
                >
                  <span className="sr-only">Size </span>
                  {sizeText(size)}
                  {status && (
                    <>
                      <span className="sr-only">, </span>
                      <ResultChip status={status} className="size-4 ring-2 ring-card touch:size-5" />
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </div>

      {panels && (
        <div data-slot="size-tabs-panels" className="min-w-0 touch-pan-y touch-pinch-zoom" {...swipeHandlers}>
          {panels}
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

type SizeStatusStripProps = {
  sizes: readonly string[];
  results?: SizeResults;
  templateSizes?: readonly SizeOption[];
  /** Makes each size a button, e.g. to open the module at that size. */
  onSelect?: (size: string) => void;
  /** Accessible name of the list. */
  label?: string;
  className?: string;
};

/** Sizes with their result chips in one compact row, for summaries and module lists. */
export function SizeStatusStrip({
  sizes,
  results,
  templateSizes,
  onSelect,
  label = "Results by size",
  className,
}: SizeStatusStripProps) {
  const pill =
    "inline-flex h-6 items-center gap-1 rounded-full border border-border bg-card py-0.5 pr-0.5 pl-2 text-xs font-semibold text-foreground tabular-nums touch:h-7 touch:text-sm";
  return (
    <ul aria-label={label} data-slot="size-status-strip" className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {sizes.map((size) => {
        const status = statusOf(results?.[size]);
        const content = (
          <>
            {formatSize(size, { sizes: templateSizes })}
            <span className="sr-only">: </span>
            <ResultChip status={status} className="size-4 touch:size-5" />
          </>
        );
        return (
          <li key={size} data-status={status}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(size)}
                className={cn(
                  pill,
                  "outline-none hover:border-primary hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 touch:h-11 touch:pr-1.5 touch:pl-3",
                )}
              >
                <span className="sr-only">Size </span>
                {content}
              </button>
            ) : (
              <span className={pill}>
                <span className="sr-only">Size </span>
                {content}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
