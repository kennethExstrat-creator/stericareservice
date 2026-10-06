// The three columns of BUILD_SPEC 9.2, one row per section of the
// inspection: the system's computed result, the inspector's result and
// comment, and the AI's opinion with its findings and questions. From the
// panel's three-column width (a 56rem container) the columns sit side by
// side under one heading row; narrower, each cell carries its own label.
import type { ReactNode } from "react";
import { CircleXIcon, TriangleAlertIcon } from "lucide-react";
import { StatusPill } from "@/components/qc/status-pill";
import { STATUS_LABEL } from "@/lib/design/status";
import type { AiPanelModel, FindingModel, QuestionModel, ReviewModel, SectionModel } from "@/lib/inspections/ai/types";
import { cn } from "@/lib/utils";
import { FindingCard, findingKey, QuestionItem } from "./finding";
import { CellLabel, Quiet, ResultPill } from "./pills";

const COLUMNS = "@4xl/ai:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)] @4xl/ai:gap-6";

export const COLUMN_TITLES = {
  system: "System (computed)",
  inspector: "Inspector",
  ai: "AI second opinion",
} as const;

export function Comparison({ model, review }: { model: AiPanelModel; review: ReviewModel }) {
  const canDecide = model.viewer.isAdmin;
  return (
    <div
      className="overflow-clip rounded-xl bg-card shadow-sm ring-1 ring-border"
      data-testid="ai-comparison"
      data-review={review.id}
    >
      <div
        aria-hidden
        className={cn(
          "sticky top-(--shell-top) z-10 hidden border-b border-border bg-muted px-5 py-2.5 @4xl/ai:grid",
          COLUMNS,
          "text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase",
        )}
      >
        <span>{COLUMN_TITLES.system}</span>
        <span>{COLUMN_TITLES.inspector}</span>
        <span>{COLUMN_TITLES.ai}</span>
      </div>

      <div className="divide-y divide-border">
        <Row id={`${review.id}-overall`} title="Overall result" emphasis>
          <Cell label={COLUMN_TITLES.system}>
            <LabelledPill label="Suggested result">
              <ResultPill result={model.overall.system.result} />
            </LabelledPill>
            <p className="text-sm text-foreground">{model.overall.system.summary}</p>
          </Cell>
          <Cell label={COLUMN_TITLES.inspector}>
            <LabelledPill label="Final result">
              <ResultPill result={model.overall.inspector.finalResult} />
            </LabelledPill>
            <p className="text-sm text-muted-foreground">{model.overall.inspector.name}</p>
            {model.overall.inspector.remark ? (
              <Comment label="Remark">{model.overall.inspector.remark}</Comment>
            ) : (
              <Quiet>No remark</Quiet>
            )}
            {model.overall.inspector.comment && <Comment label="Comment">{model.overall.inspector.comment}</Comment>}
          </Cell>
          <Cell label={COLUMN_TITLES.ai}>
            <LabelledPill label="Suggested result">
              <ResultPill result={review.suggestedResult} emptyLabel="None" />
              {review.confidencePct !== null && (
                <span className="text-sm text-muted-foreground tabular-nums">Confidence {review.confidencePct}%</span>
              )}
            </LabelledPill>
            {review.summary && <p className="text-sm break-words text-foreground">{review.summary}</p>}
            <AiFindings
              reviewId={review.id}
              findings={model.overall.ai.findings}
              questions={model.overall.ai.questions}
              canDecide={canDecide}
              quietText={null}
            />
          </Cell>
        </Row>

        {model.sections.map((section) => (
          <Row key={section.key} id={`${review.id}-${section.key}`} title={section.title} kind={section.kind}>
            <Cell label={COLUMN_TITLES.system}>
              <SystemResult section={section} />
            </Cell>
            <Cell label={COLUMN_TITLES.inspector}>
              {section.inspector.comment ? (
                <Comment label="Comment">{section.inspector.comment}</Comment>
              ) : (
                <Quiet>No comment</Quiet>
              )}
            </Cell>
            <Cell label={COLUMN_TITLES.ai}>
              <AiFindings
                reviewId={review.id}
                findings={section.ai.findings}
                questions={section.ai.questions}
                canDecide={canDecide}
                quietText="No findings"
              />
            </Cell>
          </Row>
        ))}
      </div>

      {model.quiet.length > 0 && (
        <details className="group border-t border-border px-4 py-3 touch:px-5 @4xl/ai:px-5">
          <summary className="inline-flex min-h-8 cursor-pointer items-center rounded-sm text-sm font-semibold text-brand-600 focus-ring touch:min-h-11">
            {model.quiet.length} more {model.quiet.length === 1 ? "section" : "sections"} passed or for information,
            with no comments or findings
          </summary>
          <ul className="mt-2 grid gap-x-6 gap-y-2 pb-1 @2xl/ai:grid-cols-2 @4xl/ai:grid-cols-3">
            {model.quiet.map((section) => (
              <li key={section.key} className="flex min-w-0 items-center justify-between gap-3 text-sm">
                <span className="min-w-0 break-words text-foreground">{section.title}</span>
                {section.status && <StatusPill size="sm" status={section.status} />}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const KIND_NOTE: Readonly<Record<SectionModel["kind"], string | null>> = {
  module: null,
  custom: "Custom section",
  excluded: "Switched off for this inspection",
  other: "Not in the current version",
};

function Row({
  id,
  title,
  kind = "module",
  emphasis = false,
  children,
}: {
  id: string;
  title: string;
  kind?: SectionModel["kind"];
  emphasis?: boolean;
  children: ReactNode;
}) {
  const headingId = `ai-row-${id}`;
  const note = KIND_NOTE[kind];
  return (
    <section
      aria-labelledby={headingId}
      data-section={id}
      className={cn("space-y-3 px-4 py-4 touch:px-5 @4xl/ai:px-5", emphasis && "bg-brand-50")}
    >
      <h3 id={headingId} className="flex flex-wrap items-baseline gap-x-2 text-base font-bold text-foreground">
        {title}
        {note && <span className="font-sans text-sm font-normal text-muted-foreground">{note}</span>}
      </h3>
      <div className={cn("grid gap-4", COLUMNS)}>{children}</div>
    </section>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="relative min-w-0 space-y-2 border-l-2 border-border pl-3 @4xl/ai:border-l-0 @4xl/ai:pl-0">
      <CellLabel>{label}</CellLabel>
      {children}
    </div>
  );
}

function LabelledPill({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Comment({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="space-y-1">
      <figcaption className="text-xs font-semibold text-muted-foreground">{label}</figcaption>
      <blockquote className="border-l-2 border-brand-200 pl-3 text-sm break-words whitespace-pre-line text-foreground">
        {children}
      </blockquote>
    </figure>
  );
}

function SystemResult({ section }: { section: SectionModel }) {
  const { system } = section;
  if (section.kind === "excluded") {
    return (
      <>
        <StatusPill status="not_done" size="sm" label="Switched off" />
        {system.excludedReason && <Comment label="Reason">{system.excludedReason}</Comment>}
      </>
    );
  }
  if (section.kind === "other") return <Quiet>This section is not in the current version of the inspection.</Quiet>;
  return (
    <>
      {system.status ? (
        <StatusPill status={system.status} size="sm" />
      ) : (
        <Quiet>Custom fields: no computed result.</Quiet>
      )}
      {system.summary && <p className="text-sm break-words text-foreground">{system.summary}</p>}
      {system.perSize.length > 1 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Result per size">
          {system.perSize.map((entry) => (
            <li key={entry.size}>
              <StatusPill status={entry.status} size="sm" label={`${entry.label}: ${STATUS_LABEL[entry.status]}`} />
            </li>
          ))}
        </ul>
      )}
      {(system.errors.length > 0 || system.warnings.length > 0) && (
        <ul className="space-y-1">
          {system.errors.map((message, index) => (
            <li key={`error-${index}`} className="relative flex gap-1.5 text-sm text-fail">
              <CircleXIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 break-words">
                <span className="sr-only">Error: </span>
                {message}
              </span>
            </li>
          ))}
          {system.warnings.map((message, index) => (
            <li key={`warning-${index}`} className="relative flex gap-1.5 text-sm text-warn">
              <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 break-words">
                <span className="sr-only">Warning: </span>
                {message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function AiFindings({
  reviewId,
  findings,
  questions,
  canDecide,
  quietText,
}: {
  reviewId: string;
  findings: FindingModel[];
  questions: QuestionModel[];
  canDecide: boolean;
  quietText: string | null;
}) {
  if (findings.length === 0 && questions.length === 0) return quietText ? <Quiet>{quietText}</Quiet> : null;
  return (
    <div className="space-y-3">
      {findings.map((finding) => (
        <FindingCard key={findingKey(reviewId, finding.id)} finding={finding} reviewId={reviewId} canDecide={canDecide} />
      ))}
      {questions.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">
            {questions.length === 1 ? "Question for the inspector" : "Questions for the inspector"}
          </p>
          <ul className="space-y-2">
            {questions.map((question) => (
              <QuestionItem key={question.id} question={question} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
