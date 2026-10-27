import { notFound } from "next/navigation";
import { LeaveGuardArea } from "@/components/shell/leave-guard-area";
import { navFor } from "@/components/shell/nav";
import { SectionNav } from "@/components/shell/nav-list";
import { requireUser, userCan } from "@/lib/auth/session";

/**
 * The admin area. Someone whose role opens no admin screen gets a 404 here,
 * so /admin does not reveal itself (BUILD_SPEC 3); every admin page still
 * checks its own switch (requirePermission), because a layout does not stop
 * its pages from rendering.
 *
 * Below 1280 px there is no sidebar, so the admin screens the role opens are
 * listed in a row at the top (the sidebar lists them from 1280 px). Like the
 * shell's bars, the row asks a page with unsaved work before it leaves it.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireUser();
  const section = navFor(user.role, (permission) => userCan(user, permission)).find((entry) => entry.key === "admin");
  if (!section) notFound();

  return (
    <>
      <LeaveGuardArea>
        <SectionNav section={section} className="mb-6 xl:hidden" />
      </LeaveGuardArea>
      {children}
    </>
  );
}
