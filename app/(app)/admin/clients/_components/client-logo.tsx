"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { ImageIcon, ImageOffIcon, OctagonXIcon, Trash2Icon, UploadIcon } from "lucide-react";
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
import {
  CLIENT_LOGOS_BUCKET,
  IDLE,
  LOGO_ACCEPT,
  failed,
  logoFileProblem,
  unreachable,
  type ActionResult,
  type LogoPreview,
} from "@/lib/admin/reference";
import { createClient } from "@/lib/supabase/client";
import { PanelSection } from "../../manufacturers/_components/reference-panel";
import { confirmLogoUpload, prepareLogoUpload, removeClientLogo } from "../actions";

type ClientLogoProps = {
  clientId: string;
  clientName: string;
  logo: LogoPreview | null;
  /** Tells the panel an upload is running, so it stays open until the outcome shows. */
  onPendingChange: (pending: boolean) => void;
};

/**
 * The client's logo: a preview through a signed URL, upload or replace, and
 * remove. A change is saved as soon as it is made, apart from the form above.
 *
 * Choosing a file submits a form whose action runs here, in the browser: the
 * server prepares a one-time upload, the browser sends the file straight to
 * the private client-logos bucket (a Server Action would cap it at 1 MB), and
 * the server then makes it the logo.
 */
export function ClientLogo({ clientId, clientName, logo, onPendingChange }: ClientLogoProps) {
  const titleId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState(false);

  const [state, uploadAction, pending] = useActionState(
    async (_previous: ActionResult, formData: FormData): Promise<ActionResult> => {
      const file = formData.get("logo");
      // Cancelling the file picker still changes nothing.
      if (!(file instanceof File) || (file.size === 0 && file.name === "")) return IDLE;

      const problem = logoFileProblem(file);
      if (problem) return failed(problem);

      const prepared = await prepareLogoUpload({ clientId, type: file.type, size: file.size }).catch(unreachable);
      if (prepared.status !== "ready") return prepared;

      const { error } = await createClient()
        .storage.from(CLIENT_LOGOS_BUCKET)
        .uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type, cacheControl: "3600" });
      if (error) {
        console.error("[admin/clients] logo upload failed", error);
        return failed(`The logo could not be uploaded (${error.message}). Try again.`);
      }

      const confirmed = await confirmLogoUpload({ clientId, path: prepared.path }).catch(unreachable);
      if (confirmed.status === "success") toast.success(confirmed.message);
      return confirmed;
    },
    IDLE,
  );

  useEffect(() => {
    onPendingChange(pending);
  }, [pending, onPendingChange]);

  return (
    <PanelSection title="Logo" titleId={titleId}>
      <div className="flex h-36 items-center justify-center overflow-hidden rounded-lg bg-white p-4 ring-1 ring-border">
        {logo?.url ? (
          // A signed URL from a private bucket: next/image would need the
          // Supabase host in remotePatterns and would proxy every token.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo.url} alt={`${clientName} logo`} className="max-h-full max-w-full object-contain" />
        ) : logo ? (
          <p className="flex flex-col items-center gap-2 text-center text-sm font-medium text-warn">
            <ImageOffIcon aria-hidden className="size-6" />
            The logo file is missing. Upload it again.
          </p>
        ) : (
          <p className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <ImageIcon aria-hidden className="size-6" />
            No logo yet
          </p>
        )}
      </div>
      <p id={hintId} className="text-sm text-muted-foreground">
        PNG, JPEG or WebP, up to 2 MB. Saved as soon as it uploads; it shows on this client&apos;s reports.
      </p>

      <form action={uploadAction} className="flex flex-wrap gap-2">
        {/* Opened by the button below, which is what people and screen readers use. */}
        <input
          ref={inputRef}
          type="file"
          name="logo"
          accept={LOGO_ACCEPT}
          tabIndex={-1}
          aria-hidden
          className="sr-only"
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        />
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          aria-describedby={hintId}
          onClick={() => inputRef.current?.click()}
        >
          {pending ? <Spinner aria-hidden /> : <UploadIcon aria-hidden />}
          {pending ? "Uploading…" : logo ? "Replace logo" : "Upload logo"}
        </Button>
        {logo && (
          <Button type="button" variant="ghost" disabled={pending} onClick={() => setRemoving(true)}>
            <Trash2Icon aria-hidden />
            Remove logo
          </Button>
        )}
      </form>

      <p role="status" className="sr-only">
        {pending ? "Uploading the logo…" : ""}
      </p>
      {/* role="alert": read out as soon as it appears. */}
      {state.status === "error" && (
        <Alert variant="destructive">
          <OctagonXIcon aria-hidden />
          <AlertDescription className="text-destructive">{state.message}</AlertDescription>
        </Alert>
      )}

      {removing && <ConfirmRemoveLogo clientId={clientId} clientName={clientName} onDone={() => setRemoving(false)} />}
    </PanelSection>
  );
}

function ConfirmRemoveLogo({
  clientId,
  clientName,
  onDone,
}: {
  clientId: string;
  clientName: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(async (previous: ActionResult, formData: FormData) => {
    const result = await removeClientLogo(previous, formData).catch(unreachable);
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
      >
        <form action={formAction} className="grid gap-6">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the logo?</AlertDialogTitle>
            <AlertDialogDescription>
              Reports for {clientName} show no logo until you upload a new one. The file is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input type="hidden" name="id" value={clientId} />

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
              {pending ? "Removing…" : "Remove logo"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
