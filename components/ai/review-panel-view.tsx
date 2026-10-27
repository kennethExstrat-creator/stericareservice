// The AI panel of the review screen (BUILD_SPEC 9.2), from its view model
// (lib/inspections/ai/panel-model.ts). Display only: the forms are client
// islands (request, decisions) and a poller refreshes the page while a
// second opinion is being written. Sized by its container, so it works
// full width or in a column of the review screen.
import type { ReactNode } from "react";
import { SparklesIcon, UnplugIcon } from "lucide-react";
import { StatusPill } from "@/components/qc/status-pill";
import { Spinner } from "@/components/ui/spinner";
import type { AiPanelModel, ReviewModel } from "@/lib/inspections/ai/types";
import { cn } from "@/lib/utils";
import { Comparison } from "./comparison";
import { FocusTarget } from "./focus-handoff";
import { AI_FOCUS } from "./focus-targets";
import { ReviewHistory } from "./history";
import { RequestReviewButton } from "./request-review";
import { ReviewPoller } from "./review-poller";

export function AiReviewPanelView({ model, className }: { model: AiPanelModel; className?: string }) {
  const { review, current, attempt, viewer } = model;
  const requestLabel = current || attempt ? "Request a New Second Opinion" : "Request Steri-AI Second Opinion";

  return (
    <section aria-labelledby="ai-panel-title" className={cn("@container/ai space-y-5", className)} data-testid="ai-panel">
      <header className="flex flex-col gap-3 @2xl/ai:flex-row @2xl/ai:items-start @2xl/ai:justify-between">
        <div className="min-w-0 space-y-1">
          <AiPanelTitle />
          <p className="text-sm text-muted-foreground">
            {viewer.canDecide
              ? "Steri-AI suggests and never changes a result. Record Agree, Disagree or Fixed for each finding."
              : "Steri-AI suggests and never changes a result. An admin decides on each finding."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 @2xl/ai:justify-end">
          {review.mock && <StatusPill status="warn" label="Test Data Only" />}
          {review.canRequest && <RequestReviewButton inspectionId={model.inspection.id} label={requestLabel} />}
        </div>
      </header>

      {!review.connected && <NotConnected model={model} />}

      {review.connected && !current && !attempt && (
        <Notice tone="neutral" title="No Second Opinion Yet">
          {viewer.canDecide
            ? (review.blockedReason ?? "Request one to compare Steri-AI's view with the computed results and the inspector's.")
            : "An admin can request one."}
        </Notice>
      )}

      {attempt && <AttemptNotice attempt={attempt} current={current} />}
      {model.pendingIds.length > 0 && <ReviewPoller inspectionId={model.inspection.id} pendingIds={model.pendingIds} />}

      {current && (
        // Keyed by the opinion: when a newer one lands, its findings get fresh
        // decision forms, so a half-made decision never moves to the finding
        // with the same id in another opinion.
        <div key={current.id} className="space-y-3">
          {/* Where focus goes when this opinion lands while its notice had focus. */}
          <FocusTarget
            name={AI_FOCUS.opinion}
            passTo={AI_FOCUS.opinion}
            className="rounded-sm text-sm text-muted-foreground"
            data-testid="ai-review-meta"
          >
            {[
              current.source,
              `requested ${current.requestedAt}`,
              `reviewed the version saved ${current.version}${current.isCurrentVersion ? " (current)" : ""}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </FocusTarget>
          {!current.isCurrentVersion && (
            <Notice tone="warn" title="The Inspection Has Changed Since This Opinion">
              {current.comparedBy === "content"
                ? "What it reviewed has changed: the entries, the modules switched off, or the lab reports and certificates."
                : `It was saved again at ${model.inspection.savedAt} (an edit and a status change both count).`}
              {review.canRequest ? " Request a new second opinion to review the current version." : ""}
            </Notice>
          )}
          {!current.readable && (
            <Notice tone="warn" title="Some of This Opinion Could Not Be Read">
              Its stored findings or questions no longer match the expected shape.
            </Notice>
          )}
          <Comparison model={model} review={current} />
        </div>
      )}

      <ReviewHistory reviews={model.history} canDecide={viewer.canDecide} viewerId={viewer.id} />
    </section>
  );
}

/** The panel's heading: its section is labelled by `ai-panel-title`. The quiet states in ai-review-panel.tsx carry it too. */
export function AiPanelTitle() {
  return (
    <h2 id="ai-panel-title" className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
      <SparklesIcon aria-hidden className="size-5 shrink-0 text-brand-600" />
      Steri-AI Second Opinion
    </h2>
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
            {!viewer.isAdmin
              ? "An admin can connect it."
              : review.switchedOff
                ? "It is switched off on the server: AI_REVIEW_PROVIDER is set to off. To connect it, set it to auto, with ANTHROPIC_API_KEY or AI_REVIEW_WEBHOOK_URL set. Admin > Steri-AI Settings shows the set-up."
                : "To connect it, set ANTHROPIC_API_KEY or AI_REVIEW_WEBHOOK_URL on the server. Admin > Steri-AI Settings shows the set-up."}
          </p>
        )}
        {(model.current || model.history.length > 0) && (
          <p className="text-sm text-muted-foreground">Earlier second opinions are kept below.</p>
        )}
      </div>
    </div>
  );
}

/**
 * The newest request when it has no opinion yet. "Request AI Second Opinion"
 * hands focus to it, and it hands focus on to the opinion when that lands.
 * The same focus target in every state, so a request that fails keeps focus.
 */
function AttemptNotice({ attempt, current }: { attempt: ReviewModel; current: ReviewModel | null }) {
  const earlier = current ? ` The opinion below is from ${current.requestedAt}.` : "";
  if (attempt.state === "pending") {
    return (
      <FocusTarget
        name={AI_FOCUS.attempt}
        passTo={AI_FOCUS.opinion}
        className="flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 touch:p-5"
        data-testid="ai-review-pending"
      >
        <Spinner aria-hidden className="mt-0.5 size-5 text-brand-600" />
        <div className="min-w-0 space-y-1">
          <p className="font-semibold text-foreground">Writing the Second Opinion</p>
          <p className="text-sm text-muted-foreground">
            Requested {attempt.requestedAt}. It can take a few minutes; this panel updates by itself.{earlier}
          </p>
        </div>
      </FocusTarget>
    );
  }
  const failed = attempt.state === "failed";
  return (
    <FocusTarget
      name={AI_FOCUS.attempt}
      passTo={AI_FOCUS.opinion}
      className={cn(NOTICE_BOX, NOTICE_TONE[failed ? "fail" : "warn"])}
      data-testid="ai-review-attempt"
    >
      <NoticeText tone={failed ? "fail" : "warn"} title={failed ? "The Last Request Failed" : "The Last Request Stopped"}>
        {attempt.problem}
        {earlier}
      </NoticeText>
    </FocusTarget>
  );
}

const NOTICE_BOX = "space-y-1 rounded-xl border p-4 touch:p-5";

const NOTICE_TONE = {
  neutral: "border-dashed border-not-done-border bg-card",
  warn: "border-warn-border bg-warn-tint",
  fail: "border-fail-border bg-fail-tint",
} as const;

type NoticeTone = keyof typeof NOTICE_TONE;

function Notice({ tone, title, children }: { tone: NoticeTone; title: string; children: ReactNode }) {
  return (
    <div className={cn(NOTICE_BOX, NOTICE_TONE[tone])}>
      <NoticeText tone={tone} title={title}>
        {children}
      </NoticeText>
    </div>
  );
}

function NoticeText({ tone, title, children }: { tone: NoticeTone; title: string; children: ReactNode }) {
  return (
    <>
      <p className={cn("font-semibold", tone === "fail" ? "text-fail" : tone === "warn" ? "text-warn" : "text-foreground")}>
        {title}
      </p>
      <p className="text-sm break-words text-foreground">{children}</p>
    </>
  );
}
