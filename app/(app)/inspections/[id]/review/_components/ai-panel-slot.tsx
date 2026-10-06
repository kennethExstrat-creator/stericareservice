// The AI second opinion's place on the review (BUILD_SPEC 9.2). A placeholder:
// the real panel (components/ai/, three columns: the system's results, the
// inspector's, and the AI's opinion with agree, disagree or fixed per
// finding) takes this slot when it is wired in. Until then the review says
// what BUILD_SPEC asks a panel with nothing connected to say.
import { SparklesIcon } from "lucide-react";
import { StatusPill } from "@/components/qc";

export const AI_PANEL_HEADING_ID = "ai-second-opinion";

export function AiPanelSlot({ inspectionId }: { inspectionId: string }) {
  return (
    <section
      aria-labelledby={AI_PANEL_HEADING_ID}
      data-slot="ai-panel"
      data-inspection-id={inspectionId}
      className="rounded-xl bg-card px-5 py-4 shadow-sm ring-1 ring-border"
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-brand-600">
          <SparklesIcon aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id={AI_PANEL_HEADING_ID} className="text-lg font-bold text-foreground">
              AI second opinion
            </h2>
            <StatusPill status="info" size="sm" label="Not connected" />
          </div>
          <p className="text-base font-medium text-foreground fine:text-sm">AI second opinion not connected</p>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Once it is, the AI&apos;s suggested result and findings show here beside the system&apos;s results and the
            inspector&apos;s. The AI never changes a result: an admin records agree, disagree or fixed for each finding.
          </p>
        </div>
      </div>
    </section>
  );
}
