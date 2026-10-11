"use client";

// Add PO (lib/inspections/parts-server.ts createPart): one more purchase
// order in this inspection, a part of its own, sampled and tested on its own,
// for the same client, manufacturer, template and inspector. The PO / SO
// number is optional: the new part's header takes it, and it can be entered
// there later. Added, the part opens (onAdded) while the dialog says so;
// refused, the dialog says why and keeps what was typed (submitted by hand,
// lib/admin/submit.ts, so the form is never reset).
import { useActionState, useId, useState } from "react";
import { OctagonXIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { submitAction } from "@/lib/admin/submit";
import { TEXT_MAX_LENGTH } from "@/modules/header/schema";
import { addInspectionPart, type AddPartResult } from "../parts-actions";
import { unreachable } from "./unreachable";

type AddPartState = { status: "idle" } | AddPartResult;

const IDLE: AddPartState = { status: "idle" };

type AddPartProps = {
  inspectionId: string;
  /** The inspection's reference number, for the dialog's title. */
  refNo: string;
  /** The part was added: open it. The dialog stays, saying so, until the screen goes. */
  onAdded: (partId: string, poNo: string | null) => void;
};

/** "Add PO" in the parts bar, with its dialog. */
export function AddPartDialog({ inspectionId, refNo, onAdded }: AddPartProps) {
  const [open, setOpen] = useState(false);
  // A fresh form, with nothing typed and no old error, every time it opens.
  const [formKey, setFormKey] = useState(0);
  const [pending, setPending] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        if (next) setFormKey((key) => key + 1);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" data-action="add-part">
          <PlusIcon aria-hidden />
          Add PO
        </Button>
      </DialogTrigger>
      <DialogContent
        // Scrolls inside the viewport: an iPad in landscape with its keyboard up is short.
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <AddPartForm key={formKey} inspectionId={inspectionId} refNo={refNo} onPendingChange={setPending} onAdded={onAdded} />
      </DialogContent>
    </Dialog>
  );
}

/** The dialog's form: the PO / SO number, Cancel and Add PO. Exported for its markup test. */
export function AddPartForm({
  inspectionId,
  refNo,
  onPendingChange,
  onAdded,
}: AddPartProps & { onPendingChange: (pending: boolean) => void }) {
  const id = useId();
  const [state, formAction, pending] = useActionState(async (_previous: AddPartState, formData: FormData) => {
    onPendingChange(true);
    try {
      const typed = String(formData.get("poNo") ?? "").trim();
      const poNo = typed === "" ? null : typed;
      const result: AddPartResult = await addInspectionPart(inspectionId, poNo).catch(unreachable);
      if (result.status === "added") onAdded(result.id, poNo);
      return result;
    } finally {
      onPendingChange(false);
    }
  }, IDLE);

  // Added: the new part is opening, and a second one is not added meanwhile.
  const opening = state.status === "added";
  const error = state.status === "error" ? state.message : null;

  return (
    <form onSubmit={submitAction(formAction, pending || opening)} noValidate className="grid gap-6">
      <DialogHeader>
        <DialogTitle className="text-lg font-bold">Add a PO to {refNo}</DialogTitle>
        <DialogDescription>
          A PO of its own in this inspection, with its own lots, sizes, sampling, tests and result. The client,
          manufacturer, template and inspector stay the same, and one report covers every PO.
        </DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor={`${id}-po`}>PO / SO Number (Optional)</FieldLabel>
        <Input
          id={`${id}-po`}
          name="poNo"
          maxLength={TEXT_MAX_LENGTH}
          autoComplete="off"
          // A PO number is no word to correct.
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          autoFocus
          aria-describedby={`${id}-po-hint`}
        />
        <FieldDescription id={`${id}-po-hint`}>
          As printed on the order, with the SO number in brackets if there is one. It can also be entered later, on
          the new PO.
        </FieldDescription>
      </Field>
      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm font-medium text-fail">
          <OctagonXIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending || opening} aria-busy={pending || opening || undefined}>
          {(pending || opening) && <Spinner aria-hidden />}
          {pending ? "Adding PO…" : opening ? "Opening PO…" : "Add PO"}
        </Button>
      </DialogFooter>
    </form>
  );
}
