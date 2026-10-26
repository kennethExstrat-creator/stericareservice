"use client";

// Wraps a part of the shell whose links leave the page (the top bar, the
// sidebar, the admin row) and asks the page's guards before one of them is
// followed (./leave-guard.ts). With nothing registered it does nothing at
// all: the link goes as usual.
//
// It listens on its own element, in the capture phase:
// - after a page's own click listeners on document or window. A page that
//   stops the click itself (its default prevented) keeps it, and the shell
//   steps aside. React's onClickCapture
//   would not do: React listens on document from hydration, so it would run
//   before any listener a page adds there later.
// - before Next.js's Link sees the click (Link leaves a click whose default
//   is prevented alone).
// It then commits the field being typed in the page (fields commit on blur;
// a tap on the iPad does not move focus), lets the rest of the click run, and
// asks the guards: nothing to lose, it follows the link; otherwise it asks
// the user. While the guards answer (a save on its way, up to 3 s), the
// tapped link is dimmed, and a tap on another link changes where to go: the
// last one chosen wins (leaveRequests). A link in the page followed
// meanwhile wins over them all: the answer is then dropped.
//
// `display: contents`: the wrapper adds no box, so the sticky top bar and the
// sidebar lay out as before.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { guardedDestination, leaveGuards, leaveRequests } from "./leave-guard";
import { PendingWorkDialog } from "./pending-work-dialog";

type Leaving = { to: string; reasons: string[] };

/** Marks the link whose tap waits for the guards; the wrapper's classes dim it. */
const WAITING = "data-leave-waiting";

export function LeaveGuardArea({ children }: { children: ReactNode }) {
  const router = useRouter();
  const area = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  /** The link that was followed: focus goes back to it if the user stays. */
  const opener = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    const element = area.current;
    if (!element) return;
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || !element.contains(link)) return;
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
      leaveRequests.waiting()?.link.removeAttribute(WAITING);
      link.setAttribute(WAITING, "");
      const page = window.location.pathname;
      void leaveRequests
        .ask({ to, link }, async () => {
          commitFocusedField(element);
          // After the click's other listeners: a page's own may still be committing.
          await new Promise((resolve) => setTimeout(resolve, 0));
        })
        .then((answer) => {
          // Null: a later tap joined this check, and the first tap's answer covers it.
          if (!answer) return;
          const { request, reasons } = answer;
          request.link.removeAttribute(WAITING);
          // Left meanwhile by a link in the page: the answer was about a page that is gone.
          if (window.location.pathname !== page) return;
          opener.current = request.link;
          if (reasons.length === 0) router.push(request.to);
          else setLeaving({ to: request.to, reasons });
        });
    };
    element.addEventListener("click", onClick, true);
    return () => element.removeEventListener("click", onClick, true);
  }, [router]);

  return (
    // A waiting link dims what it shows, not itself: opacity on the link would fade its focus ring too (docs/DESIGN.md, Focus).
    <div
      ref={area}
      className="contents [&_a[data-leave-waiting]]:cursor-progress [&_a[data-leave-waiting]>*]:opacity-60"
    >
      {children}
      <PendingWorkDialog
        open={leaving !== null}
        onOpenChange={(open) => {
          if (!open) setLeaving(null);
        }}
        title="Leave This Page?"
        reasons={leaving?.reasons ?? []}
        stayLabel="Stay on This Page"
        goLabel="Leave Anyway"
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
