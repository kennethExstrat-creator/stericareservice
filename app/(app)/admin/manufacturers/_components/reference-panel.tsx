"use client";

// Shared by /admin/manufacturers and /admin/clients: the side panel that adds
// or edits one row. It lives with the manufacturers page because this branch
// owns only the two route folders; move it to components/admin/ when handy.

import { useCallback, useRef, useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** What the panel shows: a new row, or the row with this id. */
export type PanelTarget = { mode: "create" } | { mode: "edit"; id: string };

type PanelState = { key: number; open: boolean; target: PanelTarget };

/**
 * Open and close state for the panel. Every opening gets a new `key`, so the
 * form inside starts fresh (its fields, its errors); `retarget` keeps the
 * form as it is, for a new row that stays open to be edited further.
 */
export function usePanel() {
  const [state, setState] = useState<PanelState>({ key: 0, open: false, target: { mode: "create" } });
  const show = useCallback((target: PanelTarget) => {
    setState((current) => ({ key: current.key + 1, open: true, target }));
  }, []);
  const close = useCallback(() => setState((current) => ({ ...current, open: false })), []);
  const retarget = useCallback((target: PanelTarget) => setState((current) => ({ ...current, target })), []);
  return { ...state, show, close, retarget };
}

type ReferencePanelProps = {
  open: boolean;
  /** While a save, upload or delete runs, the panel stays open so its outcome is seen. */
  busy: boolean;
  onClose: () => void;
  title: string;
  description: ReactNode;
  children: ReactNode;
  footer: ReactNode;
};

/**
 * A panel from the right: the list stays in view on desktop. Header, a body
 * that scrolls, and a footer with the form's buttons that never scrolls away.
 *
 * With a mouse the first field takes the focus, its text left unselected so
 * a keystroke cannot wipe a saved name. On touch the panel itself takes it,
 * so the keyboard does not cover the panel before anyone asked to type.
 */
export function ReferencePanel({ open, busy, onClose, title, description, children, footer }: ReferencePanelProps) {
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
        className="gap-0 outline-none data-[side=right]:w-full data-[side=right]:sm:max-w-md data-[side=right]:xl:max-w-lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const content = contentRef.current;
          const field = window.matchMedia("(pointer: coarse)").matches
            ? null
            : content?.querySelector<HTMLElement>("input:not([type='hidden']):not([type='file']), textarea");
          (field ?? content)?.focus();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <SheetHeader className="gap-1.5 border-b border-border px-6 pt-6 pb-5 pr-16">
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

/** A titled part of the panel body below the form: the logo, deleting. */
export function PanelSection({
  title,
  titleId,
  children,
}: {
  title: string;
  titleId: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={titleId} className="mt-6 flex flex-col gap-3 border-t border-border pt-5">
      <h3 id={titleId} className="text-base font-semibold text-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}
