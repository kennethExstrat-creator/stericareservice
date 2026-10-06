"use client";

// Makes "/admin is a 404 for inspectors" a real 404 (BUILD_SPEC 3).
//
// The admin layout and pages check the role themselves (requireAdmin): that
// is the access control, and it stays. But they render inside the loading
// boundary (app/(app)/loading.tsx), after the response has started
// streaming, so on their own they can only swap in the 404 page in the
// browser, with status 200, after a flash of the shell. This gate sits in
// the shell layout, above that boundary, so the server answers 404 before
// sending anything. The role comes from the server session.
import { notFound, usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isHiddenFromRole, type UserRole } from "./nav";

export function SectionGate({ role, children }: { role: UserRole; children: ReactNode }) {
  const pathname = usePathname();
  if (isHiddenFromRole(pathname, role)) notFound();
  return children;
}
