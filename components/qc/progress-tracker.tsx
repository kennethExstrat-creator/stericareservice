// Progress across an inspection's modules (BUILD_SPEC 8). "bar" is a
// segmented strip for the iPad top bar; "list" suits the desktop sidebar and
// can show each module's result. Progress uses the brand, results use status
// colours; the module in view carries the signature gradient.
import type { ReactNode } from "react";
import { CircleCheckIcon, CircleDotIcon, CircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Status } from "@/lib/design/status";
import { ResultChip } from "./result-chip";

export type StepState = "done" | "in_progress" | "not_started";

export type ProgressStep = {
  key: string;
  label: string;
  state: StepState;
  /** The module's result, shown in the list variant. */
  result?: Status;
};

type ProgressTrackerProps = {
  steps: readonly ProgressStep[];
  /** The module in view. */
  activeKey?: string;
  /** Makes each step a button. */
  onStepSelect?: (key: string) => void;
  variant?: "bar" | "list";
  label?: string;
  className?: string;
};

const STATE_LABEL: Readonly<Record<StepState, string>> = {
  done: "Done",
  in_progress: "In progress",
  not_started: "Not started",
};

const SEGMENT: Readonly<Record<StepState, string>> = {
  done: "bg-brand-500",
  in_progress: "bg-brand-300",
  not_started: "bg-slate-200",
};

const ICON = {
  done: { Icon: CircleCheckIcon, className: "text-brand-600" },
  in_progress: { Icon: CircleDotIcon, className: "text-brand-600" },
  not_started: { Icon: CircleIcon, className: "text-slate-400" },
} as const;

export function ProgressTracker({
  steps,
  activeKey,
  onStepSelect,
  variant = "bar",
  label = "Inspection progress",
  className,
}: ProgressTrackerProps) {
  const done = steps.filter((step) => step.state === "done").length;
  const active = steps.find((step) => step.key === activeKey);

  const item = (step: ProgressStep, content: ReactNode, itemClass: string) =>
    onStepSelect ? (
      <button
        type="button"
        onClick={() => onStepSelect(step.key)}
        className={cn(itemClass, "outline-none focus-visible:ring-3 focus-visible:ring-ring/50")}
      >
        {content}
      </button>
    ) : (
      <div className={itemClass}>{content}</div>
    );

  if (variant === "list") {
    return (
      <ol aria-label={label} data-slot="progress-tracker" className={cn("space-y-0.5", className)}>
        {steps.map((step) => {
          const isActive = step.key === activeKey;
          const { Icon, className: iconClass } = ICON[step.state];
          return (
            <li key={step.key} aria-current={isActive ? "step" : undefined}>
              {item(
                step,
                <>
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-y-1.5 left-0 w-1 rounded-full",
                      isActive && "bg-linear-to-b from-brand-500 to-accent-600",
                    )}
                  />
                  <Icon aria-hidden className={cn("size-4 shrink-0", iconClass)} />
                  <span className="min-w-0 flex-1 truncate text-left">{step.label}</span>
                  <span className="sr-only">, {STATE_LABEL[step.state]}</span>
                  {step.result && <ResultChip status={step.result} />}
                </>,
                cn(
                  "relative flex h-9 w-full items-center gap-2.5 rounded-md pr-2 pl-3.5 text-sm text-foreground touch:h-11",
                  onStepSelect && "hover:bg-muted",
                  isActive && "bg-accent font-semibold text-accent-foreground hover:bg-accent",
                ),
              )}
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <div data-slot="progress-tracker" className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate font-medium text-foreground">{active?.label}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {done} of {steps.length} done
        </span>
      </div>
      <ol aria-label={label} className="flex items-center gap-1">
        {steps.map((step) => {
          const isActive = step.key === activeKey;
          return (
            <li key={step.key} aria-current={isActive ? "step" : undefined} className="flex min-w-0 flex-1">
              {item(
                step,
                <>
                  <span
                    aria-hidden
                    className={cn(
                      "block w-full rounded-full",
                      isActive ? "h-2.5 bg-gradient-brand" : cn("h-1.5", SEGMENT[step.state]),
                    )}
                  />
                  <span className="sr-only">
                    {step.label}: {STATE_LABEL[step.state]}
                  </span>
                </>,
                "flex h-6 w-full items-center rounded-full touch:h-11",
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
