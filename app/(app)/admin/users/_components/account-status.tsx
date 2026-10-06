import { BanIcon, CircleCheckIcon, ClockIcon, ShieldCheckIcon, UserRoundIcon, type LucideIcon } from "lucide-react";
import type { AccountStatus, UserRole } from "@/lib/auth/users";
import { STATUS_TINT_CLASS } from "@/lib/design/status";
import { cn } from "@/lib/utils";

// Account states borrow the status tokens (docs/DESIGN.md) with icons that fit
// accounts: active is green, waiting for an admin is amber, deactivated is a
// neutral slate. Always icon plus words, never colour alone.
const ACCOUNT_STATUS: Record<AccountStatus, { label: string; icon: LucideIcon; className: string }> = {
  active: { label: "Active", icon: CircleCheckIcon, className: STATUS_TINT_CLASS.pass },
  pending: { label: "Pending activation", icon: ClockIcon, className: STATUS_TINT_CLASS.warn },
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

export const ROLE_LABEL: Record<UserRole, string> = { inspector: "Inspector", admin: "Admin" };

export function RoleLabel({ role }: { role: UserRole }) {
  const Icon = role === "admin" ? ShieldCheckIcon : UserRoundIcon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap",
        role === "admin" ? "font-semibold text-brand-700" : "text-foreground",
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {ROLE_LABEL[role]}
    </span>
  );
}
