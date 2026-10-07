import { CircleAlertIcon } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { loadAiPanel, type AiPanelLoad } from "@/lib/inspections/ai";
import { cn } from "@/lib/utils";
import { AiReviewPanelView } from "./review-panel-view";

/**
 * The AI panel for one inspection, ready to drop into a page: a Server
 * Component that reads the panel's data as the signed-in user and renders
 * it. Admins request second opinions, record decisions and send to the AI
 * report; the inspector who owns the inspection sees the opinions
 * read-only. Anyone else gets nothing.
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

/** What loadAiPanel gave: the panel, nothing for an inspection the user may not read, or why it could not load. */
export function LoadedAiReviewPanel({ load, className }: { load: AiPanelLoad; className?: string }) {
  if (load.ok) return <AiReviewPanelView model={load.model} className={className} />;
  if (load.reason === "not_found") return null;
  return (
    <section
      aria-labelledby="ai-panel-title"
      className={cn("flex gap-3 rounded-xl border border-fail-border bg-fail-tint p-4", className)}
      data-testid="ai-panel-unavailable"
    >
      <CircleAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-fail" />
      <div className="space-y-1">
        <h2 id="ai-panel-title" className="text-base font-bold text-fail">
          The AI panel could not be loaded
        </h2>
        <p className="text-sm text-foreground">{load.message}</p>
      </div>
    </section>
  );
}
