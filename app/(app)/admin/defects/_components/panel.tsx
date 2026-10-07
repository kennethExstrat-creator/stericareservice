"use client";

// The side panel that adds or edits one code. The same pattern as the
// manufacturers and clients panels (app/(app)/admin/manufacturers/_components/
// reference-panel.tsx); this branch owns only the defects route, so it keeps
// its own copy until a shared components/admin/ exists.

import { useCallback, useRef, useState, type ReactNode, type RefObject } from "react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { COARSE_QUERY } from "@/components/qc";

/** What the panel shows: a new code (possibly filled in from a link), or the code being edited. */
export type PanelTarget = { mode: "create"; prefill?: { code: string; name: string } } | { mode: "edit"; code: string };

type PanelState = { key: number; open: boolean; target: PanelTarget };

/**
 * Focuses the first element that is still on the page and can take the
 * focus; false when none could. For dialogs that open from code: Radix puts
 * the focus back only on a Trigger, so without one it would land on <body>.
 */
export function focusFirst(candidates: ReadonlyArray<HTMLElement | null | undefined>): boolean {
  for (const element of candidates) {
    if (!element?.isConnected || element.matches(":disabled")) continue;
    element.focus();
    if (document.activeElement === element) return true;
  }
  return false;
}

/**
 * Open and close state for the panel. Every opening gets a new `key`, so the
 * form inside starts fresh (its fields, its errors).
 *
 * `show` takes the button the panel opened from (a row's Edit button, also
 * for a click on the row, or an Add button), and `returnFocus` puts the
 * keyboard back on it when the panel closes. When that button has gone (its
 * code was deleted, or no longer matches the search) the focus goes to
 * `fallback`, the page's Add code button. A panel open from the start (a
 * link that fills in a new code) has no opener: it goes to the fallback.
 */
export function usePanel(fallback: RefObject<HTMLElement | null>, initial: PanelTarget | null = null) {
  const [state, setState] = useState<PanelState>({
    key: 0,
    open: initial !== null,
    target: initial ?? { mode: "create" },
  });
  const opener = useRef<HTMLElement | null>(null);
  const show = useCallback((target: PanelTarget, from: HTMLElement | null) => {
    opener.current = from;
    setState((current) => ({ key: current.key + 1, open: true, target }));
  }, []);
  const close = useCallback(() => setState((current) => ({ ...current, open: false })), []);
  /** After a delete: the row goes, and with it the Edit button the panel may have opened from. */
  const closeDeleted = useCallback(() => {
    opener.current = null;
    close();
  }, [close]);
  const returnFocus = useCallback(() => {
    focusFirst([opener.current, fallback.current]);
  }, [fallback]);
  return { ...state, show, close, closeDeleted, returnFocus };
}

type PanelProps = {
  open: boolean;
  /** While a save runs, the panel stays open so its outcome is seen. */
  busy: boolean;
  onClose: () => void;
  /** Puts the keyboard back where the panel opened from, once it has closed (usePanel's returnFocus). */
  returnFocus: () => void;
  title: string;
  description: ReactNode;
  children: ReactNode;
  footer: ReactNode;
};

/**
 * A panel from the right: the list stays in view on desktop. Header, a body
 * that scrolls, and a footer with the form's buttons that never scrolls away.
 * With a mouse the first field takes the focus; on touch the panel itself,
 * so the keyboard does not cover it before anyone asked to type. However it
 * closes (Escape, Close, the corner button, a save or a delete), the focus
 * goes back to where it opened from.
 */
export function Panel({ open, busy, onClose, returnFocus, title, description, children, footer }: PanelProps) {
  const contentRef = useRef<HTMLDivElement>(null);

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
          const content = contentRef.current;
          const field = window.matchMedia(COARSE_QUERY).matches
            ? null
            : content?.querySelector<HTMLElement>("input:not([type='hidden']):not([readonly]), textarea");
          (field ?? content)?.focus();
        }}
        onCloseAutoFocus={(event) => {
          // Radix would focus a Trigger, and this panel opens from code.
          event.preventDefault();
          returnFocus();
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
