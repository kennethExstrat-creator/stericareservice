"use client";

// The Role choice (the roles of public.roles: the built-in ones, then custom
// roles) and the Lead Inspector picker, shared by the Invite, Change Role,
// Change Lead Inspector and Activate dialogs. Controlled, with the values
// sent through hidden inputs: every dialog that holds them submits by hand
// (lib/admin/submit.ts), so React's form reset never sends a Radix control
// back to its first value after a refused change.
import type { Ref } from "react";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { roleHint, roleValue, TEAM_MESSAGES, type RoleOption } from "@/lib/auth/org";
import type { LeadOption } from "@/lib/auth/users";
import { RadioCard } from "../../_components/radio-card";

/** Dialogs that hold the role choice scroll inside the viewport: an iPad in landscape, or with its keyboard up, is short. */
export const SCROLLING_DIALOG = "max-h-[calc(100dvh-2rem)] overflow-y-auto";

/** Moves focus to the chosen role, for a refusal the admin answers there (RoleField's groupRef). */
export function focusRole(group: HTMLElement | null): void {
  const radio =
    group?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ?? group?.querySelector<HTMLElement>('[role="radio"]');
  radio?.focus();
}

/**
 * One card per role, in the order given (the directory's: Admin, Lead
 * Inspector, Inspector, then custom roles by name), each saying what its
 * people see. The value sent is the role's id (roleValue()).
 */
export function RoleField({
  id,
  value,
  onChange,
  roles,
  error,
  groupRef,
}: {
  id: string;
  /** The chosen role's value (roleValue()). */
  value: string;
  onChange: (value: string) => void;
  roles: readonly RoleOption[];
  error?: string;
  /** The radio group, for focusRole(). */
  groupRef?: Ref<HTMLDivElement>;
}) {
  return (
    <FieldSet className="gap-3" aria-describedby={error ? `${id}-role-error` : undefined}>
      {/* A fieldset's legend is no flex item, so the FieldSet's gap never reaches it: its own mb-3 sets the
          12 px under it, the gap-3 between Email or Lead Inspector and their controls. */}
      <FieldLegend id={`${id}-role-legend`} variant="label" className="leading-snug">
        Role
      </FieldLegend>
      <RadioGroup
        ref={groupRef}
        value={value}
        onValueChange={(next) => {
          if (roles.some((role) => roleValue(role) === next)) onChange(next);
        }}
        className="grid gap-2"
        aria-labelledby={`${id}-role-legend`}
        aria-invalid={error ? true : undefined}
      >
        {roles.map((role) => (
          <RadioCard
            key={roleValue(role)}
            id={`${id}-role-${roleValue(role)}`}
            value={roleValue(role)}
            title={role.name}
            description={roleHint(role)}
          />
        ))}
      </RadioGroup>
      {error && <FieldError id={`${id}-role-error`}>{error}</FieldError>}
      <input type="hidden" name="role" value={value} />
    </FieldSet>
  );
}

export function LeadField({
  id,
  value,
  onChange,
  leads,
  error,
  hint = "Their lead inspector also sees their inspections, read-only.",
  emptyHint = TEAM_MESSAGES.noLeads,
  triggerRef,
}: {
  id: string;
  /** The chosen lead's id, or "" for none yet. */
  value: string;
  onChange: (leadId: string) => void;
  /** Active lead inspectors who may lead this person (never themselves). */
  leads: readonly LeadOption[];
  error?: string;
  hint?: string;
  /** What to do when there is nobody to choose (leadChoicesFor() in user-menu.ts). */
  emptyHint?: string;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const none = leads.length === 0;
  const describedBy = `${id}-lead-${error ? "error" : "hint"}`;
  // With nobody to choose, the way out stays in view: a refusal only marks it,
  // since "Choose their lead inspector" under an empty picker leads nowhere.
  const errorText = none ? emptyHint : error;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={`${id}-lead`}>Lead Inspector</FieldLabel>
      <Select value={value} onValueChange={onChange} disabled={none}>
        <SelectTrigger
          ref={triggerRef}
          id={`${id}-lead`}
          className="w-full"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        >
          <SelectValue placeholder={none ? "No lead inspector yet" : "Choose their lead inspector"} />
        </SelectTrigger>
        <SelectContent>
          {leads.map((lead) => (
            <SelectItem key={lead.id} value={lead.id}>
              <span className="truncate">{lead.name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <FieldError id={describedBy}>{errorText}</FieldError>
      ) : (
        <FieldDescription id={describedBy}>{none ? emptyHint : hint}</FieldDescription>
      )}
      <input type="hidden" name="leadId" value={value} />
    </Field>
  );
}
