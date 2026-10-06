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
}: {
  templateId: string;
  reason: string;
  /** A draft of the same template that already exists, to open instead. */
  draft: { id: string; version: number } | null;
}) {
  const [state, action, pending] = useActionState<VersionResult, FormData>(createTemplateVersion, VERSION_IDLE);
  return (
    <Alert className="border-hold-border bg-hold-tint text-hold" data-testid="locked">
      <LockIcon aria-hidden />
      <AlertTitle className="font-semibold">Read only</AlertTitle>
      <AlertDescription className="grid gap-3 text-hold">
        <p>{reason}</p>
        <div className="flex flex-wrap items-center gap-2">
          {draft && (
            <Button asChild variant="outline">
              <Link href={`/admin/templates/${draft.id}/edit`}>Open draft version {draft.version}</Link>
            </Button>
          )}
          <form action={action}>
            <input type="hidden" name="id" value={templateId} />
            <Button type="submit" variant={draft ? "outline" : "default"} disabled={pending}>
              {pending ? <Spinner aria-hidden /> : <CopyPlusIcon aria-hidden />}
              {pending ? "Making a new version…" : "New version"}
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
