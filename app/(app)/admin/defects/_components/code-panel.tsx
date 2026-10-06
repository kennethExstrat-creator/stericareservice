"use client";

import { useActionState, useId, useRef, useState, type RefObject } from "react";
import { BanIcon, InfoIcon, OctagonXIcon, RotateCcwIcon, SearchXIcon, Trash2Icon } from "lucide-react";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import {
  CODE_RULE,
  DEFECT_CODE_FIELDS,
  IDLE,
  LIMITS,
  codeSnapshot,
  deleteBlocker,
  listOf,
  normaliseCode,
  unreachable,
  type ActionResult,
  type CodeSnapshot,
  type DefectCodeField,
  type DefectCodeItem,
} from "@/lib/admin/defects";
import { followVersion } from "@/lib/admin/reference";
import { deleteDefectCode, saveDefectCode, setDefectCodeActive, type CodeFormResult } from "../actions";
import { CodeStatusBadge } from "./badges";
import { focusFirst, Panel, PanelSection, type PanelTarget } from "./panel";
import { TextField } from "./text-field";

type Values = Record<DefectCodeField, string>;
type FieldErrors = Partial<Record<DefectCodeField, string>>;

function valuesOf(item: DefectCodeItem | null, target: PanelTarget): Values {
  const prefill = target.mode === "create" ? target.prefill : undefined;
  return {
    code: item?.code ?? prefill?.code ?? "",
    name: item?.name ?? prefill?.name ?? "",
    description: item?.description ?? "",
  };
}

type CodePanelProps = {
  open: boolean;
  target: PanelTarget;
  /** The code being edited as the page has it now, or null (adding, or deleted meanwhile). */
  item: DefectCodeItem | null;
  onClose: () => void;
  /** Closes the panel after this code was deleted: its row, and the button that opened the panel, go too. */
  onDeleted: () => void;
  /** Puts the keyboard back where the panel opened from, once it has closed. */
  returnFocus: () => void;
};

/**
 * Add a code, or edit one's name and description. The code itself never
 * changes once saved (templates and inspection data refer to it by value):
 * an edit shows it read-only. Below an edit: deactivating, and deleting a
 * code nothing uses.
 */
