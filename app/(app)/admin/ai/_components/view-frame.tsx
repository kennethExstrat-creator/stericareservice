"use client";

// Steri-AI Settings' view switch and the view under it. Each view is its own
// address (view-state.ts) that the server renders with only its own data: the
// switch pushes it, so Back returns to the previous view, and the cost view's
// filters replace it in place (useCostFilters). The pill moves at once; the
// old view stays, dimmed, until the new one has arrived: no skeleton, nothing
// jumps.
import { ClipboardCheckIcon, CoinsIcon, SlidersHorizontalIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, use, useCallback, useOptimistic, useTransition, type ReactNode } from "react";
import { PillSwitch, type PillOption } from "@/components/ui/pill-switch";
import { cn } from "@/lib/utils";
import {
  aiViewHref,
  DEFAULT_COST_CURRENCY,
  DEFAULT_COST_PERIOD,
  type AiView,
  type AiViewState,
  type CostFilters,
} from "./view-state";

const VIEWS: readonly PillOption<AiView>[] = [
  { value: "general", label: "General", icon: SlidersHorizontalIcon },
  { value: "inspection", label: "Inspection Settings", icon: ClipboardCheckIcon },
  { value: "cost", label: "Steri-AI Cost", icon: CoinsIcon },
];

const CostFiltersContext = createContext<((filters: CostFilters) => void) | null>(null);

/**
 * For the cost view's filters: shows the cost view with other filters,
 * replacing the address (no history entry per filter), the view dimmed until
 * the server has rendered it.
 */
export function useCostFilters(): (filters: CostFilters) => void {
  const change = use(CostFiltersContext);
  if (!change) throw new Error("useCostFilters needs the view frame around it.");
  return change;
}

export function ViewFrame({ state, children }: { state: AiViewState; children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [view, setView] = useOptimistic(state.view);

  function show(next: AiView) {
    if (next === view) return;
    // Another view drops the cost filters; the cost view opens on its defaults.
    const target: AiViewState =
      next === "cost" ? { view: next, period: DEFAULT_COST_PERIOD, currency: DEFAULT_COST_CURRENCY } : { view: next };
    startTransition(() => {
      setView(next);
      router.push(aiViewHref(target), { scroll: false });
    });
  }

  const changeCostFilters = useCallback(
    (filters: CostFilters) => {
      startTransition(() => router.replace(aiViewHref({ view: "cost", ...filters }), { scroll: false }));
    },
    [router],
  );

  return (
    <CostFiltersContext value={changeCostFilters}>
      <div className="flex min-w-0 flex-col gap-6">
        <PillSwitch value={view} options={VIEWS} onValueChange={show} label="View" data-testid="ai-view-switch" />
        <div aria-busy={pending || undefined} className={cn("min-w-0 transition-opacity", pending && "opacity-60")}>
          {children}
        </div>
      </div>
    </CostFiltersContext>
  );
}
