// Every other second opinion of the inspection, newest first, each with the
// version it reviewed (BUILD_SPEC 9.2: "a new review is kept for each
// version"). Opening one shows its findings, decisions and questions.
import { HistoryIcon } from "lucide-react";
import { StatusPill } from "@/components/qc/status-pill";
import type { ReviewModel } from "@/lib/inspections/ai/types";
import { FindingCard, findingKey, QuestionItem } from "./finding";
import { Quiet, ResultPill } from "./pills";

export function ReviewHistory({
  reviews,
  canDecide,
  viewerId,
}: {
  reviews: ReviewModel[];
  canDecide: boolean;
  viewerId: string;
}) {
  if (reviews.length === 0) return null;
  return (
    <details className="group rounded-xl bg-card shadow-sm ring-1 ring-border" data-testid="ai-review-history">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-4 py-3 text-base font-bold text-foreground focus-ring-inset">
        <HistoryIcon aria-hidden className="size-5 text-brand-600" />
        Earlier Second Opinions ({reviews.length})
      </summary>
      <ol className="divide-y divide-border border-t border-border">
        {reviews.map((review) => (
          <li key={review.id} className="px-4 py-3">
            <HistoryEntry review={review} canDecide={canDecide} viewerId={viewerId} />
          </li>
        ))}
      </ol>
    </details>
  );
}

function HistoryEntry({ review, canDecide, viewerId }: { review: ReviewModel; canDecide: boolean; viewerId: string }) {
  const decided = review.findings.filter((finding) => finding.decision !== null).length;
  const facts = [
    `Version saved ${review.version}${review.isCurrentVersion ? " (current)" : ""}`,
    `requested ${review.requestedAt}`,
    review.source,
  ].filter(Boolean);

  return (
    <div className="space-y-2" data-review={review.id}>
      <div className="flex flex-wrap items-center gap-2">
        <StatePill review={review} />
        {review.state === "done" && review.confidencePct !== null && (
          <span className="text-sm text-muted-foreground tabular-nums">Confidence {review.confidencePct}%</span>
        )}
        {review.state === "done" && (
          <span className="text-sm text-muted-foreground">
            {review.findings.length} {review.findings.length === 1 ? "finding" : "findings"}
            {canDecide && review.findings.length > 0 ? `, ${decided} decided` : ""}
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{facts.join(" · ")}</p>
      {review.problem && <p className="text-sm break-words text-foreground">{review.problem}</p>}
      {review.state === "done" && (
        <details className="group/entry">
          <summary className="inline-flex min-h-8 cursor-pointer items-center rounded-sm text-sm font-semibold text-brand-600 focus-ring touch:min-h-11">
            Show This Opinion
          </summary>
          <div className="mt-3 space-y-3">
            {review.summary && <p className="text-sm break-words text-foreground">{review.summary}</p>}
            {!review.readable && <Quiet>Its findings could not be read.</Quiet>}
            {review.findings.map((finding) => (
              <FindingCard
                key={findingKey(review.id, finding.id)}
                finding={finding}
                reviewId={review.id}
                canDecide={canDecide}
                viewerId={viewerId}
              />
            ))}
            {review.questions.length > 0 && (
              <ul className="space-y-2" aria-label="Questions for the inspector">
                {review.questions.map((question) => (
                  <QuestionItem key={question.id} question={question} />
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function StatePill({ review }: { review: ReviewModel }) {
  switch (review.state) {
    case "done":
      return <ResultPill result={review.suggestedResult} size="sm" emptyLabel="No Result" />;
    case "failed":
      return <StatusPill status="fail" size="sm" label="Failed" />;
    case "stopped":
      return <StatusPill status="not_done" size="sm" label="Stopped" />;
    case "pending":
      return <StatusPill status="info" size="sm" label="Being Written" />;
  }
}
