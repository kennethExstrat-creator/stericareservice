// Notices under the capture screen's header: why the inspection is
// read-only, and anything about saving that needs the inspector (the pill
// shows the state, this says what happened and what to do). Read-only
// notices speak to whoever is reading: the inspector about their own work,
// an admin about the review, a lead about a team member's inspection (whose
// it is, never "send it back to you"). A step's own notice, in the same
// look, sits at the top of its section: values saved for sizes the order
// does not list (notOrderedNotice; Kenneth, 27 October 2026).
import type { ReactNode } from "react";
import Link from "next/link";
import { CircleAlertIcon, InfoIcon, LockIcon, RefreshCwIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CaptureAccess, UserRole } from "@/lib/inspections/capture/access";
import { notOrderedMessage } from "@/lib/inspections/capture/not-ordered";
import type { ReopenNote } from "@/lib/inspections/capture/reopen";
import { BUSY_MESSAGE, type AutosaveError } from "@/lib/offline";
import { cn } from "@/lib/utils";
import type { AutosavePhase } from "./use-capture-autosave";

export type NoticeTone = "info" | "warn" | "error" | "lock";

export type CaptureNotice = {
  key: string;
  tone: NoticeTone;
  message: ReactNode;
  action?: ReactNode;
};

const LOOK: Readonly<Record<NoticeTone, { icon: LucideIcon; className: string; role: "status" | "alert" }>> = {
  info: { icon: InfoIcon, className: "border-info-border bg-info-tint text-info", role: "status" },
  lock: { icon: LockIcon, className: "border-border bg-card text-foreground", role: "status" },
  warn: { icon: TriangleAlertIcon, className: "border-warn-border bg-warn-tint text-warn", role: "status" },
  error: { icon: CircleAlertIcon, className: "border-fail-border bg-fail-tint text-fail", role: "alert" },
};

