"use client";

// What the inspector must know about the photos of one inspection that are
// still on this device: no connection, an ended session, a browser that
// cannot keep them through a reload, a retag the server refused.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CloudOffIcon, LogInIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LOGIN_PATH } from "@/lib/auth/routes";
import { cn } from "@/lib/utils";
import { usePhotoQueue } from "./hooks";
import { describeItems } from "./photo-model";
import { photoQueueStore } from "./queue-store";

const WARN = "border-warn-border bg-warn-tint text-warn *:data-[slot=alert-description]:text-warn";

function Notice({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Alert className={WARN} data-slot="upload-notice">
      {icon}
      <AlertTitle>{title}</AlertTitle>
      {(children || action) && (
        <AlertDescription>
          {children}
          {action && <div className="mt-2">{action}</div>}
        </AlertDescription>
      )}
    </Alert>
  );
}

export function UploadNotices({ inspectionId, className }: { inspectionId: string; className?: string }) {
  const state = usePhotoQueue();
  const pathname = usePathname();
  const items = state.queue.items.filter((item) => item.inspectionId === inspectionId);
  const photos = items.filter((item) => item.kind === "photo").length;
  const what = describeItems(photos, items.length - photos);
  const retagFailures = state.queue.retagFailures.filter((failure) => failure.inspectionId === inspectionId);

  const notices: ReactNode[] = [];
  if (state.phase === "unavailable" && state.problem) {
    notices.push(
      <Notice key="unavailable" icon={<TriangleAlertIcon aria-hidden />} title="Photos cannot be added on this device">
        {state.problem}
      </Notice>,
    );
  }
  if (items.length > 0 && state.queue.error?.reason === "unauthorized") {
    notices.push(
      <Notice
        key="signed-out"
        icon={<LogInIcon aria-hidden />}
        title="Sign in again to upload"
        action={
          <Button asChild size="sm" variant="outline">
            <Link href={`${LOGIN_PATH}?next=${encodeURIComponent(pathname ?? "/")}`}>Sign in</Link>
          </Button>
        }
      >
        Your session has ended. {capitalise(what)} {items.length === 1 ? "waits" : "wait"} on this device and upload
        {items.length === 1 ? "s" : ""} once you are signed in again.
      </Notice>,
    );
  } else if (items.length > 0 && !state.queue.online) {
    notices.push(
      <Notice key="offline" icon={<CloudOffIcon aria-hidden />} title="Offline">
        {capitalise(what)} {items.length === 1 ? "waits" : "wait"} on this device and upload{items.length === 1 ? "s" : ""}{" "}
        when the connection is back. Keep adding photos as usual.
      </Notice>,
    );
  }
  if (items.length > 0 && !state.queue.localCopy) {
    notices.push(
      <Notice key="memory" icon={<TriangleAlertIcon aria-hidden />} title="Keep this page open">
        This browser could not store the photos on the device, so they upload only while this page stays open. Do not
        reload or close it until the upload has finished.
      </Notice>,
    );
  }
  for (const failure of retagFailures) {
    notices.push(
      <Notice
        key={`retag-${failure.id}`}
        icon={<TriangleAlertIcon aria-hidden />}
        title="A new tag was not saved"
        action={
          <Button size="sm" variant="outline" onClick={() => photoQueueStore.dismissRetagFailure(failure.id)}>
            <XIcon aria-hidden />
            Dismiss
          </Button>
        }
      >
        The photo uploaded with its earlier tag and caption: {failure.error.message}
      </Notice>,
    );
  }

  if (notices.length === 0) return null;
  return <div className={cn("flex flex-col gap-3", className)}>{notices}</div>;
}

function capitalise(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
