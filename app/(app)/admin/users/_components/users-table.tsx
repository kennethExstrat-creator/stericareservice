import { LockIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { displayName, type LeadOption, type UserListItem } from "@/lib/auth/users";
import { cn } from "@/lib/utils";
import type { TeamFilter } from "../_lib/team-filter";
import { AccountStatusBadge, RoleLabel } from "./account-status";
import { TeamCell } from "./team-cell";
import { UserActions } from "./user-actions";
import { UserRows } from "./user-search";

// Rendered on the server only, in the team's time zone, so the dates read the
// same on every device and never differ between server and browser.
const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kuala_Lumpur",
});

function DateText({ iso, empty }: { iso: string | null; empty: string }) {
  if (!iso) return <span className="text-muted-foreground">{empty}</span>;
  return <time dateTime={iso}>{DATE.format(new Date(iso))}</time>;
}

/**
 * An email address that wraps after its @ where its column is too narrow for
 * it ("hafiz.abdulrahman@" over "stericare.com.my"), rather than inside a
 * word. On desktop the Email column gives up width this way, so the Name
 * column beside the UID keeps its own. Under the name on iPad, a part wider
 * than the column still breaks where it must.
 */
export function EmailText({ email }: { email: string }) {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  return (
    <>
      {email.slice(0, at + 1)}
      <wbr />
      {email.slice(at + 1)}
    </>
  );
}

// Compact rows with a mouse or trackpad (docs/DESIGN.md, Density): a 36 px
// header and rows of about 35 px around the 32 px menu button. Touch keeps
// the table's own 44 px sizes.
const HEAD = "fine:h-9";
const CELL = "fine:py-px";

const EVERYONE: TeamFilter = { kind: "everyone" };

/**
 * The Phone column, from 1440 px without a touchscreen. Ten columns need that
 * room: beside the sidebar the table's frame is 1104 px wide at 1440 px and
 * 944 px at 1280 px, where a long name with a phone squeezed the Name column
 * to four lines. Below it, and on every touchscreen, the phone sits under the
 * name. Beside the column the Name column keeps 144 px, enough for a long
 * name on two lines ("Muhammad Hafiz bin / Abdul Rahman").
 */
const PHONE_COLUMN = "hidden fine:min-[90rem]:table-cell";
const PHONE_UNDER_NAME = "fine:min-[90rem]:hidden";
const NAME_BESIDE_PHONE = "fine:min-[90rem]:min-w-36";

/** A phone number as typed, on one line in tabular figures: it never breaks between its groups. */
function PhoneText({ phone }: { phone: string }) {
  return <span className="whitespace-nowrap tabular-nums">{phone}</span>;
}

/**
 * Everyone with an account. Each row starts with the person's UID, on one
 * line in tabular figures. Desktop (1280 px and wider) gets one compact line
 * per person, the email wrapping after its @ when long names need the room;
 * the phone has its own column from 1440 px. On iPad the email, the phone and
 * the date added sit under the name, the lead inspector under the role below
 * 1024 px, and the least needed columns drop out, so the row keeps 44 px
 * controls without scrolling sideways. The rows are drawn here; the search
 * (user-search.tsx) chooses which show.
 */
export function UsersTable({
  users,
  showSignIns,
  teams = true,
  uids = true,
  leads = [],
  invites = true,
  emptyMessage = "Nobody here yet.",
  filter = EVERYONE,
}: {
  users: UserListItem[];
  showSignIns: boolean;
  /** False until the project has lead inspectors (migration 20261007170000): no team column. */
  teams?: boolean;
  /** False until the project has UIDs (migration 20261008140000): no UID column. */
  uids?: boolean;
  /** Active lead inspectors, for the row dialogs' lead pickers. */
  leads?: readonly LeadOption[];
  /** False without the secret key: the row menus offer no invite actions. */
  invites?: boolean;
  /** Shown when a filter leaves nobody. */
  emptyMessage?: string;
  /** The Team picker's view, for the line when a search finds nobody in it. */
  filter?: TeamFilter;
}) {
  // The UID; Name, Email, Phone, Role and Status; Last Signed In; Lead Inspector; Added and the menu.
  const columns = (uids ? 1 : 0) + 5 + (showSignIns ? 1 : 0) + (teams ? 1 : 0) + 2;
  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border">
      <Table className="touch:text-base">
        <caption className="sr-only">
          {uids
            ? "Users, their UIDs, phone numbers, roles, lead inspectors and access"
            : "Users, their phone numbers, roles, lead inspectors and access"}
        </caption>
        <TableHeader className="bg-slate-50">
          <TableRow className="hover:bg-transparent">
            {uids && <TableHead className={cn("pl-4", HEAD)}>UID</TableHead>}
            <TableHead className={cn(!uids && "pl-4", NAME_BESIDE_PHONE, HEAD)}>Name</TableHead>
            <TableHead className={cn("hidden xl:table-cell", HEAD)}>Email</TableHead>
            <TableHead className={cn(PHONE_COLUMN, HEAD)}>Phone</TableHead>
            {/* Below 1024 px the lead sits under the role: 176 px holds "Lead:" and a name on one line, and the
                name beside the UID keeps the rest (more only when a cell needs it, as a No Lead Inspector badge may). */}
            <TableHead className={cn(teams && "max-lg:w-44", HEAD)}>Role</TableHead>
            {teams && <TableHead className={cn("hidden lg:table-cell", HEAD)}>Lead Inspector</TableHead>}
            <TableHead className={HEAD}>Status</TableHead>
            {showSignIns && <TableHead className={HEAD}>Last Signed In</TableHead>}
            <TableHead className={cn("hidden lg:table-cell", HEAD)}>Added</TableHead>
            <TableHead className={cn("w-0 pr-4", HEAD)}>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <UserRows
            columns={columns}
            emptyMessage={emptyMessage}
            filter={filter}
            rows={users.map((user) => ({
              id: user.id,
              row: (
                <UserRow user={user} showSignIns={showSignIns} teams={teams} uids={uids} leads={leads} invites={invites} />
              ),
            }))}
          />
        </TableBody>
      </Table>
    </div>
  );
}