export function CaptureNotices({ notices, className }: { notices: readonly CaptureNotice[]; className?: string }) {
  if (notices.length === 0) return null;
  return (
    <div data-slot="capture-notices" className={cn("space-y-2", className)}>
      {notices.map((notice) => {
        const { icon: Icon, className: look, role } = LOOK[notice.tone];
        return (
          <div
            key={notice.key}
            role={role}
            data-notice={notice.key}
            className={cn(
              "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3 text-sm font-medium touch:text-base",
              look,
            )}
          >
            <p className="flex min-w-0 flex-1 basis-80 items-start gap-2.5">
              <Icon aria-hidden className="mt-0.5 size-4 shrink-0 touch:mt-1" />
              <span className="min-w-0">{notice.message}</span>
            </p>
            {notice.action && <div className="flex shrink-0 flex-wrap items-center gap-2">{notice.action}</div>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Why a submitted inspection is read-only here, said to whoever is reading it.
 * `canReopen`: their role approves and reopens (absent, as before roles, every
 * admin); one that does not is not told to reopen it.
 */
export function submittedMessage({
  role,
  own,
  inspectorName,
  canReopen = role === "admin",
}: {
  role: UserRole;
  own: boolean;
  inspectorName: string | null;
  canReopen?: boolean;
}): string {
  if (canReopen) return "Submitted for review: read-only here. To change it, reopen it from the review.";
  if (own) return "Submitted for review: read-only. An admin can send it back to you for changes.";
  // A lead inspector reading a team member's inspection: not theirs to have sent back.
  return `Submitted for review by ${inspectorName?.trim() || "another inspector"}: read-only.`;
}

export function captureNotices({
  access,
  role,
  inspectorName,
  reviewHref,
  lockedElsewhere,
  reopenNote,
  phase,
  setAside,
  error,
  localCopy,
  pending,
  retry,
  signInHref,
}: {
  access: CaptureAccess;
  role: UserRole;
  /** Whose inspection it is, for a reader who is not its inspector; null when unknown. */
  inspectorName: string | null;
  reviewHref: string;
  /** Submitted or approved since this page loaded, as a save found: the review is where it went. */
  lockedElsewhere: boolean;
  /** Why it was reopened, while it is. */
  reopenNote: ReopenNote | null;
  phase: AutosavePhase;
  setAside: boolean;
  error: AutosaveError | null;
  localCopy: boolean;
  pending: boolean;
  retry: () => void;
  signInHref: string;
}): CaptureNotice[] {
  const notices: CaptureNotice[] = [];
  const reload = (
    <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
      <RefreshCwIcon aria-hidden />
      Reload
    </Button>
  );

  if (access.readOnlyReason === "approved") {
    notices.push({ key: "approved", tone: "lock", message: "Approved: this inspection is read-only." });
  } else if (access.readOnlyReason === "submitted") {
    notices.push({
      key: "submitted",
      tone: "lock",
      message: submittedMessage({ role, own: access.own, inspectorName, canReopen: access.canReopen }),
      action: (
        <Button asChild variant="outline" size="sm">
          <Link href={reviewHref}>Open the Review</Link>
        </Button>
      ),
    });
  } else if (access.readOnlyReason === "not_yours") {
    notices.push({ key: "not-yours", tone: "lock", message: "This inspection belongs to another inspector: read-only." });
  }

  if (reopenNote) {
    notices.push({
      key: "reopened",
      tone: "info",
      message: (
        <>
          <span className="font-semibold">{reopenNote.title}.</span> {reopenNote.body}
          {reopenNote.reason && (
            <span className="mt-1 block font-normal whitespace-pre-line text-foreground">
              <span className="font-semibold">{reopenNote.reason.label}:</span> {reopenNote.reason.text}
            </span>
          )}
        </>
      ),
    });
  }

  if (phase === "busy") notices.push({ key: "busy", tone: "warn", message: BUSY_MESSAGE, action: reload });
  if (phase === "failed") {
    notices.push({
      key: "failed",
      tone: "error",
      message: "Saving could not start on this page. Reload it before entering anything.",
      action: reload,
    });
  }
  if (setAside) {
    notices.push({
      key: "set-aside",
      tone: "info",
      message: "An older unsaved copy on this device could not be read and was kept aside.",
    });
  }

  if (error && error.reason !== "conflict") {
    let action: ReactNode;
    if (error.reason === "unauthorized") {
      action = (
        <Button asChild variant="outline" size="sm">
          <Link href={signInHref}>Sign In Again</Link>
        </Button>
      );
    } else if (error.reason === "forbidden" || error.reason === "not_found") {
      // Refused for good (submitted elsewhere, no longer this user's, gone): trying again cannot help.
      action = lockedElsewhere ? (
        <>
          <Button asChild variant="outline" size="sm">
            <Link href={reviewHref}>Open the Review</Link>
          </Button>
          {reload}
        </>
      ) : (
        reload
      );
    } else if (error.reason === "other_tab") {
      action = reload;
    } else if (error.reason !== "storage") {
      action = (
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          <RefreshCwIcon aria-hidden />
          Try Again
        </Button>
      );
    }
    notices.push({ key: "save-error", tone: "error", message: `Not saved. ${error.message}`, action });
  } else if (!localCopy && pending) {
    notices.push({
      key: "no-local-copy",
      tone: "warn",
      message: "This browser keeps no copy on this device. Keep the page open until it shows Saved.",
    });
  }
  return notices;
}

/** The order's page, as a step's notice links it (notOrderedNotice). */
export type OrderLink = {
  /** Its short name: Order, or the template's own (PO Info). */
  title: string;
  /** Its address (`?module=order_lots`), for a new tab. */
  href: string;
  /** Opens it on this screen, at the size's quantity. */
  open: (size: string) => void;
};

/**
 * At the top of a step: the sizes it holds values for that the order does
 * not list (BUILD_SPEC 6.2 rule 4), which it shows once they are ordered
 * (Kenneth, 27 October 2026). Open Order goes to the order's page, at the
 * first size's quantity. Read-only, the notice names the sizes alone and
 * Open Order still opens the page; with no order page on screen there is
 * nowhere to go, and no button. Null without sizes.
 */
export function notOrderedNotice({
  sizes,
  sizeName = (size) => size,
  order,
  canAdd,
}: {
  /** Canonical, in size order (sizesNotOrdered). */
  sizes: readonly string[];
  /** A size as the order's rows name it: the template's label. */
  sizeName?: (size: string) => string;
  order: OrderLink | null;
  /** The inspection can be changed here: the notice says to add the sizes. */
  canAdd: boolean;
}): CaptureNotice | null {
  const first = sizes[0];
  if (first === undefined) return null;
  return {
    key: "sizes-not-ordered",
    tone: "warn",
    message: notOrderedMessage(sizes.map(sizeName), canAdd && order ? order.title : null),
    action: order ? (
      <Button asChild variant="outline" size="sm">
        <Link
          href={order.href}
          prefetch={false}
          // On this screen, without a request; a new tab opens the order's page as any link does.
          onNavigate={(event) => {
            event.preventDefault();
            order.open(first);
          }}
        >
          Open {order.title}
        </Link>
      </Button>
    ) : undefined,
  };
}
