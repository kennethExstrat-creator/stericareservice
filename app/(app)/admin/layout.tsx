import { LeaveGuardArea } from "@/components/shell/leave-guard-area";
import { navForRole } from "@/components/shell/nav";
import { SectionNav } from "@/components/shell/nav-list";
import { requireAdmin } from "@/lib/auth/session";

/**
 * The admin area. Non-admins get a 404 here, so /admin does not reveal itself
 * (BUILD_SPEC 3); every admin page still calls requireAdmin() itself, because
 * a layout does not stop its pages from rendering.
 *
 * Below 1280 px there is no sidebar, so the admin pages are listed in a row
 * at the top (the sidebar lists them from 1280 px). Like the shell's bars,
 * the row asks a page with unsaved work before it leaves it.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireAdmin();
  const section = navForRole(user.role).find((entry) => entry.key === "admin");

  return (
    <>
      {section && (
        <LeaveGuardArea>
          <SectionNav section={section} className="mb-6 xl:hidden" />
        </LeaveGuardArea>
      )}
      {children}
    </>
  );
}
