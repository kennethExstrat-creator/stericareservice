// The overall picture: what the app suggests from the module results, what
// the inspector decided and why, and how many problems the checks found.
// The suggestion never changes the final result (BUILD_SPEC 6.1 conclusion).
// Its pill says the result (Passed, Failed, On Hold) and the lines under it
// say why, as the submit confirmation does: nothing for a clean pass. Under
// them, the inspector's inspection summary with its formatting (RichTextView:
// React elements from the validated document, no editor on this page).
import type { ReactNode } from "react";
import { CircleXIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { RichTextView, StatusPill } from "@/components/qc";
import { Button } from "@/components/ui/button";
import { suggestionReasons } from "@/lib/inspections/capture/suggestion";
import { inspectionSummary, type ReviewEvaluation } from "@/lib/inspections/review/evaluate";
import { plural, RESULT_LABEL } from "@/lib/inspections/review/format";
import type { ReviewInspection } from "@/lib/inspections/review/load";
import { cn } from "@/lib/utils";
import { Panel, ReviewSection } from "./review-section";

function Card({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <Panel className={cn("flex flex-col gap-3 p-5", className)}>
      <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </Panel>
  );
}

function Note({ tone, children }: { tone: "warn" | "info"; children: ReactNode }) {
  const Icon = tone === "warn" ? TriangleAlertIcon : InfoIcon;
  return (
    <p
      className={cn(
        "flex gap-2 rounded-lg border px-3 py-2 text-sm",
        tone === "warn" ? "border-warn-border bg-warn-tint text-warn" : "border-info-border bg-info-tint text-info",
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function Verdict({ inspection, evaluation }: { inspection: ReviewInspection; evaluation: ReviewEvaluation }) {
  const suggested = evaluation.ok ? evaluation.report.suggested : null;
  const reasons = reasonsOf(evaluation);
  const final = inspection.result;
  const differs = final !== null && suggested !== null && final !== suggested.result;
  const savedDiffers =
    suggested !== null && inspection.savedSuggestion !== null && inspection.savedSuggestion !== suggested.result;
  const summary = inspectionSummary(evaluation);

  return (
    <ReviewSection id="result" title="Result">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card title="Suggested by the App">
          {suggested ? (
            <>
              <StatusPill status={suggested.result} label={RESULT_LABEL[suggested.result]} className="touch:h-8 touch:text-base" />
              {reasons.length > 0 && (
                <ul data-slot="suggested-reasons" className="space-y-0.5 text-base text-foreground fine:text-sm">
                  {reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
              {savedDiffers && inspection.savedSuggestion && (
                <Note tone="info">
                  When the inspection was last saved, the app suggested {RESULT_LABEL[inspection.savedSuggestion].toLowerCase()}.
                  The modules&apos; checks have changed since.
                </Note>
              )}
            </>
          ) : (
            <p className="text-base text-muted-foreground fine:text-sm">Not available: the results could not be worked out.</p>
          )}
        </Card>

        <Card title="Final Result (Inspector)">
          {final ? (
            <StatusPill status={final} variant="solid" label={RESULT_LABEL[final]} className="touch:h-8 touch:text-base" />
          ) : (
            <StatusPill status="not_done" label="Not Chosen" className="touch:h-8 touch:text-base" />
          )}
          <div>
            <p className="text-sm font-medium text-muted-foreground">Remark</p>
            {inspection.remarks ? (
              <p className="mt-0.5 text-base whitespace-pre-line text-foreground [overflow-wrap:anywhere] fine:text-sm">
                {inspection.remarks}
              </p>
            ) : (
              <p className="mt-0.5 text-base text-muted-foreground fine:text-sm">No remark</p>
            )}
          </div>
          {differs && <Note tone="warn">The final result differs from the suggested result.</Note>}
        </Card>

        <Card title="Checks" className="md:col-span-2 xl:col-span-1">
          {evaluation.ok ? <Checks evaluation={evaluation} /> : <Note tone="warn">{evaluation.message}</Note>}
        </Card>

        {summary && (
          <Card title={summary.label} className="md:col-span-2 xl:col-span-3">
            {summary.doc ? (
              <RichTextView doc={summary.doc} className="text-base text-foreground fine:text-sm [overflow-wrap:anywhere]" />
            ) : (
              <p className="text-base text-muted-foreground fine:text-sm">No summary</p>
            )}
          </Card>
        )}
      </div>
    </ReviewSection>
  );
}

/** Why the app suggests what it does, a line per reason, the sections by their titles in the template's wording. */
function reasonsOf(evaluation: ReviewEvaluation): string[] {
  if (!evaluation.ok) return [];
  const { modules, suggested } = evaluation.report;
  return suggestionReasons(suggested, (key) => modules.find((module) => module.key === key)?.title ?? key);
}

function Checks({ evaluation }: { evaluation: Extract<ReviewEvaluation, { ok: true }> }) {
  const { summary, report } = evaluation;
  const included = report.modules.length;
  const switchedOff = report.excluded.length;
  return (
    <>
      <ul className="grid gap-2 text-base fine:text-sm">
        <li className={cn("flex items-center gap-2", summary.errors > 0 ? "font-semibold text-fail" : "text-foreground")}>
          <CircleXIcon aria-hidden className={cn("size-4 shrink-0", summary.errors > 0 ? "text-fail" : "text-slate-500")} />
          {summary.errors === 0 ? "No errors" : plural(summary.errors, "error")}
        </li>
        <li className={cn("flex items-center gap-2", summary.warnings > 0 ? "font-semibold text-warn" : "text-foreground")}>
          <TriangleAlertIcon aria-hidden className={cn("size-4 shrink-0", summary.warnings > 0 ? "text-warn" : "text-slate-500")} />
          {summary.warnings === 0 ? "No warnings" : plural(summary.warnings, "warning")}
        </li>
        <li className="flex items-center gap-2 text-foreground">
          <span aria-hidden className="size-4 shrink-0 rounded-full border-2 border-dashed border-not-done-border" />
          {summary.notDone === 0 ? "Every module is done" : `${plural(summary.notDone, "module")} not done`}
        </li>
      </ul>
      <p className="text-sm text-muted-foreground">
        {plural(included, "module")} in this inspection
        {switchedOff > 0 ? `, ${switchedOff} switched off for it` : ""}.
      </p>
      <Button asChild variant="link" className="h-auto justify-start px-0 touch:h-11 touch:px-0">
        <a href="#modules">See the Module Results</a>
      </Button>
    </>
  );
}
