"use client";

// What the brand, company and factory panels share: the form's state, the
// panel around it and the select that picks what a row goes under. The
// panel is ReferencePanel, as on /admin/clients.

import { useActionState, useState, type ReactNode } from "react";
import { OctagonXIcon, SearchXIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { IDLE, LIMITS, followVersion, unreachable, type ActionResult, type Snapshot } from "@/lib/admin/reference";
import { ReferencePanel } from "./reference-panel";

/**
 * What the panel shows: a brand, company or factory to edit, or a new one,
 * a new company under the brand it was added from and a new factory under
 * its company.
 */
export type ManufacturerTarget =
  | { kind: "brand"; mode: "create" }
  | { kind: "brand"; mode: "edit"; id: string }
  | { kind: "company"; mode: "create"; brandId: string }
  | { kind: "company"; mode: "edit"; id: string }
  | { kind: "factory"; mode: "create"; companyId: string }
  | { kind: "factory"; mode: "edit"; id: string };

/** What every panel takes from the page. */
export type PanelProps<Item, Kind extends ManufacturerTarget["kind"]> = {
  open: boolean;
  target: Extract<ManufacturerTarget, { kind: Kind }>;
  /** The row being edited as the page has it now, or null (adding, or deleted meanwhile). */
  item: Item | null;
  onClose: () => void;
  /** The row was deleted: the panel closes, and its row (and pencil) go. */
  onDeleted: () => void;
  returnFocus: () => void;
};

type SaveAction<Field extends string> = (previous: ActionResult<Field>, formData: FormData) => Promise<ActionResult<Field>>;

/**
 * A panel's form: its values, errors and save.
 *
 * The version a save goes against, with the fields as they were at it, is
 * the row as the panel opened on it (`base`). A newer copy of the row (the
 * page refreshes after any save or delete) moves it on only when its fields
 * are unchanged, such as a factory whose company was renamed; otherwise the
 * save is refused, never quietly written over someone else's change.
 */
export function useEditForm<Item, Field extends string>({
  id,
  fields,
  item,
  snapshotOf,
  blank,
  save,
  onSaved,
}: {
  /** The panel's useId(): each field's id is `${id}-${field}`. */
  id: string;
  /** In the order they appear, so the first one with an error gets the focus. */
  fields: readonly Field[];
  item: Item | null;
  snapshotOf: (item: Item) => Snapshot<Field>;
  /** A new row's fields: blank, under the brand or company it was added from. */
  blank: Record<Field, string>;
  save: SaveAction<Field>;
  onSaved: () => void;
}) {
  const [base, setBase] = useState<Snapshot<Field> | null>(() => (item ? snapshotOf(item) : null));
  // The last copy of the row this panel saw: it keeps showing while the
  // panel closes after a delete, when the row has already left the page.
  const [shown, setShown] = useState(item);
  if (item && item !== shown) {
    setShown(item);
    if (base) {
      const next = followVersion(base, snapshotOf(item));
      if (next !== base) setBase(next);
    }
  }

  const [values, setValues] = useState<Record<Field, string>>(() => base?.values ?? blank);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  const [state, formAction, pending] = useActionState(
    async (previous: ActionResult<Field>, formData: FormData): Promise<ActionResult<Field>> => {
      const result: ActionResult<Field> = await save(previous, formData).catch(unreachable);
      if (result.status === "success") {
        toast.success(result.message);
        onSaved();
      } else if (result.status === "error") {
        // Refused over someone else's change: a second save replaces it, as the message offers.
        if (result.latest) setBase(result.latest);
        const fieldErrors: Partial<Record<Field, string>> = result.fieldErrors ?? {};
        setErrors(fieldErrors);
        const first = fields.find((field) => fieldErrors[field]);
        if (first) document.getElementById(`${id}-${first}`)?.focus();
      }
      return result;
    },
    IDLE,
  );

  // Against what the panel opened on, not the latest copy: someone else's
  // change is not something typed here.
  const saved = base?.values ?? blank;
  const dirty = fields.some((field) => values[field] !== saved[field]);
  const formError = state.status === "error" && !state.fieldErrors ? state.message : null;

  function setValue(name: Field, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    if (errors[name]) setErrors((current) => ({ ...current, [name]: undefined }));
  }

  /** A text field's props (TextField), with the column's length limit. */
  function text(name: Field & keyof typeof LIMITS) {
    return {
      id: `${id}-${name}`,
      name,
      value: values[name],
      error: errors[name],
      maxLength: LIMITS[name],
      onValueChange: (value: string) => setValue(name, value),
    };
  }

  /** A choice's props (ChoiceField). */
  function choice(name: Field) {
    return {
      id: `${id}-${name}`,
      name,
      value: values[name],
      error: errors[name],
      onValueChange: (value: string) => setValue(name, value),
    };
  }

  return { base, shown, values, formAction, pending, dirty, formError, text, choice };
}

type EditPanelProps = {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  returnFocus: () => void;
  title: string;
  editing: boolean;
  /** The submit button when adding: "Add Brand". */
  addLabel: string;
  /** Said when the row was deleted while the panel was open; null while it is there. */
  gone: string | null;
  dirty: boolean;
  formId: string;
  formAction: (formData: FormData) => void;
  /** The row's id and the version the form started from; blank when adding. */
  target: { id: string; version: string };
  formError: string | null;
  /** The fields, inside the form. */
  children: ReactNode;
  /** Below the form: deleting. */
  after?: ReactNode;
};

/** A brand's, company's or factory's panel: the form, its buttons, and deleting below it. */
export function EditPanel({
  open,
  busy,
  onClose,
  returnFocus,
  title,
  editing,
  addLabel,
  gone,
  dirty,
  formId,
  formAction,
  target,
  formError,
  children,
  after,
}: EditPanelProps) {
  return (
    <ReferencePanel
      open={open}
      busy={busy}
      onClose={onClose}
      returnFocus={returnFocus}
      title={title}
      footer={
        gone ? (
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {dirty ? "Cancel" : "Close"}
            </Button>
            <Button type="submit" form={formId} disabled={busy}>
              {busy && <Spinner aria-hidden />}
              {busy ? (editing ? "Saving…" : "Adding…") : editing ? "Save Changes" : addLabel}
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
            <EmptyDescription>{gone}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <form id={formId} action={formAction} noValidate>
            <input type="hidden" name="id" value={target.id} />
            <input type="hidden" name="version" value={target.version} />
            <FieldGroup className="gap-5">{children}</FieldGroup>

            {/* role="alert": read out as soon as it appears. */}
            {formError && (
              <Alert variant="destructive" className="mt-5">
                <OctagonXIcon aria-hidden />
                <AlertDescription className="text-destructive">{formError}</AlertDescription>
              </Alert>
            )}
          </form>
          {after}
        </>
      )}
    </ReferencePanel>
  );
}

/** Options of a choice, in groups under a heading (a brand's companies), or one group without. */
export type ChoiceGroup = { label: string | null; options: ReadonlyArray<{ value: string; label: string }> };

/**
 * A labelled select: the brand a company trades under, the company a factory
 * belongs to. Controlled, with the value sent in a hidden input, so React's
 * form reset never sends the Radix control back to its first value after a
 * refused save.
 */
export function ChoiceField({
  id,
  name,
  label,
  value,
  onValueChange,
  error,
  placeholder,
  groups,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  error?: string;
  placeholder: string;
  groups: readonly ChoiceGroup[];
}) {
  const errorId = error ? `${id}-error` : undefined;
  return (
    <Field data-invalid={error ? true : undefined} className="gap-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id} className="w-full" aria-invalid={error ? true : undefined} aria-describedby={errorId}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {groups.map((group, index) => (
            <SelectGroup key={group.label ?? index}>
              {group.label !== null && <SelectLabel className="touch:text-sm">{group.label}</SelectLabel>}
              {group.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="truncate">{option.label}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {error && <FieldError id={errorId}>{error}</FieldError>}
      <input type="hidden" name={name} value={value} />
    </Field>
  );
}
