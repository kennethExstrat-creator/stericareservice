"use client";

// Wraps a part of the shell whose links leave the page (the top bar, the
// sidebar, the admin row) and asks the page's guards before one of them is
// followed (./leave-guard.ts). With nothing registered it does nothing at
// all: the link goes as usual.
//
// It listens in the capture phase, before Next.js's Link sees the click (Link
// leaves a click whose default is prevented alone). It then commits the field
// being typed in the page (fields commit on blur; a tap on the iPad does not
// move focus), lets the rest of the click run, and asks the guards: nothing
// to lose, it follows the link; otherwise it asks the user. A page that
// stops the click itself (its default already prevented) keeps it.
//
// `display: contents`: the wrapper adds no box, so the sticky top bar and the
// sidebar lay out as before.
import { useRouter } from "next/navigation";
import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import { guardedDestination, leaveGuards } from "./leave-guard";
import { PendingWorkDialog } from "./pending-work-dialog";

type Leaving = { to: string; reasons: string[] };

export function LeaveGuardArea({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  /** The link that was followed: focus goes back to it if the user stays. */
  const opener = useRef<HTMLAnchorElement | null>(null);
  const checking = useRef(false);

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement) || !event.currentTarget.contains(link)) return;
    const to = guardedDestination(
      {
        href: link.href,
        target: link.target,
        download: link.hasAttribute("download"),
        button: event.button,
        modified: event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
        defaultPrevented: event.defaultPrevented,
      },
      window.location.href,
      leaveGuards,
    );
    if (to === null) return;
    event.preventDefault();
    // A second tap while the guards answer the first is the same request.
    if (checking.current) return;
    checking.current = true;
    opener.current = link;
    commitFocusedField(event.currentTarget);
    void (async () => {
      try {
        // After the click's other listeners: a page's own may still be committing.
        await new Promise((resolve) => setTimeout(resolve, 0));
        const reasons = await leaveGuards.check("navigate");
        if (reasons.length === 0) router.push(to);
        else setLeaving({ to, reasons });
      } finally {
        checking.current = false;
      }
    })();
  }

  return (
    <div className="contents" onClickCapture={onClickCapture}>
      {children}
      <PendingWorkDialog
        open={leaving !== null}
        onOpenChange={(open) => {
          if (!open) setLeaving(null);
        }}
        title="Leave this page?"
        reasons={leaving?.reasons ?? []}
        stayLabel="Stay on this page"
        goLabel="Leave anyway"
        onGo={() => {
          if (leaving) router.push(leaving.to);
          setLeaving(null);
        }}
        returnFocus={() => opener.current}
      />
    </div>
  );
}

/** Blurs the field that has focus in the page (not in this part of the shell), so a value being typed is stored first. */
function commitFocusedField(area: Element) {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused !== document.body && !area.contains(focused)) focused.blur();
}
