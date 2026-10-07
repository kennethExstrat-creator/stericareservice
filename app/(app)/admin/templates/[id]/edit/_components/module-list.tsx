"use client";

// The template's modules in report order (BUILD_SPEC 10: include switches,
// drag to reorder). Drag a row by its handle with a finger or the mouse; with
// the keyboard, focus the handle and use the arrow keys. Header and
// conclusion are always on, first and last. Modules the template does not
// use yet are listed underneath, to add.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronRightIcon, GripVerticalIcon, PinIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { ModuleKey } from "@/lib/schemas/module-result";
import { cn } from "@/lib/utils";
import { dropIndex, edgeScroll, stepAside, type RowBox } from "../_lib/drag";
import type { ModuleView } from "../_lib/model";

type ModuleListProps = {
  order: readonly ModuleKey[];
  viewOf: (key: ModuleKey) => ModuleView;
  unused: readonly ModuleKey[];
  titleOf: (key: ModuleKey) => string;
  stubs: ReadonlySet<ModuleKey>;
  selected: ModuleKey | null;
  problemCounts: ReadonlyMap<ModuleKey, number>;
  editable: boolean;
  onSelect: (key: ModuleKey) => void;
  onInclude: (key: ModuleKey, include: boolean) => void;
  onMove: (key: ModuleKey, to: number) => void;
  onAdd: (key: ModuleKey) => void;
};

type Drag = {
  key: ModuleKey;
  pointerId: number;
  from: number;
  startY: number;
  offset: number;
  target: number;
  rows: RowBox[];
  /** The dragged row's height and the gap under it: how far the others step aside. */
  distance: number;
};

const PINNED: ReadonlySet<ModuleKey> = new Set(["header", "conclusion"]);

/** A module's Edit button, where the focus goes back to when its details close. */
export function editModuleSelector(key: ModuleKey): string {
  return `[data-edit-module="${key}"]`;
}

