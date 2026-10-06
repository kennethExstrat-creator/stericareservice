"use client";

// The one client piece of the nav: layouts do not re-render on navigation, so
// the current entry is read here, from the URL, and marked with aria-current:
// "page" on the link to this very page, "true" on a section or parent link
// this page is inside. Styles key off the attribute (aria-[current]:...), so
// the server renders everything else. Imports ./nav-match only, never the
// nav config.
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ariaCurrentFor, type NavMatch } from "./nav-match";

type NavLinkProps = {
  href: string;
  match: NavMatch;
  className?: string;
  children: ReactNode;
};

export function NavLink({ href, match, className, children }: NavLinkProps) {
  const pathname = usePathname();
  return (
    <Link href={href} aria-current={ariaCurrentFor({ href, match }, pathname)} className={className}>
      {children}
    </Link>
  );
}
