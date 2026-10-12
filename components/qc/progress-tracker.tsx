// Progress across an inspection's modules (BUILD_SPEC 8). "bar" is a
// segmented strip for the iPad top bar; "list" suits the desktop sidebar and
// can show each module's result, and can hold a run of its steps in a group
// that collapses under a header (the capture screen's Inspection Steps).
// Progress uses the brand, results use status colours; the module in view
// carries the signature gradient. A step's label may be a short name (the
// capture screen's, docs/DESIGN.md Step Names): its `title` then names it in
// full on hover, on a list row and on the bar's name.
import { useId, type ReactNode } from "react";
import { ChevronRightIcon, CircleCheckIcon, CircleDotIcon, CircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Status } from "@/lib/design/status";
import { ResultChip } from "./result-chip";

export type StepState = "done" | "in_progress" | "not_started";

export type ProgressStep = {
  key: string;
  label: string;
  /** The step's full name, shown on hover when `label` is a short one. Without it, the label. */
  title?: string;
  state: StepState;
  /** The module's result, shown in the list variant. */
  result?: Status;
};

/**
 * A run of the list's steps under a header that opens and closes it (a
 * disclosure: the header is a button with aria-expanded). Controlled: the
 * caller keeps `open`.
 */
export type ProgressGroup = {
  /** The header's title, in Title Case. */
  label: string;
  /** The steps it holds, listed under the header in the order of `steps`, at the first one's place. */
  keys: readonly string[];
  /** The worst result among them, as the header's chip. */
  result?: Status;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type ProgressTrackerProps = {
  steps: readonly ProgressStep[];
  /** The module in view. */
  activeKey?: string;
  /** Makes each step a button. */
  onStepSelect?: (key: string) => void;
  variant?: "bar" | "list";
  /** List variant: steps listed together under a header that collapses them. */
  group?: ProgressGroup;
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

/** A list row, and a group's header: 36 px, 44 px on touch, growing with a second line. */
const LIST_ROW =
  "relative flex min-h-9 w-full items-center gap-2.5 rounded-md py-1.5 pr-2 pl-3.5 text-sm text-foreground touch:min-h-11";
/** The bar at a row's left edge: the module in view carries the gradient. */
const ROW_MARK = "absolute inset-y-1.5 left-0 w-1 rounded-full";
const ROW_MARK_ACTIVE = "bg-linear-to-b from-brand-500 to-accent-600";

export function ProgressTracker({
  steps,
  activeKey,
  onStepSelect,
  variant = "bar",
  group,
  label = "Inspection progress",
  className,
}: ProgressTrackerProps) {
  const done = steps.filter((step) => step.state === "done").length;
  const active = steps.find((step) => step.key === activeKey);

  // Bar segments take the ring around them; list rows (a sidebar that may
  // scroll or clip) take it inside.
  const focusClass = variant === "list" ? "focus-ring-inset" : "focus-ring";

  // A list row's title shows the step's full name on hover (title), however it is cut or shortened.
  // A list row carries its step's key (data-step), so a spec finds it whatever its name; the bar's segments do not.
  const rowKey = (step: ProgressStep) => (variant === "list" ? step.key : undefined);
  const item = (step: ProgressStep, content: ReactNode, itemClass: string, title?: string) =>
    onStepSelect ? (
      <button
        type="button"
        title={title}
        data-step={rowKey(step)}
        onClick={() => onStepSelect(step.key)}
        className={cn(itemClass, "outline-none", focusClass)}
      >
        {content}
      </button>
    ) : (
      <div title={title} data-step={rowKey(step)} className={itemClass}>
        {content}
      </div>
    );

  if (variant === "list") {
    // A step in a group sits a little in from its header's edge; the row's hover, its fill and the bar stay full width.
    const listItem = (step: ProgressStep, nested = false) => {
      const isActive = step.key === activeKey;
      const { Icon, className: iconClass } = ICON[step.state];
      return (
        <li key={step.key} aria-current={isActive ? "step" : undefined}>
          {item(
            step,
            <>
              <span aria-hidden className={cn(ROW_MARK, isActive && ROW_MARK_ACTIVE)} />
              <Icon aria-hidden className={cn("size-4 shrink-0", iconClass)} />
              {/* Two lines before it is cut: a short name fits one line in a 16 rem sidebar,
                  and a long label (a custom step's own title) is still told apart. */}
              <span className="line-clamp-2 min-w-0 flex-1 text-left leading-snug [overflow-wrap:anywhere]">
                {step.label}
              </span>
              <span className="sr-only">, {STATE_LABEL[step.state]}</span>
              {step.result && <ResultChip status={step.result} />}
            </>,
            cn(
              LIST_ROW,
              nested && "pl-6",
              onStepSelect && "hover:bg-muted",
              isActive && "bg-accent font-semibold text-accent-foreground hover:bg-accent",
            ),
            step.title ?? step.label,
          )}
        </li>
      );
    };

    const groupKeys = new Set(group?.keys);
    const grouped = steps.filter((step) => groupKeys.has(step.key));
    const items: ReactNode[] = [];
    for (const step of steps) {
      if (!group || !groupKeys.has(step.key)) items.push(listItem(step));
      else if (step === grouped[0]) {
        items.push(
          <ProgressGroupItem key="progress-group" group={group} steps={grouped} activeKey={activeKey}>
            {grouped.map((member) => listItem(member, true))}
          </ProgressGroupItem>,
        );
      }
    }

    return (
      <ol aria-label={label} data-slot="progress-tracker" className={cn("space-y-0.5", className)}>
        {items}
      </ol>
    );
  }

  return (
    <div data-slot="progress-tracker" className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate font-medium text-foreground" title={active?.title ?? active?.label}>
          {active?.label}
        </span>
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
                "relative flex h-6 w-full items-center rounded-full touch:h-11",
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * A group in the list: its header (a button with aria-expanded, which
 * controls the list of its steps) reads its title, how many of its steps are
 * done and the worst of their results; its steps follow in a list of their
 * own, hidden while it is collapsed. Collapsed over the module in view, the
 * header stands in for that step's row: it is the current item and carries
 * the gradient.
 */
function ProgressGroupItem({
  group,
  steps,
  activeKey,
  children,
}: {
  group: ProgressGroup;
  steps: readonly ProgressStep[];
  activeKey?: string;
  children: ReactNode;
}) {
  const listId = useId();
  const done = steps.filter((step) => step.state === "done").length;
  const current = !group.open && steps.some((step) => step.key === activeKey);
  return (
    <li data-slot="progress-group" aria-current={current ? "step" : undefined}>
      <button
        type="button"
        aria-expanded={group.open}
        aria-controls={listId}
        onClick={() => group.onOpenChange(!group.open)}
        className={cn(
          LIST_ROW,
          "outline-none focus-ring-inset hover:bg-muted",
          current && "bg-accent text-accent-foreground hover:bg-accent",
        )}
      >
        <span aria-hidden className={cn(ROW_MARK, current && ROW_MARK_ACTIVE)} />
        <ChevronRightIcon
          aria-hidden
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", group.open && "rotate-90")}
        />
        <span className="min-w-0 flex-1 text-left leading-snug">
          <span className="block font-medium">{group.label}</span>
          <span className="block text-xs text-muted-foreground tabular-nums">
            <span className="sr-only">, </span>
            {done} of {steps.length} done
            {group.result && <span className="sr-only">, </span>}
          </span>
        </span>
        {group.result && <ResultChip status={group.result} />}
      </button>
      <ol id={listId} hidden={!group.open} className="mt-0.5 space-y-0.5">
        {children}
      </ol>
    </li>
  );
}
