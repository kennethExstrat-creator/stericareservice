"use client";

import { useActionState, useId, useState, type FormEvent } from "react";
import { LockIcon, OctagonXIcon, SearchXIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { FieldError, FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { IDLE, unreachable } from "@/lib/admin/reference";
import {
  NEW_ROLE,
  ROLE_LIMITS,
  ROLE_MESSAGES,
  accessLock,
  cleanPermissions,
  cleanedValues,
  followRoleVersion,
  isRoleAccess,
  roleSnapshot,
  roleValues,
  sameRoleValues,
  whoHasRole,
  type RoleField,
  type RoleItem,
  type RoleResult,
  type RoleSnapshot,
  type RoleValues,
} from "@/lib/admin/roles";
import { submitAction } from "@/lib/admin/submit";
import { ROLE_ACCESS, ROLE_ACCESS_INFO, type RoleAccess } from "@/lib/auth/permissions";
import { RadioCard } from "../../_components/radio-card";
import { TextField } from "../../manufacturers/_components/reference-field";
import { ReferencePanel, type PanelTarget } from "../../manufacturers/_components/reference-panel";
import { createRole, updateRole } from "../actions";
import { PermissionSwitches } from "./permission-switches";
import { RoleDeleteSection } from "./role-delete";

type FieldErrors = Partial<Record<RoleField, string>>;

/** Fields in the order they appear, so the first one with an error gets the focus. */
const FIELDS: readonly RoleField[] = ["name", "description", "access"];

type RolePanelProps = {
  open: boolean;
  target: PanelTarget;
  /** The role being edited as the page has it now, or null (adding, or deleted meanwhile). */
  item: RoleItem | null;
  onClose: () => void;
  /** The role was deleted: the panel closes, and its row (and Edit button) go. */
  onDeleted: () => void;
  returnFocus: () => void;
};

/**
 * Add a role, or edit one: its name and description, what its people see,
 * and its switches. A built-in role keeps its name and what it sees; the
 * Admin role opens read-only, every switch on (it has everything, and
 * nothing here changes it). What a custom role sees is locked while people
 * have it. Deleting sits at the end of a custom role's panel.
 *
 * Submitted by hand (lib/admin/submit.ts): React resets a form after its
 * action, and the Sees radios and the switches would go back to their first
 * values after a refused save.
 */
export function RolePanel({ open, target, item, onClose, onDeleted, returnFocus }: RolePanelProps) {
  const id = useId();
  const formId = `${id}-form`;
  const editing = target.mode === "edit";

  // The version a save goes against, with the fields as they were at it: the
  // role as the panel opened on it. A newer copy (the page refreshes after
  // any save or delete here) moves it on only when its fields are unchanged;
  // otherwise the save is refused, never quietly written over someone else's
  // change.
  const [base, setBase] = useState<RoleSnapshot | null>(() => (item ? roleSnapshot(item) : null));
  // The last copy of the role this panel saw: it keeps showing while the
  // panel closes after a delete, when the role has already left the list.
  const [shown, setShown] = useState(item);
  if (item && item !== shown) {
    setShown(item);
    if (base) {
      const next = followRoleVersion(base, roleSnapshot(item));
      if (next !== base) setBase(next);
    }
  }
  const gone = open && editing && !item;
  const builtIn = editing ? (shown?.builtIn ?? null) : null;
  const readOnly = builtIn === "admin";

  const [values, setValues] = useState<RoleValues>(() => roleValues(item));
  const [errors, setErrors] = useState<FieldErrors>({});

  const save = editing ? updateRole : createRole;
  const [state, formAction, pending] = useActionState(
    async (previous: RoleResult, formData: FormData): Promise<RoleResult> => {
      const result: RoleResult = await save(previous, formData).catch(unreachable);
      if (result.status === "success") {
        toast.success(result.message);
        onClose();
      } else if (result.status === "error") {
        // Refused over someone else's change: a second save replaces it, as the message offers.
        if (result.latest) setBase(result.latest);
        const fieldErrors = result.fieldErrors ?? {};
        setErrors(fieldErrors);
        const first = FIELDS.find((field) => fieldErrors[field]);
        // Sees: the radio chosen, which the refusal is about.
        if (first === "access") {
          document.getElementById(`${id}-access`)?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
        } else if (first) {
          document.getElementById(`${id}-${first}`)?.focus();
        }
      }
      return result;
    },
    IDLE,
  );

  // Against what the panel opened on, not the latest copy: someone else's
  // change is not something done here.
  const dirty = !readOnly && !sameRoleValues(cleanedValues(values), base?.values ?? NEW_ROLE);
  const formError = state.status === "error" && !state.fieldErrors ? state.message : null;

  function change(patch: Partial<RoleValues>) {
    setValues((current) => ({ ...current, ...patch }));
    clearErrors(Object.keys(patch) as RoleField[]);
  }

  // Seeing fewer inspections switches off what needs every one (approving, among others).
  function changeAccess(access: RoleAccess) {
    setValues((current) => ({ ...current, access, permissions: cleanPermissions(current.permissions, access) }));
    clearErrors(["access"]);
  }

  function clearErrors(fields: readonly RoleField[]) {
    if (!fields.some((field) => errors[field])) return;
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([field]) => !fields.includes(field as RoleField))));
  }

  function field(name: "name" | "description") {
    return {
      id: `${id}-${name}`,
      name,
      value: values[name],
      error: errors[name],
      maxLength: ROLE_LIMITS[name],
      onValueChange: (value: string) => change(name === "name" ? { name: value } : { description: value }),
    };
  }

  // The Admin role has nothing to save, so its form never sends.
  const submit = readOnly ? (event: FormEvent<HTMLFormElement>) => event.preventDefault() : submitAction(formAction, pending);

  return (
    <ReferencePanel
      open={open}
      busy={pending}
      onClose={onClose}
      returnFocus={returnFocus}
      title={!editing ? "Add Role" : readOnly ? `${shown?.name ?? "Admin"} Role` : "Edit Role"}
      description={panelDescription(editing ? shown : null, readOnly)}
      footer={
        gone || readOnly ? (
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            {/* By the button just pressed: the switches make the form taller than the panel, so a message
                at its end would be out of sight. role="alert": read out as soon as it appears. */}
            {formError && (
              <Alert variant="destructive" className="basis-full">
                <OctagonXIcon aria-hidden />
                <AlertDescription className="text-destructive">{formError}</AlertDescription>
              </Alert>
            )}
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {dirty ? "Cancel" : "Close"}
            </Button>
            <Button type="submit" form={formId} disabled={pending}>
              {pending && <Spinner aria-hidden />}
              {pending ? (editing ? "Saving…" : "Adding…") : editing ? "Save Changes" : "Add Role"}
            </Button>
          </>
        )
      }
    >
      {gone ? (
        <Empty className="border border-dashed border-border p-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>No Longer on the List</EmptyTitle>
            <EmptyDescription>Someone has deleted this role.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <form id={formId} onSubmit={submit} noValidate>
            <input type="hidden" name="id" value={editing ? target.id : ""} />
            <input type="hidden" name="version" value={editing ? (base?.version ?? "") : ""} />
            <input type="hidden" name="access" value={values.access} />
            {builtIn && <input type="hidden" name="name" value={values.name} />}
            {values.permissions.map((permission) => (
              <input key={permission} type="hidden" name="permissions" value={permission} />
            ))}

            <FieldGroup className="gap-6">
              {builtIn ? (
                <LockedValue id={`${id}-name`} label="Name" value={values.name} hint="Built-in roles keep their names." />
              ) : (
                <TextField {...field("name")} label="Name" autoCapitalize="words" description="e.g. QC Manager or Office Staff." />
              )}
              {readOnly ? (
                values.description && <LockedValue id={`${id}-description`} label="Description" value={values.description} />
              ) : (
                <TextField
                  {...field("description")}
                  label="Description (Optional)"
                  multiline
                  description="Shown under the name in the list."
                />
              )}
              <AccessField
                id={`${id}-access`}
                value={values.access}
                onChange={changeAccess}
                lock={editing ? accessLock(shown) : null}
                error={errors.access}
                disabled={pending}
              />
              <PermissionSwitches
                access={values.access}
                permissions={values.permissions}
                onChange={(permissions) => change({ permissions })}
                adminRole={readOnly}
                disabled={pending}
              />
            </FieldGroup>
          </form>

          {editing && shown && !shown.builtIn && <RoleDeleteSection role={shown} onDeleted={onDeleted} />}
        </>
      )}
    </ReferencePanel>
  );
}

