import { AppShell } from "@/components/shell/app-shell";
import { hiddenSectionPathsFor, navFor } from "@/components/shell/nav";
import { SectionGate } from "@/components/shell/section-gate";
import { toShellUser } from "@/components/shell/user";
import { requireUser, userCan } from "@/lib/auth/session";

/**
 * The signed-in app: every page in this group renders inside the shell.
 *
 * The user is read here for the shell (name, role, nav). This is not the
 * access check: layouts do not re-render on navigation and do not stop their
 * pages from rendering, so every page calls requireUser(), requireAdmin() or
 * requirePermission() itself. They share this request's cached session. The
 * nav follows the person's role (navFor: its switches for the admin screens);
 * SectionGate only turns a section the role cannot see at all (/admin for an
 * inspector whose role opens no admin screen) into a real 404.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const allows = (permission: Parameters<typeof userCan>[1]) => userCan(user, permission);
  return (
    <AppShell user={toShellUser(user)} nav={navFor(user.role, allows)}>
      <SectionGate hidden={hiddenSectionPathsFor(user.role, allows)}>{children}</SectionGate>
    </AppShell>
  );
}