export function CodePanel({ open, target, item, onClose, onDeleted, returnFocus }: CodePanelProps) {
  const id = useId();
  const formId = `${id}-form`;
  const editing = target.mode === "edit";

  // The version an edit saves against, with the name and description as they
  // were at it: the code as the panel opened on it. The page refreshes after
  // any change here (deactivating, a delete a template blocked), and a newer
  // copy moves this on only when its name and description are unchanged;
  // otherwise the save is refused, never quietly written over someone
  // else's change.
  const [base, setBase] = useState<CodeSnapshot | null>(() => (item ? codeSnapshot(item) : null));
  // The last copy of the code this panel saw: it keeps showing while the
  // panel closes after a delete, when the row has already left the list.
  const [shown, setShown] = useState(item);
  if (item && item !== shown) {
    setShown(item);
    if (base) {
      const next = followVersion(base, codeSnapshot(item));
      if (next !== base) setBase(next);
    }
  }
  const gone = open && editing && !item;

  const [values, setValues] = useState<Values>(() => valuesOf(item, target));
  const [errors, setErrors] = useState<FieldErrors>({});

  const [state, formAction, pending] = useActionState(
    async (previous: CodeFormResult, formData: FormData): Promise<CodeFormResult> => {
      const result: CodeFormResult = await saveDefectCode(previous, formData).catch(unreachable);
      if (result.status === "success") {
        toast.success(result.message);
        onClose();
      } else if (result.status === "error") {
        // Refused over someone else's change: a second save replaces it, as the message offers.
        if (result.latest) setBase(result.latest);
        const fieldErrors = result.fieldErrors ?? {};
        setErrors(fieldErrors);
        const first = DEFECT_CODE_FIELDS.find((field) => fieldErrors[field]);
        if (first) document.getElementById(`${id}-${first}`)?.focus();
      }
      return result;
    },
    IDLE,
  );

  // Against what the panel opened on, not the latest copy: someone else's change is not something typed here.
  const saved: Values = base && editing ? { code: target.code, ...base.values } : valuesOf(null, target);
  const dirty = DEFECT_CODE_FIELDS.some((field) => values[field] !== saved[field]);
  const formError = state.status === "error" && !state.fieldErrors ? state.message : null;

  function field(name: DefectCodeField) {
    return {
      id: `${id}-${name}`,
      name,
      value: values[name],
      error: errors[name],
      maxLength: LIMITS[name],
      onValueChange: (value: string) => {
        setValues((current) => ({ ...current, [name]: value }));
        if (errors[name]) setErrors((current) => ({ ...current, [name]: undefined }));
      },
    };
  }

  return (
    <Panel
      open={open}
      busy={pending}
      onClose={onClose}
      returnFocus={returnFocus}
      title={editing ? "Edit defect code" : "Add defect code"}
      description={
        editing
          ? "The name and description say what the code means. The code itself never changes."
          : "One code per defect. Templates map their own labels to it and set its severity."
      }
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
              {pending ? (editing ? "Saving…" : "Adding…") : editing ? "Save changes" : "Add code"}
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
            <EmptyTitle>No longer on the list</EmptyTitle>
            <EmptyDescription>Someone has deleted this code.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <form id={formId} action={formAction} noValidate>
            <input type="hidden" name="mode" value={editing ? "edit" : "create"} />
            {editing && <input type="hidden" name="version" value={base?.version ?? ""} />}
            <FieldGroup className="gap-5">
              {editing ? (
                <div className="flex flex-col gap-2">
                  <input type="hidden" name="code" value={target.code} />
                  <p className="text-sm font-medium text-foreground">Code</p>
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-base font-semibold [overflow-wrap:anywhere]">{target.code}</span>
                    {shown && <CodeStatusBadge active={shown.active} />}
                  </p>
                </div>
              ) : (
                <TextField
                  {...field("code")}
                  label="Code"
                  code
                  // Shown as it will be saved once the admin moves on: "Torn cuff" becomes torn_cuff.
                  onCommit={(value) => setValues((current) => ({ ...current, code: normaliseCode(value) }))}
                  description={`${CODE_RULE} It cannot change once saved.`}
                />
              )}
              <TextField {...field("name")} label="Name" autoCapitalize="sentences" />
              <TextField
                {...field("description")}
                label="Description"
                multiline
                description="Optional. What counts as this defect, and the labels templates use for it."
              />
            </FieldGroup>

            {/* role="alert": read out as soon as it appears. */}
            {formError && (
              <Alert variant="destructive" className="mt-5">
                <OctagonXIcon aria-hidden />
                <AlertDescription className="text-destructive">{formError}</AlertDescription>
              </Alert>
            )}
          </form>

          {editing && shown && (
            <>
              <StatusSection item={shown} />
              <DeleteSection item={shown} onDeleted={onDeleted} />
            </>
          )}
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Active or inactive
 * ------------------------------------------------------------------ */

/**
 * Whether the code is offered when mapping labels. One button does both:
 * Deactivate (after a confirmation) and Reactivate. It is the same element
 * either way, so the keyboard stays on it when the code changes state.
 */
function StatusSection({ item }: { item: DefectCodeItem }) {
  const titleId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(async (previous: ActionResult, formData: FormData) => {
    const result = await setDefectCodeActive(previous, formData).catch(unreachable);
    if (result.status === "success") toast.success(result.message);
    return result;
  }, IDLE);
  const reactivating = pending && !item.active;

  return (
    <PanelSection title="Status" titleId={titleId}>
      <p className="flex gap-2 text-sm text-muted-foreground">
        <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          {item.active
            ? "Active: offered when mapping one-off labels and in the template editor."
            : "Inactive: kept wherever templates and inspections use it, but not offered when mapping labels."}
        </span>
      </p>
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="code" value={item.code} />
        <input type="hidden" name="active" value="true" />
        <div>
          <Button
            ref={button}
            type={item.active ? "button" : "submit"}
            variant="outline"
            // Not disabled while it runs: a disabled button would drop the keyboard focus.
            aria-disabled={reactivating || undefined}
            onClick={(event) => {
              if (reactivating) event.preventDefault();
              else if (item.active) setConfirming(true);
            }}
          >
            {reactivating ? <Spinner aria-hidden /> : item.active ? <BanIcon aria-hidden /> : <RotateCcwIcon aria-hidden />}
            {item.active ? "Deactivate code" : reactivating ? "Reactivating…" : "Reactivate code"}
          </Button>
        </div>
        {!item.active && state.status === "error" && (
          <Alert variant="destructive">
            <OctagonXIcon aria-hidden />
            <AlertDescription className="text-destructive">{state.message}</AlertDescription>
          </Alert>
        )}
      </form>
      {confirming && <ConfirmDeactivate item={item} opener={button} onDone={() => setConfirming(false)} />}
    </PanelSection>
  );
}

function ConfirmDeactivate({
  item,
  opener,
  onDone,
}: {
  item: DefectCodeItem;
  /** The status button, which gets the focus back however this closes. */
  opener: RefObject<HTMLButtonElement | null>;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(async (previous: ActionResult, formData: FormData) => {
    const result = await setDefectCodeActive(previous, formData).catch(unreachable);
    if (result.status === "success") {
      toast.success(result.message);
      onDone();
    }
    return result;
  }, IDLE);

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onDone();
      }}
    >
      <AlertDialogContent
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          // Opened from code, so Radix has no Trigger to go back to.
          event.preventDefault();
          focusFirst([opener.current, opener.current?.closest<HTMLElement>("[role='dialog']")]);
        }}
      >
        <form action={formAction} className="grid gap-6">
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {item.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              Templates and inspections that use it keep it, and their counts do not change. It is no longer offered
              when mapping one-off labels.
              {item.usedBy.length > 0 &&
                ` ${listOf(item.usedBy)} still ${item.usedBy.length === 1 ? "lists" : "list"} it: change ${
                  item.usedBy.length === 1 ? "that template" : "those templates"
                } in the template editor if inspectors should stop counting it.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input type="hidden" name="code" value={item.code} />
          <input type="hidden" name="active" value="false" />

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
              {pending ? "Deactivating…" : "Deactivate"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ------------------------------------------------------------------ *
 * Deleting a code nothing uses
 * ------------------------------------------------------------------ */

/**
 * The end of the edit panel. A code that a template version mentions cannot
 * be deleted, and the panel says why instead of offering a button that can
 * only fail; the action also checks that no inspection counts it.
 */
function DeleteSection({ item, onDeleted }: { item: DefectCodeItem; onDeleted: () => void }) {
  const titleId = useId();
  const reasonId = useId();
  const deleteButton = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const blocker = deleteBlocker(item);

  return (
    <PanelSection title="Delete code" titleId={titleId}>
      <p id={reasonId} className="flex gap-2 text-sm text-muted-foreground">
        <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          {blocker ??
            "No template mentions it. It can be deleted unless an inspection has counted it; then deactivate it instead."}
        </span>
      </p>
      <div>
        <Button
          ref={deleteButton}
          type="button"
          variant="destructive"
          disabled={Boolean(blocker)}
          aria-describedby={reasonId}
          onClick={() => setConfirming(true)}
        >
          <Trash2Icon aria-hidden />
          Delete code
        </Button>
      </div>
      {confirming && (
        <ConfirmDelete
          code={item.code}
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
  code,
  opener,
  onCancel,
  onDeleted,
}: {
  code: string;
  /** The Delete button, which gets the focus back when this closes without deleting. */
  opener: RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const deleted = useRef(false);
  const [state, formAction, pending] = useActionState(async (previous: ActionResult, formData: FormData) => {
    const result = await deleteDefectCode(previous, formData).catch(unreachable);
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
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
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
          // The Delete button, or the panel when a template took the code up meanwhile (the button is disabled).
          focusFirst([opener.current, opener.current?.closest<HTMLElement>("[role='dialog']")]);
        }}
      >
        <form action={formAction} className="grid gap-6">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {code}?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <input type="hidden" name="code" value={code} />

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
              {pending ? "Deleting…" : "Delete code"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
