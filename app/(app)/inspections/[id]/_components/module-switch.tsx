"use client";

// Switching a module off for this inspection, and back on (BUILD_SPEC 4.4):
// admins only, with a reason that is logged and exported. Switched off, the
// module leaves capture, validation and the export; its data stays saved and
// returns when it is switched back on.
import { useActionState, useId, useRef, useState } from "react";
import { CircleOffIcon, OctagonXIcon, PowerIcon } from "lucide-react";
import { toast } from "sonner";
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

/** "Switch off" in a section's header, with the reason dialog. */
export function SwitchOffDialog({ inspectionId, moduleKey, title, onChanged }: SwitchProps) {
  const [open, setOpen] = useState(false);
  // A fresh form, with no old reason or error, every time it opens.
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
        <Button type="button" variant="outline" size="sm" data-action="switch-off">
          <CircleOffIcon aria-hidden />
          Switch off
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-lg"
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <SwitchOffForm
          key={formKey}
          inspectionId={inspectionId}
          moduleKey={moduleKey}
          title={title}
          onPendingChange={setPending}
          onDone={(overrides) => {
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
  onPendingChange,
  onDone,
}: {
  inspectionId: string;
  moduleKey: string;
  title: string;
  onPendingChange: (pending: boolean) => void;
  onDone: (overrides: ModuleOverrides) => void;
}) {
  const id = useId();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  // Cleared as soon as the reason is edited again.
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
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
        <DialogTitle className="text-lg font-bold">Switch off {title}?</DialogTitle>
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
            setReason(event.target.value);
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
          {pending ? "Switching off…" : "Switch off"}
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

/** The body of a section that is switched off: why, who, when; for admins, "Switch back on". */
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
            {pending ? "Switching on…" : "Switch back on"}
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
