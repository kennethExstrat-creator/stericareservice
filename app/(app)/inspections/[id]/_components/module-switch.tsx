"use client";

// Switching a module off for this inspection, and back on (BUILD_SPEC 4.4):
// admins only, with a reason that is logged and exported. Switched off, the
// module leaves capture, validation and the export; its data stays saved and
// returns when it is switched back on. Either way the button pressed goes
// with the change, so the screen moves focus to the section's title
// (capture-screen.tsx, onSwitched). The reason typed is kept in the tab until
// it is sent or cancelled (lib/drafts/tab-draft.ts), so a reload loses nothing.
import { useActionState, useContext, useEffect, useId, useRef, useState } from "react";
import { CircleOffIcon, OctagonXIcon, PowerIcon } from "lucide-react";
import { toast } from "sonner";
import { PhotoUserContext } from "@/components/capture/photos/hooks";
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { readTextDraft, useTabDraft, writeTextDraft } from "@/lib/drafts/tab-draft";
import { OVERRIDE_REASON_MAX } from "@/lib/inspections/capture/schemas";
import type { ModuleOverride, ModuleOverrides } from "@/lib/schemas/template";
import { switchModuleOff, switchModuleOn, type OverrideResult } from "../actions";
import { unreachable } from "./unreachable";

const IDLE: OverrideResult = { status: "idle" };

type SwitchProps = {
  inspectionId: string;
  moduleKey: string;
  title: string;
  onChanged: (overrides: ModuleOverrides) => void;
};

/** The reason an admin is typing for switching a module off in one inspection. */
export function switchOffDraftKey(userId: string, inspectionId: string, moduleKey: string): string {
  return `stericare:capture-draft:switch-off:${userId}:${inspectionId}:${moduleKey}`;
}

/**
 * "Switch Off" in a section's header, with the reason dialog. On a page of
 * two sections the button is read out with its section's title
 * (`nameContext`: "Switch Off Packing Configuration"), so it never shares a
 * name with another on the page.
 */
