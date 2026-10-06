"use client";

// The side panel that adds or edits one code. The same pattern as the
// manufacturers and clients panels (branch phase2/s-refdata); this branch
// owns only the defects route, so it keeps its own copy until a shared
// components/admin/ exists.

import { useCallback, useRef, useState, type ReactNode, type RefObject } from "react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * The app shell's <main> (MAIN_CONTENT_ID in components/shell/app-shell.tsx,
 * focusable with tabIndex -1). Not imported: that module is server-side and
 * would bring the shell's nav config into the browser.
 */
export const MAIN_CONTENT_ID = "main-content";

/** Focus `element` if it is still on the page, else the page's main area. */
export function focusOrMain(element: HTMLElement | null | undefined): void {
  const target = element?.isConnected && element !== document.body ? element : document.getElementById(MAIN_CONTENT_ID);
  target?.focus();
}

/** What the panel shows: a new code (possibly filled in from a link), or the code being edited. */
export type PanelTarget = { mode: "create"; prefill?: { code: string; name: string } } | { mode: "edit"; code: string };

type PanelState = { key: number; open: boolean; target: PanelTarget };

/**
 * Open and close state for the panel. Every opening gets a new `key`, so the
 * form inside starts fresh (its fields, its errors).
 */
export function usePanel(initial: PanelTarget | null = null) {
  const [state, setState] = useState<PanelState>({
    key: 0,
    open: initial !== null,
    target: initial ?? { mode: "create" },
  });
  const show = useCallback((target: PanelTarget) => {
    setState((current) => ({ key: current.key + 1, open: true, target }));
  }, []);
  const close = useCallback(() => setState((current) => ({ ...current, open: false })), []);
  return { ...state, show, close };
}

type PanelProps = {
  open: boolean;
  /** While a save runs, the panel stays open so its outcome is seen. */
  busy: boolean;
  onClose: () => void;
  /**
   * True when what opened the panel is about to leave the page (its row was
   * deleted): the focus then goes to the page instead of to it.
   */
  openerGone?: RefObject<boolean>;
  title: string;
  description: ReactNode;
  children: ReactNode;
  footer: ReactNode;
};

/**
 * A panel from the right: the list stays in view on desktop. Header, a body
 * that scrolls, and a footer with the form's buttons that never scrolls away.
 * With a mouse the first field takes the focus; on touch the panel itself,
 * so the keyboard does not cover it before anyone asked to type. Closing
 * gives the focus back to what opened the panel, or to the page when that is
 * gone (a deleted code's row).
 */
export function Panel({ open, busy, onClose, openerGone, title, description, children, footer }: PanelProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <SheetContent
        ref={contentRef}
        side="right"
        aria-busy={busy || undefined}
        data-testid="defect-code-panel"
        className="gap-0 outline-none data-[side=right]:w-full data-[side=right]:sm:max-w-md data-[side=right]:xl:max-w-lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          const content = contentRef.current;
          const field = window.matchMedia("(pointer: coarse)").matches
            ? null
            : content?.querySelector<HTMLElement>("input:not([type='hidden']):not([readonly]), textarea");
          (field ?? content)?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          focusOrMain(openerGone?.current ? null : openerRef.current);
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <SheetHeader className="gap-1.5 border-b border-border px-6 pt-6 pr-16 pb-5">
          <SheetTitle className="text-xl font-bold">{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">{children}</div>
        <SheetFooter className="mt-0 flex-row flex-wrap justify-end gap-2 border-t border-border px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {footer}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * A titled part of the panel body below the form: the status, deleting.
 * Relative, so screen-reader-only text inside stays anchored in the scroller.
 */
export function PanelSection({ title, titleId, children }: { title: string; titleId: string; children: ReactNode }) {
  return (
    <section aria-labelledby={titleId} className="relative mt-6 flex flex-col gap-3 border-t border-border pt-5">
      <h3 id={titleId} className="text-base font-semibold text-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}
