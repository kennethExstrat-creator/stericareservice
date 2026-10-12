"use client";

import { useActionState, useId, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { InfoIcon, OctagonXIcon, PlusIcon, SearchXIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { RadioGroup } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { IDLE, addCodeHref, unreachable } from "@/lib/admin/defects";
import {
  SHORTFORM_FIELDS,
  entryOf,
  newCodeFor,
  type LibraryCode,
  type ShortformField,
  type ShortformItem,
  type ShortformResult,
} from "@/lib/admin/shortforms";
import { submitAction } from "@/lib/admin/submit";
import type { GlossaryEntry, GlossaryKind } from "@/lib/schemas/ai-settings";
import { RadioCard } from "../../_components/radio-card";
import { deleteShortform, saveShortform } from "../actions";
import { focusFirst, Panel, PanelSection, type ShortformTarget } from "./panel";
import { CodePicker } from "./code-picker";
import { TextField } from "./text-field";

type Values = { short: string; kind: GlossaryKind; codes: string[]; meaning: string; confirmed: boolean };
type FieldErrors = Partial<Record<ShortformField, string>>;

const KINDS: { value: GlossaryKind; title: string; description: string }[] = [
  { value: "defect", title: "Defect", description: "Counted under a defect code." },
  { value: "term", title: "Other Term", description: "A test, product or factory word." },
];

/** A new shortform starts as a confirmed defect: what an inspector told the admin. */
const EMPTY: Values = { short: "", kind: "defect", codes: [], meaning: "", confirmed: true };

function valuesOf(entry: GlossaryEntry | null): Values {
  return entry ? { ...entry, codes: [...entry.codes] } : EMPTY;
}

function sameValues(a: Values, b: Values): boolean {
  return (
    a.short === b.short &&
    a.kind === b.kind &&
    a.meaning === b.meaning &&
    a.confirmed === b.confirmed &&
    a.codes.join(" ") === b.codes.join(" ")
  );
}

type ShortformPanelProps = {
  open: boolean;
  target: ShortformTarget;
  /** The shortform being edited as the page has it now, or null (adding, or deleted meanwhile). */
  item: ShortformItem | null;
  /** Every defect code, by name: the picker offers the active ones. */
  library: readonly LibraryCode[];
  onClose: () => void;
  /** Closes the panel after this shortform was deleted: its row, and the button that opened the panel, go too. */
  onDeleted: () => void;
  /** Puts the keyboard back where the panel opened from, once it has closed. */
  returnFocus: () => void;
};

/**
 * Add a shortform, or edit one: what inspectors write, a defect (with the
 * codes it counts under) or another term, what it means, and whether an
 * inspector confirmed it. One at a time: a save is checked against the
 * shortform as the panel opened it, so it never quietly replaces someone
 * else's change.
 */
export function ShortformPanel({ open, target, item, library, onClose, onDeleted, returnFocus }: ShortformPanelProps) {
  const id = useId();
  const formId = `${id}-form`;
  const editing = target.mode === "edit";

  // The shortform as the panel opened on it: what a save and a delete are checked against.
  const [base] = useState<GlossaryEntry | null>(() => (item ? entryOf(item) : null));
  // The last copy the panel saw: it keeps showing while the panel closes after a delete.
  const [shown, setShown] = useState(item);
  if (item && item !== shown) setShown(item);
  const gone = open && editing && !item;

  const [values, setValues] = useState<Values>(() => valuesOf(base));
  const [errors, setErrors] = useState<FieldErrors>({});

  const [state, formAction, pending] = useActionState(
    async (previous: ShortformResult, formData: FormData): Promise<ShortformResult> => {
      const result: ShortformResult = await saveShortform(previous, formData).catch(unreachable);
      if (result.status === "success") {
        toast.success(result.message);
        onClose();
      } else if (result.status === "error") {
        const fieldErrors = result.fieldErrors ?? {};
        setErrors(fieldErrors);
        const first = SHORTFORM_FIELDS.find((field) => fieldErrors[field]);
        if (first === "codes") {
          // The picker's button, or its first remove button when three codes are chosen.
          focusFirst([document.getElementById(`${id}-codes`), document.getElementById(`${id}-codes-group`)?.querySelector("button")]);
        } else if (first) {
          document.getElementById(`${id}-${first}`)?.focus();
        }
      }
      return result;
    },
    IDLE,
  );

  const dirty = !sameValues(values, valuesOf(base));
  const formError = state.status === "error" && !state.fieldErrors ? state.message : null;
  const taken = new Set(library.map((code) => code.code));
  // Add a Code leaves for the Codes tab, and the panel goes with it: offered only for a saved
  // shortform with nothing unsaved, so a new or changed one is never lost on the way.
  const newCode = editing && !dirty && values.codes.length === 0 ? newCodeFor(values.short, values.meaning, taken) : null;

  function change(patch: Partial<Values>) {
    setValues((current) => ({ ...current, ...patch }));
    const cleared = Object.keys(patch).filter((field) => errors[field as ShortformField]);
    if (cleared.length > 0) {
      setErrors((current) => Object.fromEntries(Object.entries(current).filter(([field]) => !cleared.includes(field))));
    }
  }

  const codesDescribedBy = [`${id}-codes-description`, errors.codes ? `${id}-codes-error` : null].filter(Boolean).join(" ");

  return (
    <Panel
      open={open}
      busy={pending}
      onClose={onClose}
      returnFocus={returnFocus}
      testId="shortform-panel"
      title={editing ? "Edit Shortform" : "Add Shortform"}
      description={editing ? "Steri-AI uses changes from the next form it reads." : "What inspectors write, and what it means."}
      footer={
        gone ? (
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {dirty ? "Cancel" : "Close"}
            </Button>
            <Button type="submit" form={formId} disabled={pending}>
              {pending && <Spinner aria-hidden />}
              {pending ? (editing ? "Saving…" : "Adding…") : editing ? "Save Changes" : "Add Shortform"}
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
            <EmptyDescription>Someone has deleted or renamed this shortform.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {/* Submitted by hand: React resets a form after its action, and the Type radios and the checkbox
              would go back to their first values on that reset (lib/admin/submit.ts). */}
          <form id={formId} onSubmit={submitAction(formAction, pending)} noValidate>
            <input type="hidden" name="original" value={editing && base ? JSON.stringify(base) : ""} />
            <input type="hidden" name="kind" value={values.kind} />
            <input type="hidden" name="confirmed" value={values.confirmed ? "true" : "false"} />
            {/* Kept while Other Term is chosen, in case the admin switches back, but only a defect sends them. */}
            {values.kind === "defect" &&
              values.codes.map((code) => <input key={code} type="hidden" name="codes" value={code} />)}

            <FieldGroup className="gap-5">
              <TextField
                id={`${id}-short`}
                name="short"
                label="Shortform"
                value={values.short}
                error={errors.short}
                maxLength={40}
                autoCapitalize="characters"
                spellCheck={false}
                description="As inspectors write it, e.g. BF."
                onValueChange={(short) => change({ short })}
              />

              <FieldSet className="gap-3">
                {/* mb-2 matches the 8 px of the fields' gap: a legend is not a flex item, so the FieldSet's gap misses it. */}
                <FieldLegend variant="label" className="mb-2">
                  Type
                </FieldLegend>
                <RadioGroup
                  value={values.kind}
                  // Other Term hides the codes; they come back if the admin switches back to Defect.
                  onValueChange={(kind) => change({ kind: kind as GlossaryKind })}
                  className="grid gap-3 sm:grid-cols-2"
                >
                  {KINDS.map((kind) => (
                    <RadioCard
                      key={kind.value}
                      id={`${id}-kind-${kind.value}`}
                      value={kind.value}
                      title={kind.title}
                      description={kind.description}
                    />
                  ))}
                </RadioGroup>
              </FieldSet>

              {values.kind === "defect" && (
                <FieldSet id={`${id}-codes-group`} className="gap-2" data-invalid={errors.codes ? true : undefined}>
                  <FieldLegend variant="label" className="mb-2">
                    Defect Codes
                  </FieldLegend>
                  <CodePicker
                    id={`${id}-codes`}
                    value={values.codes}
                    onValueChange={(codes) => change({ codes })}
                    library={library}
                    words={`${values.short} ${values.meaning}`}
                    describedBy={codesDescribedBy}
                    invalid={Boolean(errors.codes)}
                  />
                  <FieldDescription id={`${id}-codes-description`}>
                    Up to 3: one for each case the meaning names.
                  </FieldDescription>
                  {errors.codes && <FieldError id={`${id}-codes-error`}>{errors.codes}</FieldError>}
                  {values.codes.length === 0 && (
                    <div className="flex flex-col items-start gap-2" data-no-code>
                      <p className="flex gap-2 text-sm text-muted-foreground">
                        <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                        <span>No code yet: Steri-AI records it as a new label for you to map.</span>
                      </p>
                      {newCode && (
                        <Button asChild variant="outline" size="sm">
                          <Link href={addCodeHref(newCode.code, newCode.name)}>
                            <PlusIcon aria-hidden />
                            Add a Code
                          </Link>
                        </Button>
                      )}
                    </div>
                  )}
                </FieldSet>
              )}

              <TextField
                id={`${id}-meaning`}
                name="meaning"
                label="Meaning"
                value={values.meaning}
                error={errors.meaning}
                maxLength={300}
                multiline
                description="What it means, and when each code applies, e.g. Defective Bead when major, Poor Beading when minor."
                onValueChange={(meaning) => change({ meaning })}
              />

              <Field orientation="horizontal" className="gap-3">
                <Checkbox
                  id={`${id}-confirmed`}
                  checked={values.confirmed}
                  onCheckedChange={(checked) => change({ confirmed: checked === true })}
                  aria-describedby={`${id}-confirmed-description`}
                />
                <FieldContent>
                  <FieldLabel htmlFor={`${id}-confirmed`}>Confirmed by an Inspector</FieldLabel>
                  <FieldDescription id={`${id}-confirmed-description`}>
                    Unconfirmed meanings are given to Steri-AI as a guess.
                  </FieldDescription>
                </FieldContent>
              </Field>
            </FieldGroup>

            {/* role="alert": read out as soon as it appears. */}
            {formError && (
              <Alert variant="destructive" className="mt-5">
                <OctagonXIcon aria-hidden />
                <AlertDescription className="text-destructive">{formError}</AlertDescription>
              </Alert>
            )}
          </form>

          {editing && base && shown && <DeleteSection entry={base} onDeleted={onDeleted} />}
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Deleting
 * ------------------------------------------------------------------ */

function DeleteSection({ entry, onDeleted }: { entry: GlossaryEntry; onDeleted: () => void }) {
  const titleId = useId();
  const reasonId = useId();
  const deleteButton = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <PanelSection title="Delete Shortform" titleId={titleId}>
      <p id={reasonId} className="flex gap-2 text-sm text-muted-foreground">
        <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>Steri-AI stops using it from the next form it reads.</span>
      </p>
      <div>
        <Button
          ref={deleteButton}
          type="button"
          variant="destructive"
          aria-describedby={reasonId}
          onClick={() => setConfirming(true)}
        >
          <Trash2Icon aria-hidden />
          Delete Shortform
        </Button>
      </div>
      {confirming && (
        <ConfirmDelete
          entry={entry}
          opener={deleteButton}
          onCancel={() => setConfirming(false)}
          onDeleted={() => {
            setConfirming(false);
            onDeleted();
          }}
        />
      )}
    </PanelSection>
  );
}

function ConfirmDelete({
  entry,
  opener,
  onCancel,
  onDeleted,
}: {
  entry: GlossaryEntry;
  /** The Delete button, which gets the focus back when this closes without deleting. */
  opener: RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const deleted = useRef(false);
  const [state, formAction, pending] = useActionState(async (previous: ShortformResult, formData: FormData) => {
    const result = await deleteShortform(previous, formData).catch(unreachable);
    if (result.status === "success") {
      deleted.current = true;
      toast.success(result.message);
      onDeleted();
    }
    return result;
  }, IDLE);

  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onCancel();
      }}
    >
      <AlertDialogContent
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          // Opened from code, so Radix has no Trigger to go back to.
          event.preventDefault();
          // Deleted: the panel is closing too, and puts the focus back itself.
          if (deleted.current) return;
          focusFirst([opener.current, opener.current?.closest<HTMLElement>("[role='dialog']")]);
        }}
      >
        <form action={formAction} className="grid gap-6">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{entry.short}”?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <input type="hidden" name="original" value={JSON.stringify(entry)} />

          {/* role="alert": read out as soon as it appears. */}
          {state.status === "error" && (
            <Alert variant="destructive">
              <OctagonXIcon aria-hidden />
              <AlertDescription className="text-destructive">{state.message}</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={pending}>
              Cancel
            </AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && <Spinner aria-hidden />}
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
