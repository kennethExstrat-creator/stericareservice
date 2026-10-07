import type { Metadata } from "next";
import { TriangleAlertIcon, UsersIcon } from "lucide-react";
import { PageHeader } from "@/components/qc";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { requireAdmin } from "@/lib/auth/session";
import { getUserDirectory } from "@/lib/auth/users";
import { InviteUserDialog } from "./_components/invite-user-dialog";
import { UsersTable } from "./_components/users-table";

/**
 * The title checks the role too. Next resolves metadata apart from the page,
 * so a static title would still name this page on an inspector's 404 (in the
 * tab and the HTML); notFound() here swaps in the 404 page's metadata. The
 * session is cached per request, so this adds no query.
 */
export async function generateMetadata(): Promise<Metadata> {
  await requireAdmin();
  return { title: "Users" };
}

/**
 * /admin/users (BUILD_SPEC 3 and 10): everyone with an account, invites,
 * roles, deactivation. Inspectors get a 404 from requireAdmin(); the layout
 * above is not a security boundary, so this page checks for itself.
 *
 * No outer padding or width: the app shell's main area provides both.
 */
export default async function UsersPage() {
  const viewer = await requireAdmin();
  const { users, adminApi } = await getUserDirectory(viewer.id);
  const canInvite = adminApi !== "missing-key";
  const onlyYou = users.every((user) => user.isSelf);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Admin"
        title="Users"
        actions={<InviteUserDialog disabled={!canInvite} />}
      />

      {adminApi === "missing-key" && (
        <Alert className="border-warn-border bg-warn-tint text-warn">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>Invites are switched off</AlertTitle>
          <AlertDescription className="text-warn">
            The server needs SUPABASE_SECRET_KEY to send invites, show who has signed in and stop deactivated users
            signing in. Add it to the environment (.env.local, or the Vercel project settings) and restart the app.
            Roles and deactivation still work.
          </AlertDescription>
        </Alert>
      )}
      {adminApi === "failed" && (
        <Alert className="border-warn-border bg-warn-tint text-warn">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>Sign-in details are unavailable</AlertTitle>
          <AlertDescription className="text-warn">
            Supabase Auth did not answer, so this list cannot show who has signed in or which accounts are waiting for
            activation. Check that SUPABASE_SECRET_KEY is the secret key of this project, then reload.
          </AlertDescription>
        </Alert>
      )}

      <UsersTable users={users} showSignIns={adminApi === "ok"} />

      {onlyYou && (
        <Empty className="border border-dashed border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>Only you so far</EmptyTitle>
            <EmptyDescription>
              Invite your inspectors. Each one gets an email with a link to choose a password.
            </EmptyDescription>
          </EmptyHeader>
          {canInvite && (
            <EmptyContent>
              <InviteUserDialog label="Invite your first user" />
            </EmptyContent>
          )}
        </Empty>
      )}
    </div>
  );
}