export function SwitchOffDialog({
  inspectionId,
  moduleKey,
  title,
  nameContext,
  onChanged,
}: SwitchProps & { nameContext?: string }) {
  const [open, setOpen] = useState(false);
  // A fresh form, with no old error, every time it opens.
  const [formKey, setFormKey] = useState(0);
  const [pending, setPending] = useState(false);
  // Switched off: the trigger has gone with the section's controls, and focus goes to its title instead.
  const switched = useRef(false);
  // The reason as typed, kept in the tab for this admin, inspection and
  // module: after a reload it is back when the dialog opens. The admin is
  // the user the capture page names for its photo queue
  // (PhotoQueueProvider); without one, only the field keeps the reason.
  const userId = useContext(PhotoUserContext);
  const [reason, setReason, forgetReason] = useTabDraft(
    userId === null ? null : switchOffDraftKey(userId, inspectionId, moduleKey),
    readTextDraft,
    writeTextDraft,
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        if (next) setFormKey((key) => key + 1);
        // Cancelled (Cancel, Escape, a tap outside): the reason goes with it.
        else setReason(null);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-action="switch-off" className="relative">
          <CircleOffIcon aria-hidden />
          Switch Off
          {nameContext && <span className="sr-only"> {nameContext}</span>}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-lg"
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (switched.current) event.preventDefault();
        }}
      >
        <SwitchOffForm
          key={formKey}
          inspectionId={inspectionId}
          moduleKey={moduleKey}
          title={title}
          reason={reason ?? ""}
          onReasonChange={(text) => setReason(text === "" ? null : text)}
          onPendingChange={setPending}
          onDone={(overrides) => {
            switched.current = true;
            // Switched off: the reason is the module's now, no longer a draft.
            forgetReason();
            onChanged(overrides);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function SwitchOffForm({
  inspectionId,
  moduleKey,
  title,
  reason,
  onReasonChange,
  onPendingChange,
  onDone,
}: {
  inspectionId: string;
  moduleKey: string;
  title: string;
  /** The reason as typed so far, before a reload too. */
  reason: string;
  onReasonChange: (reason: string) => void;
  onPendingChange: (pending: boolean) => void;
  onDone: (overrides: ModuleOverrides) => void;
}) {
  const id = useId();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  // Cleared as soon as the reason is edited again.
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  // The reason takes focus as the dialog opens (autoFocus); one brought back
  // from before a reload goes on where it stopped, the caret at its end.
  useEffect(() => {
    const field = reasonRef.current;
    field?.setSelectionRange(field.value.length, field.value.length);
  }, []);
  const [state, formAction, pending] = useActionState(async (previous: OverrideResult, formData: FormData) => {
    onPendingChange(true);
    try {
      const result: OverrideResult = await switchModuleOff(previous, formData).catch(unreachable);
      setReasonError(result.status === "error" ? result.fieldError : undefined);
      if (result.status === "error" && result.fieldError) reasonRef.current?.focus();
      if (result.status === "success" || result.status === "warning") {
        (result.status === "success" ? toast.success : toast.warning)(result.message);
        onDone(result.overrides);
      }
      return result;
    } finally {
      onPendingChange(false);
    }
  }, IDLE);

  const formError = state.status === "error" && !state.fieldError ? state.message : null;

  return (
    <form action={formAction} noValidate className="grid gap-6">
      <DialogHeader>
        <DialogTitle className="text-lg font-bold">Switch Off {title}?</DialogTitle>
        <DialogDescription>
          For this inspection only. It leaves capture, the checks and the report, which lists it with your reason.
          What is entered stays saved and returns if you switch it back on.
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="inspectionId" value={inspectionId} />
      <input type="hidden" name="moduleKey" value={moduleKey} />
      <Field data-invalid={reasonError ? true : undefined}>
        <FieldLabel htmlFor={`${id}-reason`}>Reason</FieldLabel>
        <Textarea
          ref={reasonRef}
          id={`${id}-reason`}
          name="reason"
          value={reason}
          onChange={(event) => {
            onReasonChange(event.target.value);
            setReasonError(undefined);
          }}
          maxLength={OVERRIDE_REASON_MAX}
          rows={3}
          required
          autoFocus
          aria-invalid={reasonError ? true : undefined}
          aria-describedby={reasonError ? `${id}-reason-error` : `${id}-reason-hint`}
        />
        {reasonError ? (
          <FieldError id={`${id}-reason-error`}>{reasonError}</FieldError>
        ) : (
          <FieldDescription id={`${id}-reason-hint`}>For example: not part of this client&apos;s order.</FieldDescription>
        )}
      </Field>
      {formError && (
        <p role="alert" className="flex items-start gap-2 text-sm font-medium text-fail">
          <OctagonXIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {formError}
        </p>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending && <Spinner aria-hidden />}
          {pending ? "Switching Off…" : "Switch Off"}
        </Button>
      </DialogFooter>
    </form>
  );
}

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  // Fixed, so the server and the browser render the same text.
  timeZone: "Asia/Kuala_Lumpur",
});

export function formatOverrideTime(at: string): string {
  const time = Date.parse(at);
  return Number.isNaN(time) ? at : WHEN.format(time);
}

/** The body of a section that is switched off: why, who, when; for admins, "Switch Back On". */
export function SwitchedOffPanel({
  inspectionId,
  moduleKey,
  title,
  override,
  author,
  canSwitch,
  onChanged,
}: SwitchProps & {
  override: ModuleOverride;
  /** The admin's name, when this user may read it. */
  author: string | null;
  canSwitch: boolean;
}) {
  const [state, formAction, pending] = useActionState(async (previous: OverrideResult, formData: FormData) => {
    const result: OverrideResult = await switchModuleOn(previous, formData).catch(unreachable);
    if (result.status === "success" || result.status === "warning") {
      (result.status === "success" ? toast.success : toast.warning)(result.message);
      onChanged(result.overrides);
    }
    return result;
  }, IDLE);

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border border-dashed border-not-done-border bg-not-done-tint px-4 py-3 text-sm text-foreground touch:text-base">
        <p className="font-semibold">
          {title} is switched off for this inspection. It is left out of the checks and the report.
        </p>
        <p>
          <span className="text-muted-foreground">Reason: </span>
          {override.reason}
        </p>
        <p className="text-muted-foreground">
          Switched off by {author ?? "an admin"} on {formatOverrideTime(override.at)}. What was entered is kept.
        </p>
      </div>
      {canSwitch && (
        <form action={formAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="inspectionId" value={inspectionId} />
          <input type="hidden" name="moduleKey" value={moduleKey} />
          <Button type="submit" disabled={pending} data-action="switch-on">
            {pending ? <Spinner aria-hidden /> : <PowerIcon aria-hidden />}
            {pending ? "Switching On…" : "Switch Back On"}
          </Button>
          {state.status === "error" && (
            <p role="alert" className="text-sm font-medium text-fail">
              {state.message}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
