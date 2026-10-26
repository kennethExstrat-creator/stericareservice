"use client";

// A module's own controls in its card's header, beside the result (Kenneth,
// 26 October 2026: the Sampling Plan's "Auto Calculate Sampling" on the top
// right of the card). The capture screen's frame (section-frame.tsx) gives
// its header's slot through ModuleHeaderSlot, and the controls are portalled
// there once it has mounted: none in the server's markup, so nothing jumps
// from the body to the header. Outside a frame (a test, the design page) they
// sit at the top of the body, on the right.
import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** The frame's header slot: `framed` while a frame holds the module, `slot` once its header has mounted. */
export const ModuleHeaderSlot = createContext<{ framed: boolean; slot: HTMLElement | null }>({ framed: false, slot: null });

export function ModuleHeaderActions({ children }: { children: ReactNode }) {
  const { framed, slot } = useContext(ModuleHeaderSlot);
  if (slot) return createPortal(children, slot);
  if (framed) return null;
  return <div className="flex flex-wrap justify-end gap-2">{children}</div>;
}