function UserRow({
  user,
  showSignIns,
  teams,
  uids,
  leads,
  invites,
}: {
  user: UserListItem;
  showSignIns: boolean;
  teams: boolean;
  uids: boolean;
  leads: readonly LeadOption[];
  invites: boolean;
}) {
  const name = displayName(user.fullName, user.email);
  const named = Boolean(user.fullName?.trim());
  const showEmailUnderName = named && user.email !== "";
  return (
    <TableRow data-status={user.status} data-role={user.roleChoice}>
      {uids && (
        <TableCell className={cn("pl-4 whitespace-nowrap tabular-nums", CELL)} data-slot="uid">
          {user.uid}
        </TableCell>
      )}
      <TableCell className={cn(!uids && "pl-4", "whitespace-normal", CELL)}>
        <div className="flex min-w-0 flex-col gap-0.5 py-0.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-foreground">
            {/* Someone invited goes by their email until they give their name; it wraps after its @. */}
            <span className="[overflow-wrap:anywhere]">{named ? name : <EmailText email={name} />}</span>
            {user.isSelf && <Badge variant="secondary">You</Badge>}
          </span>
          {showEmailUnderName && (
            <span className="text-muted-foreground [overflow-wrap:anywhere] xl:hidden">
              <EmailText email={user.email} />
            </span>
          )}
          {/* The Phone column starts at 1440 px without a touchscreen; below that, and on every iPad, it sits here. */}
          {user.phone && (
            <span className={cn("text-muted-foreground", PHONE_UNDER_NAME)} data-slot="phone-under-name">
              <span className="sr-only">Phone </span>
              <PhoneText phone={user.phone} />
            </span>
          )}
          {/* The Added column starts at 1024 px; below that the date sits here. */}
          <span className="text-muted-foreground lg:hidden">
            Added <DateText iso={user.createdAt} empty="" />
          </span>
        </div>
      </TableCell>
      {/* Wraps after the @ rather than squeezing the name beside the UID (docs/DESIGN.md, Density). */}
      <TableCell className={cn("hidden whitespace-normal text-muted-foreground xl:table-cell", CELL)}>
        <EmailText email={user.email} />
      </TableCell>
      <TableCell className={cn(PHONE_COLUMN, "text-muted-foreground", CELL)} data-slot="phone">
        {user.phone ? (
          <PhoneText phone={user.phone} />
        ) : (
          <>
            <span aria-hidden>—</span>
            <span className="sr-only">No phone number</span>
          </>
        )}
      </TableCell>
      <TableCell className={cn("whitespace-normal", CELL)}>
        <div className="flex flex-col items-start gap-1">
          <RoleLabel role={user.roleChoice} />
          {/* The Lead Inspector column starts at 1024 px; below that the lead sits here. */}
          {teams && user.roleChoice !== "admin" && (
            <span className="text-muted-foreground lg:hidden" data-slot="team-under-role">
              {user.lead && "Lead: "}
              <TeamCell user={user} />
            </span>
          )}
        </div>
      </TableCell>
      {teams && (
        <TableCell className={cn("hidden whitespace-normal lg:table-cell", CELL)}>
          <TeamCell user={user} />
        </TableCell>
      )}
      <TableCell className={CELL}>
        {/* Stacked on iPad; on one line on desktop, so the row stays compact. */}
        <div className="flex flex-col items-start gap-1 fine:flex-row fine:items-center fine:gap-2">
          <AccountStatusBadge status={user.status} />
          {user.signInBlocked && (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-warn">
              <LockIcon aria-hidden className="size-3.5" />
              Sign-In Blocked
            </span>
          )}
        </div>
      </TableCell>
      {showSignIns && (
        <TableCell className={CELL}>
          <DateText iso={user.lastSignInAt} empty="Never" />
        </TableCell>
      )}
      <TableCell className={cn("hidden lg:table-cell", CELL)}>
        <DateText iso={user.createdAt} empty="" />
      </TableCell>
      <TableCell className={cn("pr-4 text-right", CELL)}>
        <UserActions
          teams={teams}
          leads={leads}
          invites={invites}
          user={{
            id: user.id,
            uid: user.uid,
            name,
            fullName: user.fullName,
            phone: user.phone,
            email: user.email,
            role: user.roleChoice,
            status: user.status,
            signInBlocked: user.signInBlocked,
            isSelf: user.isSelf,
            lead: user.lead,
            team: user.team.map((member) => member.name),
          }}
        />
      </TableCell>
    </TableRow>
  );
}
