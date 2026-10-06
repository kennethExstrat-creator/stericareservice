"use client";

// The one client piece of the nav: layouts do not re-render on navigation, so
// the current page is read here, from the URL, and marked with aria-current.
// Styles key off that attribute (aria-[current=page]:...), so the server
// renders everything else.
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isNavLinkActive, type NavMatch } from "./nav";

type NavLinkProps = {
  href: string;
  match: NavMatch;
  className?: string;
  children: ReactNode;
};

export function NavLink({ href, match, className, children }: NavLinkProps) {
  const pathname = usePathname();
  const current = isNavLinkActive({ href, match }, pathname);
  return (
    <Link href={href} aria-current={current ? "page" : undefined} className={className}>
      {children}
    </Link>
  );
}
