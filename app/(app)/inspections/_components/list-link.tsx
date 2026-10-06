"use client";

// A link that moves within the list (another page, clearing the filters).
// While its navigation runs it leaves a [data-pending] marker, which dims the
// results through `group-has-data-pending/list` on the page (the pattern from
// the Next.js "Building interactive apps" guide), so a slow answer never looks
// like a dead tap.
import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";

function PendingMarker() {
  const { pending } = useLinkStatus();
  return <span aria-hidden hidden data-pending={pending ? "" : undefined} />;
}

export function ListLink({ children, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link {...props}>
      {children}
      <PendingMarker />
    </Link>
  );
}
