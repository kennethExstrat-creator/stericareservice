// One AI finding with the evidence it points to (values, boxes, photos) and,
// for admins, the decision control. One AI question for the inspector.
import { CircleHelpIcon, FileImageIcon, ImageOffIcon } from "lucide-react";
import type { FindingModel, PhotoEvidenceModel, QuestionModel } from "@/lib/inspections/ai/types";
import { DecisionControl } from "./decision-control";
import { SeverityPill } from "./pills";

export function FindingCard({
  finding,
  reviewId,
  canDecide,
}: {
  finding: FindingModel;
  reviewId: string;
  /** Admins record decisions; inspectors see the finding only. */
  canDecide: boolean;
}) {
  const { evidence } = finding;
  const titleId = `finding-${reviewId}-${finding.id}`;
  const hasEvidence = evidence.values.length > 0 || evidence.boxes.length > 0 || evidence.photos.length > 0;

  return (
    <article
      aria-labelledby={titleId}
      data-finding={finding.id}
      className="space-y-3 rounded-lg border border-border bg-card p-3 touch:p-4"
    >
      <header className="flex flex-wrap items-center gap-2">
        <SeverityPill severity={finding.severity} />
        <h4 id={titleId} className="font-sans text-sm font-semibold text-foreground">
          Finding {finding.id}
          {finding.size && <span className="font-normal text-muted-foreground"> · Size {finding.size}</span>}
        </h4>
      </header>
      <p className="text-sm break-words text-foreground">{finding.message}</p>

      {hasEvidence && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">Evidence</p>
          {evidence.values.length > 0 && (
            // A number sits on its label's line, right aligned; a value too long to
            // share the line (the reviewer may quote a sentence) wraps below it.
            <dl className="space-y-1 text-sm">
              {evidence.values.map((value, index) => (
                <div key={`${value.label}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <dt className="min-w-0 break-words text-muted-foreground">{value.label}</dt>
                  <dd className="ml-auto min-w-0 text-right font-medium break-words text-foreground tabular-nums">
                    {value.value}
                    {value.unit ? ` ${value.unit}` : ""}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {evidence.boxes.length > 0 && (
            <p className="text-sm text-foreground">
              <span className="text-muted-foreground">{evidence.boxes.length === 1 ? "Box" : "Boxes"}: </span>
              <span className="tabular-nums">{evidence.boxes.join(", ")}</span>
            </p>
          )}
          {evidence.photos.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label={`Photos cited by finding ${finding.id}`}>
              {evidence.photos.map((photo) => (
                <li key={photo.id}>
                  <PhotoEvidence photo={photo} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {canDecide && (
        <div className="border-t border-border pt-3">
          <DecisionControl
            reviewId={reviewId}
            findingId={finding.id}
            decision={finding.decision}
            history={finding.history}
          />
        </div>
      )}
    </article>
  );
}

/** A thumbnail that opens the full photo in a new tab; a placeholder when it cannot be shown. */
function PhotoEvidence({ photo }: { photo: PhotoEvidenceModel }) {
  const label = photo.caption ?? photo.tags ?? "Photo";
  if (photo.state === "missing") {
    return (
      <span className="flex h-20 w-28 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-not-done-border bg-not-done-tint p-2 text-center text-xs text-not-done">
        <ImageOffIcon aria-hidden className="size-4" />
        Photo no longer in this inspection
      </span>
    );
  }
  const picture = photo.thumbUrl ? (
    // Signed storage links expire; next/image would cache them under another URL.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photo.thumbUrl} alt="" className="h-20 w-28 rounded-md object-cover" loading="lazy" decoding="async" />
  ) : (
    <span className="flex h-20 w-28 flex-col items-center justify-center gap-1 rounded-md bg-muted p-2 text-center text-xs text-muted-foreground">
      <FileImageIcon aria-hidden className="size-4" />
      {photo.state === "flagged" ? "Original file (HEIC)" : "No preview"}
    </span>
  );
  const caption = (
    <span className="block max-w-28 truncate text-xs text-muted-foreground" title={photo.tags ?? undefined}>
      {photo.caption ?? photo.tags ?? "Photo"}
    </span>
  );
  if (!photo.url) {
    return (
      <span className="block space-y-1">
        {picture}
        {caption}
      </span>
    );
  }
  return (
    <a
      href={photo.url}
      target="_blank"
      rel="noreferrer"
      className="relative block space-y-1 rounded-md focus-ring"
      aria-label={`${label}${photo.tags && photo.caption ? `, ${photo.tags}` : ""} (opens in a new tab)`}
    >
      {picture}
      {caption}
    </a>
  );
}

export function QuestionItem({ question }: { question: QuestionModel }) {
  return (
    <li className="relative flex gap-2 text-sm">
      <CircleHelpIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-600" />
      <p className="min-w-0 break-words">
        <span className="sr-only">Question {question.id} for the inspector: </span>
        <span className="text-foreground">{question.question}</span>
      </p>
    </li>
  );
}
