"use client";

// Dragging a row of Source Documents' Media to another category, with
// pointer events, so a mouse, a finger and a pen drag alike: press the row's
// grip and move 6 px, and a ghost of the row follows the pointer while the
// category under it lights up; let go over another category to move the row
// there. Escape, or letting go anywhere else, leaves it where it was. The
// grip has touch-action: none, so a finger on it drags instead of scrolling;
// near the window's top or bottom the page scrolls by itself. A press that
// never moves is a click: the grip's Move To menu (media-rows.tsx).
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { edgeScroll, sectionAt, type Box, type MediaItem, type MediaSectionId } from "./media-board";

/** How far the pointer moves before a press on the grip is a drag. */
const DRAG_THRESHOLD_PX = 6;

export type MediaDrag = {
  item: MediaItem;
  /** The section under the pointer; null over none. */
  over: MediaSectionId | null;
  /** The row's width, for the ghost. */
  width: number;
};

/** Where the ghost goes: the pointer, less where on the row it took hold. */
type Place = { x: number; y: number; grabX: number; grabY: number };

function moveGhost(node: HTMLElement | null, { x, y, grabX, grabY }: Place): void {
  if (node) node.style.transform = `translate3d(${x - grabX}px, ${y - grabY}px, 0)`;
}

/** Where the page's sticky bars end: the capture screen keeps the page's scroll padding at their height (use-sticky-offsets.ts). */
function stickyTop(): number {
  return Number.parseFloat(document.documentElement.style.scrollPaddingTop) || 0;
}

/** The grabbing cursor everywhere and no text selection while a row is dragged; gives back what it changed. */
function grabbing(): () => void {
  const style = document.documentElement.style;
  const before = { cursor: style.cursor, select: style.userSelect, webkit: style.getPropertyValue("-webkit-user-select") };
  style.cursor = "grabbing";
  style.userSelect = "none";
  style.setProperty("-webkit-user-select", "none");
  return () => {
    style.cursor = before.cursor;
    style.userSelect = before.select;
    style.setProperty("-webkit-user-select", before.webkit);
  };
}

export function useMediaDrag({
  boxes,
  onDrop,
}: {
  /** Where each section is on screen now. */
  boxes: () => Iterable<readonly [MediaSectionId, Box]>;
  onDrop: (item: MediaItem, to: MediaSectionId) => void;
}) {
  const [drag, setDrag] = useState<MediaDrag | null>(null);
  const latest = useRef({ boxes, onDrop });
  useEffect(() => {
    latest.current = { boxes, onDrop };
  });
  const place = useRef<Place>({ x: 0, y: 0, grabX: 0, grabY: 0 });
  const ghostNode = useRef<HTMLElement | null>(null);
  /** Ends the drag in progress without a drop. */
  const cancel = useRef<(() => void) | null>(null);
  /** The press just ended a drag: the click it may fire opens no menu. */
  const dragged = useRef(false);

  useEffect(() => () => cancel.current?.(), []);

  /** The ghost's ref: put under the pointer as it mounts, then moved without a render. */
  const ghost = useCallback((node: HTMLElement | null) => {
    ghostNode.current = node;
    moveGhost(node, place.current);
  }, []);

  /** pointerdown on a row's grip. */
  const press = useCallback((item: MediaItem, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    // Radix opens the grip's menu on pointerdown; the click opens it instead, once the press is no drag.
    event.preventDefault();
    cancel.current?.();
    dragged.current = false;
    const grip = event.currentTarget;
    const pointerId = event.pointerId;
    const row = (grip.closest('[data-slot="media-row"]') ?? grip).getBoundingClientRect();
    const origin = { x: event.clientX, y: event.clientY };
    place.current = { ...origin, grabX: origin.x - row.left, grabY: origin.y - row.top };
    try {
      // Every move and the release come here, also from outside the window.
      grip.setPointerCapture(pointerId);
    } catch {
      // The window's own events still follow the pointer.
    }

    let dragging = false;
    let over: MediaSectionId | null = null;
    let frame = 0;
    let restore: (() => void) | null = null;

    const track = () => {
      // Over the sticky bars, the section scrolled under them is out of sight: no drop there.
      const next = place.current.y < stickyTop() ? null : sectionAt(place.current, latest.current.boxes());
      if (next === over) return;
      over = next;
      setDrag((current) => (current ? { ...current, over: next } : current));
    };
    // Every frame: near an edge the page scrolls a step, and the sections move under the pointer.
    const tick = () => {
      const step = edgeScroll(place.current.y, stickyTop(), window.innerHeight);
      if (step !== 0) window.scrollBy(0, step);
      track();
      frame = requestAnimationFrame(tick);
    };
    const onMove = (moved: PointerEvent) => {
      if (moved.pointerId !== pointerId) return;
      place.current = { ...place.current, x: moved.clientX, y: moved.clientY };
      if (!dragging) {
        if (Math.hypot(moved.clientX - origin.x, moved.clientY - origin.y) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        dragged.current = true;
        restore = grabbing();
        setDrag({ item, over: null, width: row.width });
        track();
        frame = requestAnimationFrame(tick);
      }
      moved.preventDefault();
      moveGhost(ghostNode.current, place.current);
    };
    const finish = (drop: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      cancelAnimationFrame(frame);
      restore?.();
      cancel.current = null;
      if (!dragging) return;
      // Where it was let go, not where the last frame saw it.
      if (drop) track();
      setDrag(null);
      // A click this release fires is no request for the menu; a later one is.
      setTimeout(() => {
        dragged.current = false;
      }, 0);
      if (drop && over !== null && over !== item.section) latest.current.onDrop(item, over);
    };
    const onUp = (up: PointerEvent) => {
      if (up.pointerId !== pointerId) return;
      place.current = { ...place.current, x: up.clientX, y: up.clientY };
      finish(true);
    };
    const onCancel = (cancelled: PointerEvent) => {
      if (cancelled.pointerId === pointerId) finish(false);
    };
    const onKey = (key: KeyboardEvent) => {
      if (key.key !== "Escape" || !dragging) return;
      key.preventDefault();
      key.stopPropagation();
      finish(false);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    cancel.current = () => finish(false);
  }, []);

  /** For the grip's click: true when it ends a drag. */
  const endedDrag = useCallback(() => dragged.current, []);

  return { drag, ghost, press, endedDrag };
}
