// /admin/users as the admin sees it, from the directory and the ?team= and
// ?q= values: the header with Invite User, what needs attention, the search
// and the Team picker, and the list. Rendered on the server; page.tsx checks
// the admin and loads the data. The search filters the rows drawn here, in
// the browser (user-search.tsx).
import Link from "next/link";
import { TriangleAlertIcon, UsersIcon } from "lucide-react";
import { PageHeader } from "@/components/qc";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { listNames, TEAM_MESSAGES } from "@/lib/auth/org";
import { displayName, type UserDirectory, type UserListItem } from "@/lib/auth/users";
import {
  applyTeamFilter,
  filterOptions,
  filterValue,
  NO_LEAD,
  readTeamFilter,
  teamHref,
  type TeamFilter as TeamFilterState,
} from "../_lib/team-filter";
import { readSearch, userSearchText } from "../_lib/user-search";
import { InviteUserDialog } from "./invite-user-dialog";
import { TeamFilter } from "./team-filter";
import { UserSearch, UserSearchBox, UserSearchSummary } from "./user-search";
import { UsersTable } from "./users-table";

/** How many names an alert lists before "and N more". */
const NAMES_SHOWN = 5;

/** An alert's action link, on its own line: 44 px tall on touch (docs/DESIGN.md, Density) without crowding the text above. */
const ALERT_LINK =
  "rounded-sm font-semibold text-warn underline underline-offset-4 focus-ring touch:inline-flex touch:min-h-11 touch:items-center";

function emptyMessage(filter: TeamFilterState): string {
  return filter.kind === "no-lead" ? "Every active inspector has a lead inspector." : "Nobody here yet.";
}

export function UsersScreen({
  directory,
  team,
  search,
}: {
  directory: UserDirectory;
  /** The ?team= value: a lead inspector's id, "none", or nothing for everyone. */
  team: string | string[] | undefined;
  /** The ?q= value: a name, email, phone number or UID to find. */
  search?: string | string[] | undefined;
}) {
  const { users, adminApi, teams, uids, leads } = directory;
  const canInvite = adminApi !== "missing-key";
  const onlyYou = users.every((user) => user.isSelf);
  const filter: TeamFilterState = teams ? readTeamFilter(team, users) : { kind: "everyone" };
  const shown = applyTeamFilter(users, filter);
  const missingLead = users.filter((user) => user.missingLead);

  return (
    <UserSearch
      entries={shown.map((user) => ({ id: user.id, text: userSearchText(user) }))}
      initialQuery={readSearch(search)}
      view={filterValue(filter)}
    >
      <div className="flex flex-col gap-6">
        {/* No subtitle under the title (Kenneth, 7 October 2026: page headers without subtitles). */}
        <PageHeader
          eyebrow="Admin"
          title="Users"
          actions={<InviteUserDialog disabled={!canInvite} teams={teams} leads={leads} />}
        />

        {adminApi === "missing-key" && (
          <Alert className="border-warn-border bg-warn-tint text-warn">
            <TriangleAlertIcon aria-hidden />
            <AlertTitle>Invites Are Switched Off</AlertTitle>
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
            <AlertTitle>Sign-In Details Are Unavailable</AlertTitle>
            <AlertDescription className="text-warn">
              Supabase Auth did not answer, so this list cannot show who has signed in or which accounts are waiting for
              activation. Check that SUPABASE_SECRET_KEY is the secret key of this project, then reload.
            </AlertDescription>
          </Alert>
        )}
        {!teams && (
          <Alert className="border-warn-border bg-warn-tint text-warn" data-testid="teams-missing">
            <TriangleAlertIcon aria-hidden />
            <AlertTitle>Lead Inspectors Are Not Set Up Yet</AlertTitle>
            <AlertDescription className="text-warn">
              {TEAM_MESSAGES.teamsMissing} Until then this page sets roles only.
            </AlertDescription>
          </Alert>
        )}
        {missingLead.length > 0 && filter.kind !== "no-lead" && <NoLeadAlert people={missingLead} />}

        {/* The search and the Team picker side by side from 768 px, the count beside them from 1024 px. */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:gap-x-6">
            <UserSearchBox placeholder={uids ? "Name, email, phone or UID" : "Name, email or phone"} />
            {teams && <TeamFilter value={filterValue(filter)} options={filterOptions(users)} />}
          </div>
          <UserSearchSummary filter={filter} shown={shown.length} total={users.length} />
        </div>

        <UsersTable
          users={shown}
          showSignIns={adminApi === "ok"}
          teams={teams}
          uids={uids}
          leads={leads}
          invites={canInvite}
          emptyMessage={emptyMessage(filter)}
          filter={filter}
        />

        {onlyYou && filter.kind === "everyone" && (
          <Empty className="border border-dashed border-border bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersIcon aria-hidden />
              </EmptyMedia>
              <EmptyTitle>Only You So Far</EmptyTitle>
              <EmptyDescription>
                {teams
                  ? "Invite your lead inspectors first, then their inspectors. Each one gets an email with a link to create their account."
                  : "Invite your inspectors. Each one gets an email with a link to create their account."}
              </EmptyDescription>
            </EmptyHeader>
            {canInvite && (
              <EmptyContent>
                <InviteUserDialog label="Invite Your First User" teams={teams} leads={leads} />
              </EmptyContent>
            )}
          </Empty>
        )}
      </div>
    </UserSearch>
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
      <AlertTitle>{one ? "1 Inspector Has No Lead Inspector" : `${missing.length} Inspectors Have No Lead Inspector`}</AlertTitle>
      <AlertDescription className="text-warn [&_p:not(:last-child)]:mb-1">
        <p>
          {listed} {one ? "works" : "work"} in no team, so no lead inspector sees {one ? "their" : "those"} inspections.
          Choose Change Lead Inspector next to {one ? "their name" : "each name"}.
        </p>
        <p>
          <Link href={teamHref(NO_LEAD)} className={ALERT_LINK}>
            {one ? "Show Them" : "Show Only Them"}
          </Link>
        </p>
      </AlertDescription>
    </Alert>
  );
}
