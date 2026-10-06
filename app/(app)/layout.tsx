import { AppShell } from "@/components/shell/app-shell";
import { hiddenSectionPaths, navForRole } from "@/components/shell/nav";
import { SectionGate } from "@/components/shell/section-gate";
import { toShellUser } from "@/components/shell/user";
import { requireUser } from "@/lib/auth/session";

/**
 * The signed-in app: every page in this group renders inside the shell.
 *
 * The user is read here for the shell (name, role, nav). This is not the
 * access check: layouts do not re-render on navigation and do not stop their
 * pages from rendering, so every page calls requireUser() or requireAdmin()
 * itself. Both share this request's cached session. SectionGate only turns
 * a section the role cannot see (/admin for inspectors) into a real 404.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <AppShell user={toShellUser(user)} nav={navForRole(user.role)}>
      <SectionGate hidden={hiddenSectionPaths(user.role)}>{children}</SectionGate>
    </AppShell>
  );
}
