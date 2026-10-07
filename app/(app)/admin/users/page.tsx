import type { Metadata } from "next";
import Link from "next/link";
import { TriangleAlertIcon, UsersIcon } from "lucide-react";
import { PageHeader } from "@/components/qc";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { listNames, TEAM_MESSAGES } from "@/lib/auth/org";
import { requireAdmin } from "@/lib/auth/session";
import { displayName, getUserDirectory, type UserListItem } from "@/lib/auth/users";
import {
  applyTeamFilter,
  filterOptions,
  filterValue,
  NO_LEAD,
  readTeamFilter,
  TEAM_PARAM,
  teamHref,
  type TeamFilter as TeamFilterState,
} from "./_lib/team-filter";
import { InviteUserDialog } from "./_components/invite-user-dialog";
import { TeamFilter } from "./_components/team-filter";
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

/** How many names an alert lists before "and N more". */
const NAMES_SHOWN = 5;

function people(count: number): string {
  return count === 1 ? "1 person" : `${count} people`;
}

function inspectors(count: number): string {
  return count === 1 ? "1 inspector" : `${count} inspectors`;
}

/** What the list shows, in words, under the Team picker. */
function summary(filter: TeamFilterState, shown: number, total: number): string {
  switch (filter.kind) {
    case "everyone":
      return `${people(total)}.`;
    case "no-lead":
      return shown === 0 ? "Every active inspector has a lead inspector." : `${inspectors(shown)} in no team.`;
    case "team":
      return `${filter.leadName}'s team: ${inspectors(Math.max(shown - 1, 0))}.`;
  }
}

function emptyMessage(filter: TeamFilterState): string {
  return filter.kind === "no-lead" ? "Every active inspector has a lead inspector." : "Nobody here yet.";
}

/**
 * /admin/users (BUILD_SPEC 3 and 10): everyone with an account, invites,
 * roles, lead inspectors and their teams, deactivation. Inspectors get a 404
 * from requireAdmin(); the layout above is not a security boundary, so this
 * page checks for itself. ?team= shows one lead inspector's team, or the
 * inspectors in no team (_lib/team-filter.ts).
 *
 * No outer padding or width: the app shell's main area provides both.
 */
export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  const viewer = await requireAdmin();
  const [{ users, adminApi, teams, leads }, query] = await Promise.all([getUserDirectory(viewer.id), searchParams]);
  const canInvite = adminApi !== "missing-key";
  const onlyYou = users.every((user) => user.isSelf);
  const filter: TeamFilterState = teams ? readTeamFilter(query[TEAM_PARAM], users) : { kind: "everyone" };
  const shown = applyTeamFilter(users, filter);
  const missingLead = users.filter((user) => user.missingLead);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Admin"
        title="Users"
        description="Invite people, set their roles and lead inspectors, and deactivate accounts that should no longer have access."
        actions={<InviteUserDialog disabled={!canInvite} teams={teams} leads={leads} />}
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
      {!teams && (
        <Alert className="border-warn-border bg-warn-tint text-warn" data-testid="teams-missing">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>Lead inspectors are not set up yet</AlertTitle>
          <AlertDescription className="text-warn">
            {TEAM_MESSAGES.teamsMissing} Until then this page sets roles only.
          </AlertDescription>
        </Alert>
      )}
      {missingLead.length > 0 && filter.kind !== "no-lead" && <NoLeadAlert people={missingLead} />}

      {teams && (
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <TeamFilter value={filterValue(filter)} options={filterOptions(users)} />
          <p className="text-sm text-muted-foreground" role="status">
            {summary(filter, shown.length, users.length)}
          </p>
        </div>
      )}

      <UsersTable
        users={shown}
        showSignIns={adminApi === "ok"}
        teams={teams}
        leads={leads}
        emptyMessage={emptyMessage(filter)}
      />

      {onlyYou && filter.kind === "everyone" && (
        <Empty className="border border-dashed border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>Only you so far</EmptyTitle>
            <EmptyDescription>
              Invite your lead inspectors first, then their inspectors. Each one gets an email with a link to choose a
              password.
            </EmptyDescription>
          </EmptyHeader>
          {canInvite && (
            <EmptyContent>
              <InviteUserDialog label="Invite your first user" teams={teams} leads={leads} />
            </EmptyContent>
          )}
        </Empty>
      )}
    </div>
  );
}

/** Active inspectors in no team: nobody leads them, so no lead inspector sees their work. */
function NoLeadAlert({ people: missing }: { people: UserListItem[] }) {
  const names = missing.map((user) => displayName(user.fullName, user.email));
  const listed =
    names.length > NAMES_SHOWN
      ? `${names.slice(0, NAMES_SHOWN).join(", ")} and ${names.length - NAMES_SHOWN} more`
      : listNames(names);
  const one = missing.length === 1;
  return (
    <Alert className="border-warn-border bg-warn-tint text-warn" data-testid="no-lead-alert">
      <TriangleAlertIcon aria-hidden />
      <AlertTitle>{`${inspectors(missing.length)} ${one ? "has" : "have"} no lead inspector`}</AlertTitle>
      <AlertDescription className="text-warn">
        <p>
          {listed} {one ? "works" : "work"} in no team, so no lead inspector sees {one ? "their" : "those"} inspections.
          Choose Change lead inspector next to {one ? "their name" : "each name"}.{" "}
          <Link href={teamHref(NO_LEAD)} className="font-semibold text-warn underline underline-offset-4 focus-ring">
            Show {one ? "them" : "only them"}
          </Link>
        </p>
      </AlertDescription>
    </Alert>
  );
}
