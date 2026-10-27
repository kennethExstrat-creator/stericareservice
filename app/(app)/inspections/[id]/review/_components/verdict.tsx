// The overall picture, in one card (layout A, Kenneth, 27 October 2026: no
// explanations): the inspector's final result with the remark, the app's
// suggestion beside it (Matches, or Differs, with what failed or is not done)
// and the checks' counts, each linking to the problems. The suggestion never
// changes the final result (BUILD_SPEC 6.1 conclusion).
import type { ReactNode } from "react";
import { CheckIcon, CircleCheckIcon, CircleXIcon, TriangleAlertIcon } from "lucide-react";
import { StatusPill } from "@/components/qc";
import { suggestionReasons } from "@/lib/inspections/capture/suggestion";
import type { ReviewEvaluation } from "@/lib/inspections/review/evaluate";
import { plural, RESULT_LABEL } from "@/lib/inspections/review/format";
import type { ReviewInspection } from "@/lib/inspections/review/load";
import { cn } from "@/lib/utils";

const TEXT = "text-base fine:text-sm";

function Part({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2.5 px-5 py-4", className)}>
      <h3 className="text-sm font-semibold text-muted-foreground">{label}</h3>
      {children}
    </div>
  );
}

export function Verdict({ inspection, evaluation }: { inspection: ReviewInspection; evaluation: ReviewEvaluation }) {
  const suggested = evaluation.ok ? evaluation.report.suggested : null;
  const final = inspection.result;
  const differs = final !== null && suggested !== null && final !== suggested.result;
  const matches = final !== null && suggested !== null && final === suggested.result;
  // What failed or is not done; the warnings are the Checks' and the attention list's.
  const reasons = evaluation.ok
    ? suggestionReasons(
        { ...evaluation.report.suggested, warned: [] },
        (key) => evaluation.report.modules.find((module) => module.key === key)?.title ?? key,
      )
    : [];
  const changedSinceSaved =
    suggested !== null && inspection.savedSuggestion !== null && inspection.savedSuggestion !== suggested.result
      ? inspection.savedSuggestion
      : null;

  return (
    <section
      id="result"
      aria-labelledby="result-heading"
      className="grid divide-y divide-border rounded-xl bg-card shadow-sm ring-1 ring-border md:grid-cols-3 md:divide-x md:divide-y-0"
    >
      <h2 id="result-heading" className="sr-only">
        Result
      </h2>
      <Part label="Final Result (Inspector)">
        {final ? (
          <StatusPill status={final} variant="solid" label={RESULT_LABEL[final]} className="h-9 gap-2 px-4 text-base [&>svg]:size-5" />
        ) : (
          <StatusPill status="not_done" label="Not Chosen" />
        )}
        <p className={cn("text-muted-foreground", TEXT)}>
          Remark:{" "}
          {inspection.remarks ? (
            <span className="whitespace-pre-line text-foreground [overflow-wrap:anywhere]">{inspection.remarks}</span>
          ) : (
            "—"
          )}
        </p>
      </Part>

      <Part label="Suggested by the App">
        {suggested ? (
          <>
            <StatusPill status={suggested.result} label={RESULT_LABEL[suggested.result]} />
            {matches && (
              <p className={cn("flex items-center gap-1.5 text-muted-foreground", TEXT)}>
                <CheckIcon aria-hidden className="size-4 shrink-0 text-pass" />
                Matches
              </p>
            )}
            {differs && (
              <p className={cn("flex items-center gap-1.5 font-semibold text-warn", TEXT)}>
                <TriangleAlertIcon aria-hidden className="size-4 shrink-0" />
                Differs from the final result
              </p>
            )}
            {reasons.length > 0 && (
              <ul data-slot="suggested-reasons" className={cn("space-y-0.5 text-foreground", TEXT)}>
                {reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
            {changedSinceSaved && (
              <p className={cn("text-info", TEXT)}>Was {RESULT_LABEL[changedSinceSaved].toLowerCase()} when last saved</p>
            )}
          </>
        ) : (
          <p className={cn("text-muted-foreground", TEXT)}>Not available</p>
        )}
      </Part>

      <Part label="Checks">
        {evaluation.ok ? (
          <Checks summary={evaluation.summary} />
        ) : (
          <p className={cn("flex gap-2 text-warn", TEXT)}>
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {evaluation.message}
          </p>
        )}
      </Part>
    </section>
  );
}

function Checks({ summary }: { summary: Extract<ReviewEvaluation, { ok: true }>["summary"] }) {
  return (
    <ul className={cn("grid gap-2", TEXT)}>
      <li>
        {summary.errors === 0 ? (
          <span className="flex items-center gap-2 text-foreground">
            <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-pass" />
            No errors
          </span>
        ) : (
          <a href="#attention" className="flex w-fit items-center gap-2 font-semibold text-fail underline underline-offset-3 focus-ring">
            <CircleXIcon aria-hidden className="size-4 shrink-0" />
            {plural(summary.errors, "error")}
          </a>
        )}
      </li>
      <li>
        {summary.warnings === 0 ? (
          <span className="flex items-center gap-2 text-foreground">
            <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-pass" />
            No warnings
          </span>
        ) : (
          <a href="#attention" className="flex w-fit items-center gap-2 font-semibold text-warn underline underline-offset-3 focus-ring">
            <TriangleAlertIcon aria-hidden className="size-4 shrink-0" />
            {plural(summary.warnings, "warning")}
          </a>
        )}
      </li>
      <li>
        {summary.notDone === 0 ? (
          <span className="flex items-center gap-2 text-foreground">
            <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-pass" />
            Every module is done
          </span>
        ) : (
          <a href="#modules" className="flex w-fit items-center gap-2 font-semibold text-foreground underline underline-offset-3 focus-ring">
            <span aria-hidden className="size-4 shrink-0 rounded-full border-2 border-dashed border-not-done-border" />
            {`${plural(summary.notDone, "module")} not done`}
          </a>
        )}
      </li>
    </ul>
  );
}
