// The inspector's inspection summary (the conclusion's), with its
// formatting (RichTextView: React elements from the validated document, no
// editor on this page). Its first paragraph shows; Show More opens the rest
// (layout A, Kenneth, 27 October 2026: "too much wording").
import { RichTextView } from "@/components/qc";
import { inspectionSummary, type ReviewEvaluation } from "@/lib/inspections/review/evaluate";
import { CardSection } from "./review-section";
import { ShowMore } from "./show-more";

const TEXT = "max-w-[72ch] text-base text-foreground [overflow-wrap:anywhere] fine:text-sm";

export function InspectionSummary({ evaluation }: { evaluation: ReviewEvaluation }) {
  const summary = inspectionSummary(evaluation);
  if (!summary) return null;
  const { doc } = summary;
  const blocks = doc?.content ?? [];
  return (
    <CardSection
      id="summary"
      title={summary.label}
      aside={blocks.length === 0 ? <span className="text-sm text-muted-foreground">None</span> : undefined}
    >
      {doc && blocks.length > 0 && (
        <div className="px-5 pb-4">
          {blocks.length === 1 ? (
            <RichTextView doc={doc} className={TEXT} />
          ) : (
            <ShowMore
              preview={<RichTextView doc={{ ...doc, content: blocks.slice(0, 1) }} className={TEXT} />}
              full={<RichTextView doc={doc} className={TEXT} />}
            />
          )}
        </div>
      )}
    </CardSection>
  );
}
