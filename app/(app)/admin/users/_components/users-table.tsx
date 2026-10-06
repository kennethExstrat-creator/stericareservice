import { LockIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { displayName, type UserListItem } from "@/lib/auth/users";
import { AccountStatusBadge, RoleLabel } from "./account-status";
import { UserActions } from "./user-actions";

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
 * Everyone with an account. Desktop (1280 px and wider) gets one compact line
 * per person; on iPad the email sits under the name and the least needed
 * columns drop out, so the row keeps 44 px controls without scrolling sideways.
 */
export function UsersTable({ users, showSignIns }: { users: UserListItem[]; showSignIns: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border">
      <Table className="touch:text-base">
        <caption className="sr-only">Users and their access</caption>
        <TableHeader className="bg-slate-50">
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Name</TableHead>
            <TableHead className="hidden xl:table-cell">Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            {showSignIns && <TableHead>Last signed in</TableHead>}
            <TableHead className="hidden lg:table-cell">Added</TableHead>
            <TableHead className="w-0 pr-4">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const name = displayName(user.fullName, user.email);
            const showEmailUnderName = Boolean(user.fullName?.trim()) && user.email !== "";
            return (
              <TableRow key={user.id} data-status={user.status}>
                <TableCell className="pl-4 whitespace-normal">
                  <div className="flex min-w-0 flex-col gap-0.5 py-0.5">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-foreground">
                      <span className="[overflow-wrap:anywhere]">{name}</span>
                      {user.isSelf && <Badge variant="secondary">You</Badge>}
                    </span>
                    {showEmailUnderName && (
                      <span className="text-muted-foreground [overflow-wrap:anywhere] xl:hidden">{user.email}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden text-muted-foreground xl:table-cell">{user.email}</TableCell>
                <TableCell>
                  <RoleLabel role={user.role} />
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <AccountStatusBadge status={user.status} />
                    {user.signInBlocked && (
                      <span className="inline-flex items-center gap-1 text-sm font-medium text-warn">
                        <LockIcon aria-hidden className="size-3.5" />
                        Sign-in blocked
                      </span>
                    )}
                  </div>
                </TableCell>
                {showSignIns && (
                  <TableCell>
                    <DateText iso={user.lastSignInAt} empty="Never" />
                  </TableCell>
                )}
                <TableCell className="hidden lg:table-cell">
                  <DateText iso={user.createdAt} empty="" />
                </TableCell>
                <TableCell className="pr-4 text-right">
                  <UserActions
                    user={{
                      id: user.id,
                      name,
                      email: user.email,
                      role: user.role,
                      status: user.status,
                      signInBlocked: user.signInBlocked,
                      isSelf: user.isSelf,
                    }}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
