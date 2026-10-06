"use client";

// A link that moves within the list (another page, clearing the filters).
// While its navigation runs it leaves a [data-pending] marker, which dims the
// results through `group-has-data-pending/list` on the page (the pattern from
// the Next.js "Building interactive apps" guide), so a slow answer never looks
// like a dead tap.
//
// Most of these links are gone once the new list renders (Clear filters,
// Go to the list, Try again, Next on the last page but one). Followed while it
// has focus, the link asks the list to move focus on (list-focus.tsx) instead
// of letting it drop to <body>.
import Link, { useLinkStatus } from "next/link";
import type { ComponentProps, MouseEvent } from "react";
import { useRequestListFocus } from "./list-focus";
import type { ListFocusTarget } from "./list-focus-target";

function PendingMarker() {
  const { pending } = useLinkStatus();
  return <span aria-hidden hidden data-pending={pending ? "" : undefined} />;
}

type ListLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
  /** Where focus goes if the link had it and is gone after the navigation. */
  focusAfter?: ListFocusTarget;
};

export function ListLink({ children, href, focusAfter = "results", onClick, ...props }: ListLinkProps) {
  const requestFocus = useRequestListFocus();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    // A new tab or window leaves this list as it is.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    // Enter on the focused link, or a click in a browser that focuses links.
    // Safari never focuses a tapped link: nothing to restore, keyboard stays down.
    if (event.currentTarget === document.activeElement) requestFocus({ href, target: focusAfter });
  }

  return (
    <Link {...props} href={href} onClick={handleClick}>
      {children}
      <PendingMarker />
    </Link>
  );
}
