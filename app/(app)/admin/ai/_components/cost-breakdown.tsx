// Steri-AI Cost's two breakdowns of the period: by job, with what one
// document, photo or video, or review costs on average; and by model, with a
// note where calls had no price. Each row's meter is its share of the
// period's cost. Server components.
import { TriangleAlertIcon } from "lucide-react";
import { useId, type ReactNode } from "react";
import { priceFor, type AiPriceList } from "@/lib/schemas/ai-prices";
import { AI_JOB, type JobCost, type ModelCost } from "@/lib/schemas/ai-usage";
import { cn } from "@/lib/utils";
import { countOf, formatCost, type Money } from "./money";

function BreakdownCard({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      data-testid={testId}
      className="flex min-w-0 flex-col gap-4 rounded-xl bg-card p-5 shadow-sm ring-1 ring-border touch:p-6"
    >
      <h2 id={id} className="text-lg leading-tight font-bold text-foreground">
        {title}
      </h2>
      <ul className="flex flex-col gap-4">{children}</ul>
    </section>
  );
}

function Row({ name, cost, share, children }: { name: ReactNode; cost: string; share: number; children: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm touch:text-base">
        <span className="min-w-0 font-medium break-words text-foreground">{name}</span>
        <span className="shrink-0 tabular-nums text-foreground">{cost}</span>
      </div>
      <div aria-hidden className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-chart-1" style={{ width: `${Math.min(1, Math.max(0, share)) * 100}%` }} />
      </div>
      {children}
    </li>
  );
}

function Detail({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-sm text-muted-foreground", className)}>{children}</p>;
}

/** "48 documents · $0.127 each · 2 failed", or "No calls". */
function jobDetail(job: JobCost, money: Money): string {
  if (job.calls === 0) return "No calls";
  const words = AI_JOB[job.feature];
  const parts = [
    job.units > 0 ? countOf(job.units, words.unit, words.units) : countOf(job.calls, "call", "calls"),
    job.perUnitUsd !== null && `${formatCost(job.perUnitUsd, money, "unit")} each`,
    job.failed > 0 && `${job.failed.toLocaleString("en-US")} failed`,
  ];
  return parts.filter(Boolean).join(" · ");
}

export function CostByJob({ jobs, money }: { jobs: JobCost[]; money: Money }) {
  return (
    <BreakdownCard title="Cost by Job" testId="cost-by-job">
      {jobs.map((job) => (
        <Row key={job.feature} name={AI_JOB[job.feature].label} cost={formatCost(job.costUsd, money)} share={job.share}>
          <Detail>{jobDetail(job, money)}</Detail>
        </Row>
      ))}
    </BreakdownCard>
  );
}

/**
 * Calls recorded with no price count as nothing. Either the model is still
 * not in the price list (the admin adds it), or it was added since: a
 * recorded call keeps the cost it was recorded with.
 */
function UnpricedNote({ model, prices }: { model: ModelCost; prices: AiPriceList }) {
  const calls = countOf(model.unpricedCalls, "call", "calls");
  const listed = priceFor(prices, model.model, 0) !== null;
  return (
    <p className="flex gap-2 rounded-lg border border-warn-border bg-warn-tint px-3 py-2 text-sm text-warn">
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      {listed ? (
        <span>
          {model.unpricedCalls === 1 ? "1 call was" : `${calls} were`} made before {model.model} had a price, so{" "}
          {model.unpricedCalls === 1 ? "it is" : "they are"} not counted.
        </span>
      ) : (
        <span>
          No price for <span className="font-mono break-all">{model.model}</span> ({calls}). Add it to the{" "}
          <a
            href="#price-list"
            className="rounded-sm font-medium underline underline-offset-4 focus-ring touch:inline-flex touch:min-h-11 touch:items-center"
          >
            price list
          </a>
          .
        </span>
      )}
    </p>
  );
}

export function CostByModel({ models, money, prices }: { models: ModelCost[]; money: Money; prices: AiPriceList }) {
  return (
    <BreakdownCard title="Cost by Model" testId="cost-by-model">
      {models.length === 0 ? (
        <li>
          <Detail>No calls in this period.</Detail>
        </li>
      ) : (
        models.map((model) => (
          <Row
            key={model.model}
            // A model the app does not offer goes by its id.
            name={model.label === model.model ? <span className="font-mono">{model.model}</span> : model.label}
            cost={formatCost(model.costUsd, money)}
            share={model.share}
          >
            <Detail>{countOf(model.calls, "call", "calls")}</Detail>
            {model.unpricedCalls > 0 && <UnpricedNote model={model} prices={prices} />}
          </Row>
        ))
      )}
    </BreakdownCard>
  );
}
