"use client";

// Files dragged in from the desktop or another app onto a drop area: Media's
// categories and Auto-Sort on the capture screen (source-media.tsx), and New
// Inspection's Source Documents card. Links, text and Media's own rows are
// ignored. `dragging` is true while files are over it, so it can say where
// they go.
import { useRef, useState, type DragEvent } from "react";

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export function useFileDrop(onFiles: (files: readonly File[]) => void, enabled: boolean) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  if (!enabled) return { dragging: false, handlers: {} };
  return {
    dragging,
    handlers: {
      onDragEnter: (event: DragEvent) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        setDragging(true);
      },
      onDragOver: (event: DragEvent) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      },
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      },
      onDrop: (event: DragEvent) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) onFiles(files);
      },
    },
  };
}
