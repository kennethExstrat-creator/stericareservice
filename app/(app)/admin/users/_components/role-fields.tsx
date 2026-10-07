"use client";

// The Role choice (Inspector, Lead inspector, Admin) and the Lead inspector
// picker, shared by the invite, change role, change lead inspector and
// activate dialogs. Controlled, with the values sent through hidden inputs:
// every dialog that holds them submits by hand (lib/admin/submit.ts), so
// React's form reset never sends a Radix control back to its first value
// after a refused change.
import type { Ref } from "react";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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

/** Before migration 20261007170000 there are no lead inspectors to choose. */
export const ROLES_WITHOUT_TEAMS: readonly RoleChoice[] = ["inspector", "admin"];

export function roleChoicesFor(teams: boolean): readonly RoleChoice[] {
  return teams ? ROLE_CHOICES : ROLES_WITHOUT_TEAMS;
}

/** Dialogs that hold the role choice scroll inside the viewport: an iPad in landscape, or with its keyboard up, is short. */
export const SCROLLING_DIALOG = "max-h-[calc(100dvh-2rem)] overflow-y-auto";

export function RoleField({
  id,
  value,
  onChange,
  choices = ROLE_CHOICES,
  error,
}: {
  id: string;
  value: RoleChoice;
  onChange: (choice: RoleChoice) => void;
  choices?: readonly RoleChoice[];
  error?: string;
}) {
  return (
    <FieldSet className="gap-3" aria-describedby={error ? `${id}-role-error` : undefined}>
      <FieldLegend variant="label" className="mb-0">
        Role
      </FieldLegend>
      <RadioGroup
        value={value}
        onValueChange={(next) => {
          const parsed = RoleChoiceSchema.safeParse(next);
          if (parsed.success) onChange(parsed.data);
        }}
        className="grid gap-2"
        aria-invalid={error ? true : undefined}
      >
        {choices.map((choice) => (
          <FieldLabel key={choice} htmlFor={`${id}-role-${choice}`}>
            <Field orientation="horizontal">
              <RadioGroupItem value={choice} id={`${id}-role-${choice}`} />
              <FieldContent>
                <FieldTitle>{ROLE_CHOICE_LABEL[choice]}</FieldTitle>
                <FieldDescription>{ROLE_CHOICE_DESCRIPTION[choice]}</FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
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
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const none = leads.length === 0;
  const describedBy = `${id}-lead-${error ? "error" : "hint"}`;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={`${id}-lead`}>Lead inspector</FieldLabel>
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
        <FieldError id={describedBy}>{error}</FieldError>
      ) : (
        <FieldDescription id={describedBy}>{none ? TEAM_MESSAGES.noLeads : hint}</FieldDescription>
      )}
      <input type="hidden" name="leadId" value={value} />
    </Field>
  );
}
