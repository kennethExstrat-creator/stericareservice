"use client";

// A version that cannot change (BUILD_SPEC 4.2 rule 8): in use, active or
// retired. The editor shows it read-only and offers a new version, or the
// draft that already exists.
import Link from "next/link";
import { useActionState } from "react";
import { CopyPlusIcon, LockIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { createTemplateVersion } from "../actions";
import { VERSION_IDLE, type VersionResult } from "../_lib/results";

export function LockedNotice({
  templateId,
  reason,
  draft,
  carry = null,
  stranded = false,
}: {
  templateId: string;
  reason: string;
  /** A draft of the same template that already exists, to open instead. */
  draft: { id: string; version: number } | null;
  /** Unsaved changes, as JSON, for the new version to start from: the version was locked while they were made. */
  carry?: string | null;
  /** Unsaved changes that cannot be carried over (they have problems): the admin copies them from the JSON tab. */
  stranded?: boolean;
}) {
  const [state, action, pending] = useActionState<VersionResult, FormData>(createTemplateVersion, VERSION_IDLE);
  return (
    <Alert className="border-hold-border bg-hold-tint text-hold" data-testid="locked">
      <LockIcon aria-hidden />
      <AlertTitle className="font-semibold">Read Only</AlertTitle>
      <AlertDescription className="grid gap-3 text-hold">
        <p>{reason}</p>
        {carry && <p>Your unsaved changes go into the new version.</p>}
        {stranded && (
          <p>
            Your unsaved changes have problems, so the new version starts from the saved one. Copy them from the JSON
            tab first if you need them.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {draft && (
            <Button asChild variant="outline">
              <Link href={`/admin/templates/${draft.id}/edit`}>Open Draft Version {draft.version}</Link>
            </Button>
          )}
          <form action={action}>
            <input type="hidden" name="id" value={templateId} />
            {carry && <input type="hidden" name="definition" value={carry} />}
            <Button type="submit" variant={draft ? "outline" : "default"} disabled={pending}>
              {pending ? <Spinner aria-hidden /> : <CopyPlusIcon aria-hidden />}
              {pending ? "Making a New Version…" : "New Version"}
            </Button>
          </form>
        </div>
        {state.status === "error" && (
          <p role="alert" className="text-fail">
            {state.message}
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