/** Under the panel's title: what changes reach, or why nothing does. */
function panelDescription(role: RoleItem | null, readOnly: boolean): string {
  if (readOnly) return ROLE_MESSAGES.adminRole;
  if (!role) return "Name the role, choose what its people see, and switch on what they may use.";
  return role.people > 0 ? `${whoHasRole(role.people)}: changes apply to them at once.` : `${whoHasRole(0)} yet.`;
}

/**
 * A value that does not change here (a built-in role's name, the Admin
 * role's description), on a read-only field's grey (docs/DESIGN.md, Field)
 * and the field's size, but as text: nothing invites typing, and the panel's
 * opening focus goes to the first field that can change.
 */
function LockedValue({ id, label, value, hint }: { id: string; label: string; value: string; hint?: string }) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={hintId} className="flex flex-col gap-2" data-locked="">
      <span id={`${id}-label`} className="text-sm leading-snug font-medium text-foreground">
        {label}
      </span>
      <p className="rounded-md bg-muted px-2.5 py-2 text-base text-foreground [overflow-wrap:anywhere] fine:text-sm touch:px-3 touch:py-2.5">
        {value}
      </p>
      {hint && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * Sees: Own, Team or All Inspections, as cards (the whole card chooses).
 * Locked, it still shows the choice, and says why it cannot change.
 */
function AccessField({
  id,
  value,
  onChange,
  lock,
  error,
  disabled,
}: {
  id: string;
  value: RoleAccess;
  onChange: (access: RoleAccess) => void;
  /** Why it cannot change, or null when it can. */
  lock: string | null;
  error?: string;
  disabled?: boolean;
}) {
  const lockId = `${id}-lock`;
  const errorId = `${id}-error`;
  const describedBy = [lock ? lockId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <FieldSet className="gap-3" aria-describedby={describedBy} data-invalid={error ? true : undefined}>
      {/* A legend is no flex item, so the FieldSet's gap misses it: mb-2 sets the 8 px under it. */}
      <FieldLegend variant="label" className="mb-2">
        Sees
      </FieldLegend>
      {lock && (
        <p id={lockId} className="flex gap-2 text-sm text-muted-foreground touch:text-base">
          <LockIcon aria-hidden className="mt-0.5 size-4 shrink-0 touch:mt-1" />
          <span>{lock}</span>
        </p>
      )}
      <RadioGroup
        id={id}
        value={value}
        onValueChange={(next) => {
          if (isRoleAccess(next)) onChange(next);
        }}
        disabled={Boolean(lock) || disabled}
        className="grid gap-2"
        aria-invalid={error ? true : undefined}
      >
        {ROLE_ACCESS.map((access) => (
          <RadioCard
            key={access}
            id={`${id}-${access}`}
            value={access}
            title={ROLE_ACCESS_INFO[access].label}
            description={ROLE_ACCESS_INFO[access].description}
          />
        ))}
      </RadioGroup>
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </FieldSet>
  );
}
