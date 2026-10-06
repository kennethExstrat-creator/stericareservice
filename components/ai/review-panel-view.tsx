// The AI panel of the review screen (BUILD_SPEC 9.1 and 9.2), from its view
// model (lib/inspections/ai/panel-model.ts). Display only: the forms are
// client islands (request, decisions, report) and a poller refreshes the
// page while a second opinion is being written. Sized by its container, so
// it works full width or in a column of the review screen.
import type { ReactNode } from "react";
import { FileTextIcon, SparklesIcon, UnplugIcon } from "lucide-react";
import { StatusPill } from "@/components/qc/status-pill";
import { Spinner } from "@/components/ui/spinner";
import type { AiPanelModel, ReviewModel } from "@/lib/inspections/ai/types";
import { cn } from "@/lib/utils";
import { Comparison } from "./comparison";
import { ReviewHistory } from "./history";
import { ReportControl } from "./report-control";
import { RequestReviewButton } from "./request-review";
import { ReviewPoller } from "./review-poller";

export function AiReviewPanelView({ model, className }: { model: AiPanelModel; className?: string }) {
  const { review, current, attempt, viewer } = model;
  const requestLabel = current || attempt ? "Request a new second opinion" : "Request AI second opinion";

  return (
    <section aria-labelledby="ai-panel-title" className={cn("@container/ai space-y-5", className)} data-testid="ai-panel">
      <header className="flex flex-col gap-3 @2xl/ai:flex-row @2xl/ai:items-start @2xl/ai:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 id="ai-panel-title" className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <SparklesIcon aria-hidden className="size-5 shrink-0 text-brand-600" />
            AI second opinion
          </h2>
          <p className="text-sm text-muted-foreground">
            {viewer.isAdmin
              ? "The AI suggests and never changes a result. Record agree, disagree or fixed for each finding."
              : "The AI suggests and never changes a result. An admin decides on each finding."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 @2xl/ai:justify-end">
          {review.mock && <StatusPill status="warn" label="Test data only" />}
          {review.canRequest && <RequestReviewButton inspectionId={model.inspection.id} label={requestLabel} />}
        </div>
      </header>

      {!review.connected && <NotConnected model={model} />}

      {review.connected && !current && !attempt && (
        <Notice tone="neutral" title="No second opinion yet">
          {viewer.isAdmin
            ? (review.blockedReason ?? "Request one to compare the AI's view with the computed results and the inspector's.")
            : "An admin can request one."}
        </Notice>
      )}

      {attempt && <AttemptNotice attempt={attempt} current={current} />}
      {model.pendingIds.length > 0 && <ReviewPoller inspectionId={model.inspection.id} pendingIds={model.pendingIds} />}

      {current && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground" data-testid="ai-review-meta">
            {[
              current.source,
              `requested ${current.requestedAt}`,
              `reviewed the version saved ${current.version}${current.isCurrentVersion ? " (current)" : ""}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {!current.isCurrentVersion && (
            <Notice tone="warn" title="The inspection has changed since this opinion">
              It was saved again at {model.inspection.savedAt} (an edit, a status change or a report link all count).
              {viewer.isAdmin && review.canRequest ? " Request a new second opinion to review the current version." : ""}
            </Notice>
          )}
          {!current.readable && (
            <Notice tone="warn" title="Some of this opinion could not be read">
              Its stored findings or questions no longer match the expected shape.
            </Notice>
          )}
          <Comparison model={model} review={current} />
        </div>
      )}

      <ReviewHistory reviews={model.history} canDecide={viewer.isAdmin} />

      <ReportSection model={model} />
    </section>
  );
}

function NotConnected({ model }: { model: AiPanelModel }) {
  const { review, viewer } = model;
  return (
    <div
      className="flex gap-3 rounded-xl border border-dashed border-not-done-border bg-card p-4 touch:p-5"
      data-testid="ai-review-not-connected"
    >
      <UnplugIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-not-done" />
      <div className="min-w-0 space-y-1">
        <p className="font-semibold text-foreground">{review.label}</p>
        {review.detail ? (
          <p className="text-sm break-words text-fail">{review.detail}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {viewer.isAdmin
              ? "To connect it, set ANTHROPIC_API_KEY or AI_REVIEW_WEBHOOK_URL on the server. The admin overview shows the set-up."
              : "An admin can connect it."}
          </p>
        )}
        {(model.current || model.history.length > 0) && (
          <p className="text-sm text-muted-foreground">Earlier second opinions are kept below.</p>
        )}
      </div>
    </div>
  );
}

function AttemptNotice({ attempt, current }: { attempt: ReviewModel; current: ReviewModel | null }) {
  const earlier = current ? ` The opinion below is from ${current.requestedAt}.` : "";
  if (attempt.state === "pending") {
    return (
      <div
        className="flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 touch:p-5"
        data-testid="ai-review-pending"
      >
        <Spinner aria-hidden className="mt-0.5 size-5 text-brand-600" />
        <div className="min-w-0 space-y-1">
          <p className="font-semibold text-foreground">Writing the second opinion</p>
          <p className="text-sm text-muted-foreground">
            Requested {attempt.requestedAt}. It can take a few minutes; this panel updates by itself.{earlier}
          </p>
        </div>
      </div>
    );
  }
  return (
    <Notice
      tone={attempt.state === "failed" ? "fail" : "warn"}
      title={attempt.state === "failed" ? "The last request failed" : "The last request stopped"}
    >
      {attempt.problem}
      {earlier}
    </Notice>
  );
}

const NOTICE_TONE = {
  neutral: "border-dashed border-not-done-border bg-card",
  warn: "border-warn-border bg-warn-tint",
  fail: "border-fail-border bg-fail-tint",
} as const;

function Notice({ tone, title, children }: { tone: keyof typeof NOTICE_TONE; title: string; children: ReactNode }) {
  return (
    <div className={cn("space-y-1 rounded-xl border p-4 touch:p-5", NOTICE_TONE[tone])}>
      <p className={cn("font-semibold", tone === "fail" ? "text-fail" : tone === "warn" ? "text-warn" : "text-foreground")}>
        {title}
      </p>
      <p className="text-sm break-words text-foreground">{children}</p>
    </div>
  );
}

function ReportSection({ model }: { model: AiPanelModel }) {
  const { report, viewer, inspection } = model;
  const description = !report.connected
    ? "AI not connected. Download the export (JSON) to pass it on to whoever writes the report."
    : report.canSend || !viewer.isAdmin
      ? "The report service writes the client report from the export of this inspection."
      : (report.blockedReason ?? "The report service writes the client report from the export.");

  return (
    <section
      aria-labelledby="ai-report-title"
      className="space-y-3 rounded-xl bg-card p-4 shadow-sm ring-1 ring-border touch:p-5"
      data-testid="ai-report"
    >
      <div className="flex flex-col gap-3 @3xl/ai:flex-row @3xl/ai:items-start @3xl/ai:justify-between">
        <div className="min-w-0 space-y-1">
          <h3 id="ai-report-title" className="flex flex-wrap items-center gap-2 text-lg font-bold text-foreground">
            <FileTextIcon aria-hidden className="size-5 shrink-0 text-brand-600" />
            AI report
            {!report.connected && <StatusPill status="info" size="sm" label={report.label} />}
          </h3>
          <p className="text-sm text-muted-foreground">{description}</p>
          {report.detail && <p className="text-sm break-words text-fail">{report.detail}</p>}
        </div>
        <ReportControl
          inspectionId={inspection.id}
          exportHref={inspection.exportHref}
          reportUrl={inspection.reportUrl}
          connected={report.connected}
          canSend={report.canSend}
        />
      </div>
    </section>
  );
}
