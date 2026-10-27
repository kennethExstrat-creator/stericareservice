import {
  BanIcon,
  CircleCheckIcon,
  ClockIcon,
  MailIcon,
  ShieldCheckIcon,
  ShieldIcon,
  UserRoundIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";
import type { RoleOption } from "@/lib/auth/org";
import type { RoleAccess } from "@/lib/auth/permissions";
import type { AccountStatus } from "@/lib/auth/users";
import { STATUS_TINT_CLASS } from "@/lib/design/status";
import { cn } from "@/lib/utils";

// Account states borrow the status tokens (docs/DESIGN.md) with icons that fit
// accounts: active is green, waiting for an admin is amber, deactivated is a
// neutral slate. Invited waits on the person, not the admin, so it reads as
// not done yet: the dashed slate of Not Done. Always icon plus words, never
// colour alone.
const ACCOUNT_STATUS: Record<AccountStatus, { label: string; icon: LucideIcon; className: string }> = {
  active: { label: "Active", icon: CircleCheckIcon, className: STATUS_TINT_CLASS.pass },
  invited: { label: "Invited", icon: MailIcon, className: STATUS_TINT_CLASS.not_done },
  pending: { label: "Pending Activation", icon: ClockIcon, className: STATUS_TINT_CLASS.warn },
  deactivated: { label: "Deactivated", icon: BanIcon, className: STATUS_TINT_CLASS.info },
};

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const { label, icon: Icon, className } = ACCOUNT_STATUS[status];
  return (
    <span
      data-slot="account-status"
      data-status={status}
      className={cn(
        "inline-flex h-7 w-fit shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold whitespace-nowrap",
        // With a mouse or trackpad: the small pill (StatusPill size="sm"), for compact rows.
        "fine:h-6 fine:gap-1 fine:px-2 fine:text-xs",
        className,
      )}
    >
      <Icon aria-hidden className="size-4 fine:size-3.5" />
      {label}
    </span>
  );
}

/** What a role's people see, as its icon: one person, a team, or everyone (a shield). */
const ACCESS_ICON: Record<RoleAccess, LucideIcon> = {
  own: UserRoundIcon,
  team: UsersRoundIcon,
  all: ShieldIcon,
};

/**
 * Longer names wrap: a custom role may have up to 60 characters, and on one
 * line it would squeeze every other column (the Role column is 176 px wide
 * on an iPad in portrait). Shorter ones, "Lead Inspector" among them, stay on
 * one line, so a row stays one line high on desktop.
 */
const ONE_LINE_ROLE_NAME = 16;

/**
 * Someone's role by its name, custom roles too, with an icon for what it
 * sees: the built-in Admin role, which alone manages users and roles, with a
 * checked shield in brand blue.
 */
export function RoleLabel({ role }: { role: Pick<RoleOption, "builtIn" | "name" | "access"> }) {
  const admin = role.builtIn === "admin";
  const Icon = admin ? ShieldCheckIcon : ACCESS_ICON[role.access];
  return (
    <span
      data-slot="role"
      data-role={role.builtIn ?? "custom"}
      data-access={role.access}
      className={cn(
        "inline-flex items-center gap-1.5",
        role.name.length > ONE_LINE_ROLE_NAME ? "whitespace-normal" : "whitespace-nowrap",
        admin ? "font-semibold text-brand-700" : role.access === "own" ? "text-foreground" : "font-medium text-foreground",
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {role.name}
    </span>
  );
}
