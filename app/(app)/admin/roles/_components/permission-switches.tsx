"use client";

// A role's switches on its panel, in two groups as lib/auth/permissions.ts
// lists them: Screens, then Actions. Each row is a label and its description
// with the switch at the end of the label's row (as the Report page's
// options), the label a label for the switch so a tap on the words switches
// too; 44 px on any touchscreen. A locked switch still shows its state and
// says why: one that needs every inspection while the role sees fewer, and
// Users and Roles & Permissions, which no switch gives (on for the Admin
// role, off for every other). The Admin role's switches are all on and
// locked.
import { useId, type ReactNode } from "react";
import { InfoIcon, LockIcon } from "lucide-react";
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import {
  ACTION_INFO,
  ADMIN_ONLY_NOTE,
  NEEDS_ALL_ACCESS,
  SCREEN_INFO,
  switchPermission,
  usableWith,
} from "@/lib/admin/roles";
import { ADMIN_ONLY, ADMIN_ONLY_INFO, type Permission, type PermissionInfo, type RoleAccess } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

type PermissionSwitchesProps = {
  access: RoleAccess;
  permissions: readonly Permission[];
  onChange: (permissions: Permission[]) => void;
  /** The built-in Admin role: every switch on and locked. */
  adminRole: boolean;
  /** While a save runs. */
  disabled?: boolean;
};

export function PermissionSwitches({ access, permissions, onChange, adminRole, disabled }: PermissionSwitchesProps) {
  const id = useId();
  const noteId = `${id}-admin-only`;
  const on = new Set<string>(permissions);

  function row(info: PermissionInfo) {
    const usable = adminRole || usableWith(info.key, access);
    return (
      <SwitchRow
        key={info.key}
        id={`${id}-${info.key}`}
        name={info.key}
        label={info.label}
        description={info.description}
        checked={adminRole || (usable && on.has(info.key))}
        locked={adminRole || !usable}
        reason={usable ? undefined : NEEDS_ALL_ACCESS}
        disabled={disabled}
        onCheckedChange={(checked) => onChange(switchPermission(permissions, info.key, checked, access))}
      />
    );
  }

  return (
    <>
      <SwitchGroup title="Screens" description="Which screens under Admin its people may open.">
        <SwitchList>
          {SCREEN_INFO.map(row)}
          {ADMIN_ONLY.map((key) => (
            <SwitchRow
              key={key}
              id={`${id}-${key}`}
              name={key}
              label={ADMIN_ONLY_INFO[key].label}
              description={ADMIN_ONLY_INFO[key].description}
              checked={adminRole}
              locked
              describedBy={noteId}
            />
          ))}
        </SwitchList>
        <p id={noteId} className="flex gap-2 text-sm text-muted-foreground touch:text-base">
          <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 touch:mt-1" />
          <span>{ADMIN_ONLY_NOTE}</span>
        </p>
      </SwitchGroup>
      <SwitchGroup title="Actions" description="What its people may do with inspections.">
        <SwitchList>{ACTION_INFO.map(row)}</SwitchList>
      </SwitchGroup>
    </>
  );
}

function SwitchGroup({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <FieldSet className="gap-3">
      {/* A legend is no flex item, so the FieldSet's gap misses it: mb-2 sets the 8 px under it. */}
      <FieldLegend variant="label" className="mb-2">
        {title}
      </FieldLegend>
      <FieldDescription className="-mt-1">{description}</FieldDescription>
      {children}
    </FieldSet>
  );
}

function SwitchList({ children }: { children: ReactNode }) {
  return <ul className="grid divide-y divide-border rounded-lg bg-card ring-1 ring-border">{children}</ul>;
}

function SwitchRow({
  id,
  name,
  label,
  description,
  checked,
  locked,
  reason,
  describedBy,
  disabled,
  onCheckedChange,
}: {
  id: string;
  /** The permission's key, for tests and the e2e specs. */
  name: string;
  label: string;
  description: string;
  checked: boolean;
  /** Shown as it is, not changed here. */
  locked: boolean;
  /** Why it is locked, under its description. */
  reason?: string;
  /** Another element that explains it (the note under Users and Roles & Permissions). */
  describedBy?: string;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}) {
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  const reasonId = reason ? `${id}-reason` : undefined;
  return (
    <li
      className="flex items-start gap-4 px-3 py-2.5 touch:px-4 touch:py-3"
      data-permission={name}
      data-on={checked}
      data-locked={locked || undefined}
    >
      <div className="grid min-w-0 flex-1 gap-0.5">
        <label
          id={labelId}
          htmlFor={id}
          className={cn("w-fit text-sm leading-snug font-medium text-foreground touch:text-base", !locked && "cursor-pointer")}
        >
          {label}
        </label>
        <span id={descriptionId} className="text-sm text-muted-foreground touch:text-base">
          {description}
        </span>
        {reason && (
          <span id={reasonId} className="flex gap-1.5 text-sm text-muted-foreground touch:text-base">
            <LockIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 touch:mt-1" />
            <span>{reason}</span>
          </span>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={locked || disabled}
        aria-labelledby={labelId}
        aria-describedby={[descriptionId, reasonId, describedBy].filter(Boolean).join(" ")}
        className="mt-0.5 touch:mt-0"
      />
    </li>
  );
}
