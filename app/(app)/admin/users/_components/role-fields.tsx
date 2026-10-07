"use client";

// The Role choice (Inspector, Lead Inspector, Admin) and the Lead Inspector
// picker, shared by the Invite, Change Role, Change Lead Inspector and
// Activate dialogs. Controlled, with the values sent through hidden inputs:
// every dialog that holds them submits by hand (lib/admin/submit.ts), so
// React's form reset never sends a Radix control back to its first value
// after a refused change.
import type { Ref } from "react";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ROLE_CHOICE_DESCRIPTION,
  ROLE_CHOICE_LABEL,
  ROLE_CHOICES,
  RoleChoiceSchema,
  TEAM_MESSAGES,
  type RoleChoice,
} from "@/lib/auth/org";
import type { LeadOption } from "@/lib/auth/users";
import { RadioCard } from "../../_components/radio-card";

/** Before migration 20261007170000 there are no lead inspectors to choose. */
export const ROLES_WITHOUT_TEAMS: readonly RoleChoice[] = ["inspector", "admin"];

export function roleChoicesFor(teams: boolean): readonly RoleChoice[] {
  return teams ? ROLE_CHOICES : ROLES_WITHOUT_TEAMS;
}

/** Dialogs that hold the role choice scroll inside the viewport: an iPad in landscape, or with its keyboard up, is short. */
export const SCROLLING_DIALOG = "max-h-[calc(100dvh-2rem)] overflow-y-auto";

/** Moves focus to the chosen role, for a refusal the admin answers there (RoleField's groupRef). */
export function focusRole(group: HTMLElement | null): void {
  const radio =
    group?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ?? group?.querySelector<HTMLElement>('[role="radio"]');
  radio?.focus();
}

export function RoleField({
  id,
  value,
  onChange,
  choices = ROLE_CHOICES,
  error,
  groupRef,
}: {
  id: string;
  value: RoleChoice;
  onChange: (choice: RoleChoice) => void;
  choices?: readonly RoleChoice[];
  error?: string;
  /** The radio group, for focusRole(). */
  groupRef?: Ref<HTMLDivElement>;
}) {
  return (
    <FieldSet className="gap-3" aria-describedby={error ? `${id}-role-error` : undefined}>
      {/* A fieldset's legend is no flex item, so the FieldSet's gap never reaches it: its own mb-3 sets the
          12 px under it, the gap-3 between Full Name, Email or Lead Inspector and their controls. */}
      <FieldLegend variant="label" className="leading-snug">
        Role
      </FieldLegend>
      <RadioGroup
        ref={groupRef}
        value={value}
        onValueChange={(next) => {
          const parsed = RoleChoiceSchema.safeParse(next);
          if (parsed.success) onChange(parsed.data);
        }}
        className="grid gap-2"
        aria-invalid={error ? true : undefined}
      >
        {choices.map((choice) => (
          <RadioCard
            key={choice}
            id={`${id}-role-${choice}`}
            value={choice}
            title={ROLE_CHOICE_LABEL[choice]}
            description={ROLE_CHOICE_DESCRIPTION[choice]}
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
