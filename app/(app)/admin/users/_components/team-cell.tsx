// Where someone sits in the teams, for the user list, by what their role
// sees: their own inspections, their lead inspector (a link to that team) or
// the problem of an active one in no team; their team's, the team's size (a
// link to it); every inspection, nothing.
import Link from "next/link";
import { TriangleAlertIcon } from "lucide-react";
import type { UserListItem } from "@/lib/auth/users";
import { STATUS_TINT_CLASS } from "@/lib/design/status";
import { cn } from "@/lib/utils";
import { teamHref } from "../_lib/team-filter";

/** Brand links (docs/DESIGN.md), 44 px tall on touch so a finger finds them in the row. */
const LINK =
  "rounded-sm font-medium text-brand-600 underline-offset-4 hover:underline focus-ring touch:inline-flex touch:min-h-11 touch:items-center";

function inspectorsText(count: number): string {
  return count === 1 ? "1 inspector" : `${count} inspectors`;
}

/** The problem flag: an active inspector who has no lead inspector yet. */
export function NoLeadBadge() {
  return (
    <span
      data-slot="no-lead"
      className={cn(
        "inline-flex h-7 w-fit items-center gap-1.5 rounded-full border px-3 text-sm font-semibold whitespace-nowrap",
        "fine:h-6 fine:gap-1 fine:px-2 fine:text-xs",
        STATUS_TINT_CLASS.warn,
      )}
    >
      <TriangleAlertIcon aria-hidden className="size-4 fine:size-3.5" />
      No Lead Inspector
    </span>
  );
}

export function TeamCell({ user }: { user: UserListItem }) {
  if (user.role.access === "all") {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden>—</span>
        <span className="sr-only">In no team</span>
      </span>
    );
  }
  if (user.role.access === "team") {
    const size = user.team.length;
    // Short and fixed, so on one line: a row stays one line high on desktop beside the UID column.
    if (size === 0) return <span className="whitespace-nowrap text-muted-foreground">No team yet</span>;
    return (
      <Link
        href={teamHref(user.id)}
        className={cn(LINK, "whitespace-nowrap")}
        aria-label={`Leads ${inspectorsText(size)}: show the team`}
      >
        Leads {inspectorsText(size)}
      </Link>
    );
  }
  if (user.lead) {
    return (
      <Link href={teamHref(user.lead.id)} className={cn(LINK, "[overflow-wrap:anywhere]")} aria-label={`${user.lead.name}: show their team`}>
        {user.lead.name}
      </Link>
    );
  }
  if (user.missingLead) return <NoLeadBadge />;
  return <span className="text-muted-foreground">None</span>;
}
