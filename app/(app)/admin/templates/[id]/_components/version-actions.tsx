"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useActionState, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArchiveIcon, BadgeCheckIcon, CopyPlusIcon, OctagonXIcon, PencilLineIcon, TriangleAlertIcon } from "lucide-react";
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
import { Spinner } from "@/components/ui/spinner";
import type { ActionResult, TemplateStatus } from "@/lib/admin/templates";
import { activateVersion, createNewVersion, retireVersion } from "./actions";

type Kind = "activate" | "retire" | "new-version";

type ServerAction = (previous: ActionResult, formData: FormData) => Promise<ActionResult>;

export type VersionActionsProps = {
  templateId: string;
  /** `updated_at` as the page read it. */
  seen: string;
  code: string;
  version: number;
  status: TemplateStatus;
  /** The template editor for this version. */
  editHref: string;
  /** False while something blocks activation; the page lists what (activationBlockersId). */
  canActivate: boolean;
  activationBlockersId?: string;
  /** The code's active version, when it is another one: activating this one retires it. */
  activeVersion: number | null;
  /** The number a new version gets, as the page counts it. */
  nextVersion: number;
  usage: number;
  /** Warnings to repeat in the activation dialog: other templates for the same scope, bases moved on. */
  activationWarnings: string[];
};

const IDLE: ActionResult = { status: "idle" };

/** The version's header actions: edit a draft, make a new version, activate, retire. */
export function VersionActions(props: VersionActionsProps) {
  const { status, editHref, canActivate, activationBlockersId } = props;
  const [kind, setKind] = useState<Kind | null>(null);
  const activateRef = useRef<HTMLButtonElement>(null);
  const retireRef = useRef<HTMLButtonElement>(null);
  const newVersionRef = useRef<HTMLButtonElement>(null);
  const triggerRef = kind === "activate" ? activateRef : kind === "retire" ? retireRef : newVersionRef;

  return (
    <>
      {status === "draft" ? (
        <Button asChild variant="outline">
          <Link href={editHref}>
            <PencilLineIcon aria-hidden />
            Edit draft
          </Link>
        </Button>
      ) : (
        <Button ref={newVersionRef} variant="outline" onClick={() => setKind("new-version")}>
          <CopyPlusIcon aria-hidden />
          New version
        </Button>
      )}
      {status === "active" ? (
        <Button ref={retireRef} variant="outline" onClick={() => setKind("retire")}>
          <ArchiveIcon aria-hidden />
          Retire
        </Button>
      ) : (
        <Button
          ref={activateRef}
          disabled={!canActivate}
          aria-describedby={!canActivate ? activationBlockersId : undefined}
          onClick={() => setKind("activate")}
        >
          <BadgeCheckIcon aria-hidden />
          {status === "retired" ? "Activate again" : "Activate"}
        </Button>
      )}

      {kind && (
        <ConfirmDialog key={kind} confirmation={confirmation(kind, props)} onClose={() => setKind(null)} returnFocusTo={triggerRef} />
      )}
    </>
  );
}

type Confirmation = {
  title: string;
  description: ReactNode;
  warnings?: string[];
  confirm: string;
  pending: string;
  destructive?: boolean;
  action: ServerAction;
  fields: Record<string, string>;
};

function confirmation(kind: Kind, props: VersionActionsProps): Confirmation {
  const { code, version, activeVersion, nextVersion, usage } = props;
  const fields = { templateId: props.templateId, seen: props.seen };
  const using =
    usage === 0
      ? "No inspection uses it yet."
      : usage === 1
        ? "The inspection that uses it keeps it."
        : `The ${usage} inspections that use it keep it.`;
  switch (kind) {
    case "activate":
      return {
        title: `Activate ${code} version ${version}?`,
        description: (
          <>
            Inspectors start new {code} inspections from version {version}.{" "}
            {activeVersion !== null
              ? `Version ${activeVersion} is retired; inspections that use it keep it.`
              : `${code} has no active version now, so nothing is retired.`}
          </>
        ),
        warnings: props.activationWarnings,
        confirm: "Activate",
        pending: "Activating…",
        action: activateVersion,
        fields,
      };
    case "retire":
      return {
        title: `Retire ${code} version ${version}?`,
        description: (
          <>
            New inspections can no longer start from it. {using} Until you activate another version, {code} has no
            active version: new inspections for its scope use the next most specific template, if there is one.
          </>
        ),
        confirm: "Retire",
        pending: "Retiring…",
        destructive: true,
        action: retireVersion,
        fields,
      };
    case "new-version":
      return {
        title: `Make version ${nextVersion} of ${code}?`,
        description: (
          <>
            Version {nextVersion} starts as a draft copy of version {version}, with the same source file, and opens in the
            template editor. Inspections keep using the active version until you activate the new one. Its coverage
            checklist is confirmed again.
          </>
        ),
        confirm: "Make new version",
        pending: "Making…",
        action: createNewVersion,
        fields,
      };
  }
}

/**
 * A confirmation that runs a Server Action through a form, so the button can
 * show its pending state. Success closes it with a toast; an error stays in
 * the dialog, next to what the admin was about to do. A new version leaves
 * for the editor instead (the action redirects).
 */
function ConfirmDialog({
  confirmation,
  onClose,
  returnFocusTo,
}: {
  confirmation: Confirmation;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
}) {
  const [state, formAction, pending] = useActionState(async (previous: ActionResult, formData: FormData) => {
    const result = await confirmation.action(previous, formData).catch(unreachable);
    if (result.status === "success") {
      toast.success(result.message);
      onClose();
    } else if (result.status === "warning") {
      toast.warning(result.message, { duration: 12_000 });
      onClose();
    }
    return result;
  }, IDLE);

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusTo.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <form action={formAction} className="grid gap-6">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmation.description}</AlertDialogDescription>
          </AlertDialogHeader>

          {confirmation.warnings?.map((warning) => (
            <Alert key={warning} className="border-warn-border bg-warn-tint text-warn">
              <TriangleAlertIcon aria-hidden />
              <AlertDescription className="text-warn">{warning}</AlertDescription>
            </Alert>
          ))}

          {Object.entries(confirmation.fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}

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
            <Button type="submit" variant={confirmation.destructive ? "destructive" : "default"} disabled={pending}>
              {pending && <Spinner aria-hidden />}
              {pending ? confirmation.pending : confirmation.confirm}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * A Server Action call that never got an answer: the connection dropped (an
 * iPad on factory Wi-Fi), or a new deployment replaced the action.
 */
function unreachable(error: unknown): ActionResult {
  // A redirect is how a new version opens the editor: Next handles it.
  unstable_rethrow(error);
  console.error(error);
  return {
    status: "error",
    message: "Could not reach the server. Check the connection, then reload the page and try again.",
  };
}
