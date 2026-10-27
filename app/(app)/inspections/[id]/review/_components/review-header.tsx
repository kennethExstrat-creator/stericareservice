// The review's header (layout A, Kenneth, 27 October 2026): the reference
// with its workflow status and when it got there, the client and product,
// and the actions: open the inspection (or go on with your own draft),
// Download PDF, and Approve and Reopen while it waits for review. It sticks
// below the shell's top bar while the page scrolls (StickyHeader). An
// approve or reopen replaces the buttons; focus then lands on the header,
// which now says the new status (FocusOnChange).
import Link from "next/link";
import { ClipboardListIcon, DownloadIcon, PencilLineIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { approvalChecks } from "@/lib/inspections/review/approval";
import { formatDateTime } from "@/lib/inspections/review/format";
import type { ReviewData, ReviewInspection } from "@/lib/inspections/review/load";
import { INSPECTIONS_PATH } from "@/lib/inspections/search-params";
import { reportPrintPath } from "@/lib/report/paths";
import { InspectionStatusBadge } from "../../../_components/inspection-status-badge";
import { FocusOnChange } from "./focus-on-change";
import { ReviewActions } from "./review-actions";
import { StickyHeader } from "./sticky-header";

export const REVIEW_TITLE_ID = "review-title";

export function ReviewHeader({
  review,
  canApprove,
  canDownload,
}: {
  review: ReviewData;
  /** The role's Approve and Reopen switch (userCan "approve_inspections"). */
  canApprove: boolean;
  /** Export Reports, for the inspection's own inspector or an admin (the capture Report page's rule). */
  canDownload: boolean;
}) {
  const { inspection } = review;
  const about = [inspection.client, inspection.productName].filter(Boolean).join(" · ");
  const when = statusTime(inspection);
  return (
    <StickyHeader>
      <FocusOnChange
        value={inspection.status}
        labelledBy={REVIEW_TITLE_ID}
        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl bg-card px-5 py-4 shadow-sm ring-1 ring-border"
      >
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 id={REVIEW_TITLE_ID} className="text-2xl leading-tight font-bold tracking-tight text-foreground">
              {inspection.refNo}
            </h1>
            {/* Spaces for screen readers and copying; the gap spaces them on screen. */}{" "}
            <InspectionStatusBadge status={inspection.status} />{" "}
            {when && (
              <span className="text-sm text-muted-foreground touch:text-base">
                <time dateTime={when}>{formatDateTime(when)}</time>
              </span>
            )}
          </div>{" "}
          {about && <p className="text-base text-muted-foreground [overflow-wrap:anywhere] fine:text-sm">{about}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HeaderActions review={review} canApprove={canApprove} canDownload={canDownload} />
        </div>
      </FocusOnChange>
    </StickyHeader>
  );
}

/** When the inspection got to its status: submitted, or approved; nothing for a draft or a reopened one, whose notice says it. */
function statusTime(inspection: ReviewInspection): string | null {
  if (inspection.status === "submitted") return inspection.submittedAt;
  if (inspection.status === "approved") return inspection.approvedAt;
  return null;
}

/**
 * Those whose role allows Approve and Reopen (`canApprove`) approve or
 * reopen a submitted inspection. Whoever owns a draft or a reopened
 * inspection goes on with it; everyone else can open it. Download PDF opens
 * the report's print page in a new tab, where the browser saves the PDF.
 */
function HeaderActions({
  review,
  canApprove,
  canDownload,
}: {
  review: ReviewData;
  canApprove: boolean;
  canDownload: boolean;
}) {
  const { viewer, inspection, evaluation } = review;
  const href = `${INSPECTIONS_PATH}/${inspection.id}`;
  const owner = viewer.id === inspection.inspector.id;
  const editable = inspection.status === "draft" || inspection.status === "reopened";

  const download = canDownload && (
    <Button asChild variant="outline">
      <a href={reportPrintPath(inspection.id, { autoPrint: true })} target="_blank" rel="noopener">
        <DownloadIcon aria-hidden />
        Download PDF
      </a>
    </Button>
  );

  if (owner && editable) {
    return (
      <>
        {download}
        <Button asChild>
          <Link href={href}>
            <PencilLineIcon aria-hidden />
            {inspection.status === "reopened" ? "Make Changes" : "Continue Inspection"}
          </Link>
        </Button>
      </>
    );
  }

  const open = (
    <Button asChild variant="outline">
      <Link href={href}>
        <ClipboardListIcon aria-hidden />
        Open Inspection
      </Link>
    </Button>
  );
  if (!canApprove || inspection.status !== "submitted") {
    return (
      <>
        {open}
        {download}
      </>
    );
  }

  return (
    <>
      {open}
      {download}
      <ReviewActions
        inspectionId={inspection.id}
        refNo={inspection.refNo}
        version={inspection.version}
        viewerId={viewer.id}
        finalResult={inspection.result}
        // No suggestion and no error count when the results could not be worked out: the dialog says so.
        {...approvalChecks(evaluation)}
      />
    </>
  );
}
