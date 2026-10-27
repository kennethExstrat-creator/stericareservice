import { CircleAlertIcon, CircleDashedIcon } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { loadAiPanel, type AiPanelLoad } from "@/lib/inspections/ai";
import { cn } from "@/lib/utils";
import { AiPanelTitle, AiReviewPanelView } from "./review-panel-view";

/**
 * The AI panel for one inspection, ready to drop into a page: a Server
 * Component that reads the panel's data as the signed-in user and renders
 * it. Admins request second opinions and record decisions; the inspector
 * who owns the inspection sees the opinions read-only. Anyone else gets
 * nothing.
 *
 *   <AiReviewPanel inspectionId={id} />
 *
 * A page that loads the panel itself, beside its own reads (the review
 * screen), renders <LoadedAiReviewPanel load={await loadAiPanel(user, id)} />.
 */
export async function AiReviewPanel({ inspectionId, className }: { inspectionId: string; className?: string }) {
  const user = await requireUser();
  return <LoadedAiReviewPanel load={await loadAiPanel(user, inspectionId)} className={className} />;
}

/**
 * What loadAiPanel gave: the panel; nothing for an inspection the user may
 * not read; a quiet note when its results cannot be worked out; an error
 * when a read failed.
 */
export function LoadedAiReviewPanel({ load, className }: { load: AiPanelLoad; className?: string }) {
  if (load.ok) return <AiReviewPanelView model={load.model} className={className} />;
  if (load.reason === "not_found") return null;
  if (load.reason === "unreadable") return <NoResults className={className} />;
  return (
    <section
      aria-labelledby="ai-panel-title"
      className={cn("flex gap-3 rounded-xl border border-fail-border bg-fail-tint p-4", className)}
      data-testid="ai-panel-unavailable"
    >
      <CircleAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-fail" />
      <div className="space-y-1">
        <h2 id="ai-panel-title" className="text-base font-bold text-fail">
          Steri-AI Panel Could Not Be Loaded
        </h2>
        <p className="text-sm text-foreground">{load.message}</p>
      </div>
    </section>
  );
}

/**
 * The inspection's results cannot be worked out, so the AI has nothing to
 * compare. Not an error of the panel's: the review already says why, in its
 * checks and module results, so the panel keeps its place and says only
 * what is missing, in not-done slate.
 */
function NoResults({ className }: { className?: string }) {
  return (
    <section aria-labelledby="ai-panel-title" className={cn("space-y-5", className)} data-testid="ai-panel-no-results">
      <AiPanelTitle />
      <div className="flex gap-3 rounded-xl border border-dashed border-not-done-border bg-card p-4 touch:p-5">
        <CircleDashedIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-not-done" />
        <div className="min-w-0 space-y-1">
          <p className="font-semibold text-foreground">Not Available</p>
          <p className="text-sm text-muted-foreground">
            Steri-AI&apos;s second opinion needs this inspection&apos;s results, which could not be worked out.
          </p>
        </div>
      </div>
    </section>
  );
}
