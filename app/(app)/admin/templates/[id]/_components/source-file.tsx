"use client";

import { useActionState, useRef } from "react";
import { DownloadIcon, FileTextIcon, OctagonXIcon, TriangleAlertIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ActionResult } from "@/lib/admin/templates";
import { createClient } from "@/lib/supabase/client";
import { confirmSourceUpload, getSourceDownload, prepareSourceUpload } from "./actions";

export type SourceFileView = {
  name: string;
  /** "Excel · 1.2 MB · added 6 Oct 2026, 14:05"; null when Storage could not say. */
  details: string | null;
  /** The row names a file Storage does not have. */
  missing: boolean;
};

export type SourceFileProps = {
  templateId: string;
  file: SourceFileView | null;
  /** Null when the file may change (a draft no inspection uses); otherwise why not. */
  changeBlocked: string | null;
  /** Replacing the file clears a confirmed coverage checklist: say so first. */
  coverageConfirmed: boolean;
  bucket: string;
  /** `<input accept>`: the types and extensions the bucket takes. */
  accept: string;
  /** Types the bucket takes, each with the extensions that stand for it. */
  types: Record<string, readonly string[]>;
  maxBytes: number;
  /** "a PDF, Excel or Word file, or a photo …, up to 50 MB". */
  hint: string;
  /** What to say about a file of another type. */
  typeProblem: string;
};

const IDLE: ActionResult = { status: "idle" };

const UNREACHABLE = "Could not reach the server. Check the connection, then reload the page and try again.";

function typeOf(file: File, types: SourceFileProps["types"]): string | null {
  const declared = file.type.trim().toLowerCase();
  if (Object.hasOwn(types, declared)) return declared;
  const dot = file.name.lastIndexOf(".");
  const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  return Object.keys(types).find((type) => types[type].includes(extension)) ?? null;
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/**
 * The version's source form or report (BUILD_SPEC 4.2 rule 10, 4.5 step 1):
 * download it through a link signed on each click; on a draft, upload or
 * replace it. The file goes straight from the browser to Storage with a
 * one-time token the server signs, so its size is not limited by a Server
 * Action (1 MB); the server then checks and records it.
 */
export function SourceFile(props: SourceFileProps) {
  const { templateId, file, changeBlocked } = props;

  return (
    <div className="flex flex-col gap-4">
      {file ? (
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <FileTextIcon aria-hidden className="size-5" />
          </span>
          <div className="min-w-0">
            <p data-testid="source-file-name" className="font-medium break-all text-foreground">
              {file.name}
            </p>
            {file.details && <p className="text-sm text-muted-foreground">{file.details}</p>}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground touch:text-base">No source file yet. Upload {props.hint}.</p>
      )}

      {file?.missing && (
        <Alert className="border-warn-border bg-warn-tint text-warn">
          <TriangleAlertIcon aria-hidden />
          <AlertDescription className="text-warn">
            {changeBlocked
              ? "The stored file is missing from Storage. Make a new version to attach the form again."
              : "The stored file is missing from Storage. Upload it again."}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        {file && !file.missing && <DownloadButton templateId={templateId} />}
        {changeBlocked === null && <UploadForm {...props} />}
      </div>

      {changeBlocked !== null && <p className="text-sm text-muted-foreground">{changeBlocked}</p>}
    </div>
  );
}

function DownloadButton({ templateId }: { templateId: string }) {
  const [state, formAction, pending] = useActionState(async (): Promise<ActionResult> => {
    const result = await getSourceDownload({ templateId }).catch(() => ({ status: "error" as const, message: UNREACHABLE }));
    if (result.status !== "ready") return result;
    window.location.assign(result.url);
    return IDLE;
  }, IDLE);

  return (
    <form action={formAction} className="contents">
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? <Spinner aria-hidden /> : <DownloadIcon aria-hidden />}
        {pending ? "Preparing…" : "Download"}
      </Button>
      {state.status === "error" && (
        <Alert variant="destructive" className="basis-full">
          <OctagonXIcon aria-hidden />
          <AlertDescription className="text-destructive">{state.message}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}

function UploadForm({ templateId, file, coverageConfirmed, bucket, accept, types, maxBytes, typeProblem }: SourceFileProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(async (_previous: ActionResult, formData: FormData) => {
    const chosen = formData.get("file");
    if (!(chosen instanceof File) || chosen.name === "") return IDLE;
    const type = typeOf(chosen, types);
    if (!type) return { status: "error", message: typeProblem } satisfies ActionResult;
    if (chosen.size === 0) return { status: "error", message: "That file is empty. Choose the saved form or report." } satisfies ActionResult;
    if (chosen.size > maxBytes) {
      return { status: "error", message: `That file is ${megabytes(chosen.size)}. Choose one up to 50 MB.` } satisfies ActionResult;
    }

    const prepared = await prepareSourceUpload({ templateId, fileName: chosen.name, type: chosen.type, size: chosen.size }).catch(
      () => ({ status: "error" as const, message: UNREACHABLE }),
    );
    if (prepared.status !== "ready") return prepared;

    const { error } = await createClient()
      .storage.from(bucket)
      .uploadToSignedUrl(prepared.path, prepared.token, chosen, { contentType: prepared.contentType });
    if (error) {
      console.error(error);
      return { status: "error", message: "The upload did not finish. Check the connection and try again." } satisfies ActionResult;
    }

    const result = await confirmSourceUpload({ templateId, path: prepared.path }).catch(
      (): ActionResult => ({ status: "error", message: UNREACHABLE }),
    );
    if (result.status === "success") {
      toast.success(result.message);
      formRef.current?.reset();
    }
    return result;
  }, IDLE);

  return (
    <form ref={formRef} action={formAction} className="contents">
      {/* Opened by the button: the button is what keyboards and screen readers reach. */}
      <input
        ref={inputRef}
        type="file"
        name="file"
        accept={accept}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={(event) => {
          if (event.currentTarget.files?.length) event.currentTarget.form?.requestSubmit();
        }}
      />
      <Button type="button" variant={file ? "outline" : "default"} disabled={pending} onClick={() => inputRef.current?.click()}>
        {pending ? <Spinner aria-hidden /> : <UploadIcon aria-hidden />}
        {pending ? "Uploading…" : file ? "Replace file" : "Upload source file"}
      </Button>
      {file && coverageConfirmed && !pending && (
        <p className="basis-full text-sm text-muted-foreground">
          Replacing the file clears the coverage confirmation: the checklist is checked against the new file.
        </p>
      )}
      {/* role="alert": read out as soon as it appears. */}
      {state.status === "error" && (
        <Alert variant="destructive" className="basis-full">
          <OctagonXIcon aria-hidden />
          <AlertDescription className="text-destructive">{state.message}</AlertDescription>
        </Alert>
      )}
      <p aria-live="polite" className="sr-only">
        {pending ? "Uploading the source file." : ""}
      </p>
    </form>
  );
}