export function ModuleList({
  order,
  viewOf,
  unused,
  titleOf,
  stubs,
  selected,
  problemCounts,
  editable,
  onSelect,
  onInclude,
  onMove,
  onAdd,
}: ModuleListProps) {
  const rowRefs = useRef(new Map<ModuleKey, HTMLLIElement>());
  const handleRefs = useRef(new Map<ModuleKey, HTMLButtonElement>());
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pointerY = useRef(0);
  const frame = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [showUnused, setShowUnused] = useState(false);
  const refocus = useRef<ModuleKey | null>(null);
  const first = order[0] === "header" ? 1 : 0;
  const last = order.at(-1) === "conclusion" ? order.length - 2 : order.length - 1;

  // Keyboard moves re-render the list; keep the focus on the handle that moved.
  useEffect(() => {
    if (refocus.current === null) return;
    handleRefs.current.get(refocus.current)?.focus();
    refocus.current = null;
  });

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const announceMove = (key: ModuleKey, to: number) =>
    setAnnouncement(`${titleOf(key)} moved to position ${to + 1} of ${order.length}.`);

  const moveBy = (key: ModuleKey, step: number) => {
    const from = order.indexOf(key);
    const to = Math.min(Math.max(from + step, first), last);
    if (to === from) return;
    refocus.current = key;
    onMove(key, to);
    announceMove(key, to);
  };

  const update = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const track = () => {
    const current = dragRef.current;
    if (!current) return;
    // Scroll near the edges; the top edge is under the sticky bars.
    const bars = document.querySelector('[data-slot="editor-bar"]')?.getBoundingClientRect().bottom ?? 0;
    const speed = edgeScroll(pointerY.current, bars, window.innerHeight);
    if (speed !== 0) window.scrollBy(0, speed);
    const offset = pointerY.current + window.scrollY - current.startY;
    const target = dropIndex(current.rows, current.from, offset, first, last);
    if (offset !== current.offset || target !== current.target) update({ ...current, offset, target });
    frame.current = requestAnimationFrame(track);
  };

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, key: ModuleKey) => {
    if (!editable || (event.pointerType === "mouse" && event.button !== 0)) return;
    const from = order.indexOf(key);
    const rows = order.map((entry) => {
      const box = rowRefs.current.get(entry)?.getBoundingClientRect();
      return { top: (box?.top ?? 0) + window.scrollY, height: box?.height ?? 0 };
    });
    const next = rows[from + 1] ?? rows[from - 1];
    const gap = next ? Math.abs(next.top - rows[from].top) - (next.top > rows[from].top ? rows[from].height : next.height) : 0;
    try {
      // Keeps the moves and the release coming to the handle while the finger or mouse travels.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    event.preventDefault();
    pointerY.current = event.clientY;
    update({
      key,
      pointerId: event.pointerId,
      from,
      startY: event.clientY + window.scrollY,
      offset: 0,
      target: from,
      rows,
      distance: rows[from].height + Math.max(gap, 0),
    });
    frame.current = requestAnimationFrame(track);
  };

  const endDrag = (commit: boolean) => {
    const current = dragRef.current;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    update(null);
    if (commit && current && current.target !== current.from) {
      onMove(current.key, current.target);
      announceMove(current.key, current.target);
    }
  };

  return (
    <div className="grid gap-6">
      <section aria-labelledby="modules-heading" className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="modules-heading" className="text-lg font-bold text-foreground">
            Modules
          </h2>
          <p className="text-sm text-muted-foreground">
            {order.filter((key) => viewOf(key).include).length} of {order.length} on
          </p>
        </div>
        {editable && (
          <p id="reorder-hint" className="text-sm text-muted-foreground">
            Drag a handle to reorder, or focus it and use the arrow keys. Header and conclusion stay first and last.
          </p>
        )}
        <ol className="grid gap-2" data-testid="module-list">
          {order.map((key, index) => {
            const view = viewOf(key);
            const pinned = PINNED.has(key);
            const dragging = drag?.key === key;
            const offset = drag ? (dragging ? drag.offset : stepAside(index, drag.from, drag.target, drag.distance)) : 0;
            const problems = problemCounts.get(key) ?? 0;
            const title = titleOf(key);
            return (
              <li
                key={key}
                ref={(element) => {
                  if (element) rowRefs.current.set(key, element);
                  else rowRefs.current.delete(key);
                }}
                data-module-key={key}
                data-included={view.include}
                data-selected={selected === key ? true : undefined}
                style={offset !== 0 ? { transform: `translateY(${offset}px)` } : undefined}
                className={cn(
                  "relative flex items-center gap-1 rounded-lg bg-card py-1 pr-2 pl-1 ring-1 ring-border",
                  drag && !dragging && "transition-transform",
                  dragging && "z-10 shadow-lg ring-2 ring-brand-500",
                  selected === key && !dragging && "bg-accent ring-brand-300",
                )}
              >
                {pinned || !editable ? (
                  <span className="flex size-9 shrink-0 items-center justify-center text-slate-500 touch:size-11" aria-hidden>
                    {pinned && <PinIcon className="size-4" />}
                  </span>
                ) : (
                  <button
                    type="button"
                    ref={(element) => {
                      if (element) handleRefs.current.set(key, element);
                      else handleRefs.current.delete(key);
                    }}
                    aria-label={`Move ${title}, position ${index + 1} of ${order.length}`}
                    aria-describedby="reorder-hint"
                    className={cn(
                      "flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-slate-500 hover:bg-muted hover:text-foreground focus-ring-inset touch:size-11",
                      dragging && "cursor-grabbing",
                    )}
                    onPointerDown={(event) => startDrag(event, key)}
                    onPointerMove={(event) => {
                      if (dragRef.current?.pointerId === event.pointerId) pointerY.current = event.clientY;
                    }}
                    onPointerUp={(event) => {
                      if (dragRef.current?.pointerId === event.pointerId) endDrag(true);
                    }}
                    onPointerCancel={() => endDrag(false)}
                    onLostPointerCapture={() => {
                      if (dragRef.current) endDrag(true);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                        event.preventDefault();
                        moveBy(key, event.key === "ArrowUp" ? -1 : 1);
                      } else if (event.key === "Home" || event.key === "End") {
                        event.preventDefault();
                        moveBy(key, event.key === "Home" ? -order.length : order.length);
                      }
                    }}
                  >
                    <GripVerticalIcon aria-hidden className="size-5" />
                  </button>
                )}

                <button
                  type="button"
                  data-edit-module={key}
                  onClick={() => onSelect(key)}
                  aria-current={selected === key ? "true" : undefined}
                  // The title it shows comes first in its name (WCAG 2.5.3).
                  aria-label={`${title}, edit`}
                  aria-describedby={`module-meta-${key}`}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/60 focus-ring-inset fine:min-h-9"
                >
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className={cn("text-sm leading-snug font-semibold text-balance", view.include ? "text-foreground" : "text-muted-foreground")}>
                      {title}
                    </span>
                    <span id={`module-meta-${key}`} className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="font-mono">{key}</span>
                      {!view.include && <Tag>Off</Tag>}
                      {stubs.has(key) && <Tag>Not Built Yet</Tag>}
                      {view.changed && <Tag tone="brand">Changed</Tag>}
                      {problems > 0 && <Tag tone="fail">{problems === 1 ? "1 Problem" : `${problems} Problems`}</Tag>}
                    </span>
                  </span>
                  <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-slate-500" />
                </button>

                <div className="flex shrink-0 items-center gap-2 pl-1">
                  {pinned && <span className="text-xs text-muted-foreground max-sm:sr-only">Always On</span>}
                  <Switch
                    checked={view.include}
                    disabled={pinned || !editable}
                    onCheckedChange={(checked) => onInclude(key, checked)}
                    aria-label={pinned ? `${title} is always on` : `Include ${title}`}
                  />
                </div>
              </li>
            );
          })}
        </ol>
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </section>

      {unused.length > 0 && (
        <section aria-labelledby="unused-heading" className="grid gap-3">
          <h2 id="unused-heading" className="text-base font-semibold text-foreground">
            <button
              type="button"
              aria-expanded={showUnused}
              aria-controls="unused-modules"
              onClick={() => setShowUnused(!showUnused)}
              className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 text-left hover:bg-muted focus-ring-inset fine:min-h-9"
            >
              <ChevronRightIcon aria-hidden className={cn("size-4 text-slate-500 transition-transform", showUnused && "rotate-90")} />
              Not in This Template
              <span className="font-normal text-muted-foreground">({unused.length})</span>
            </button>
          </h2>
          <ul id="unused-modules" hidden={!showUnused} className="grid gap-2" data-testid="unused-modules">
            {unused.map((key) => (
              <li
                key={key}
                data-module-key={key}
                className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-card py-1.5 pr-2 pl-3"
              >
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="text-sm font-semibold text-muted-foreground">{titleOf(key)}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="font-mono">{key}</span>
                    {stubs.has(key) && <Tag>Not Built Yet</Tag>}
                  </span>
                </span>
                {editable && (
                  <Button type="button" variant="outline" size="sm" onClick={() => onAdd(key)} aria-label={`Add ${titleOf(key)}`}>
                    <PlusIcon aria-hidden />
                    Add
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Tag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "brand" | "fail" }) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-px font-sans text-xs font-medium",
        tone === "neutral" && "bg-slate-100 text-slate-700",
        tone === "brand" && "bg-brand-50 text-brand-700",
        tone === "fail" && "bg-fail-tint text-fail",
      )}
    >
      {children}
    </span>
  );
}
