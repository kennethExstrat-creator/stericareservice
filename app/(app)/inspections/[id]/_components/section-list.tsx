"use client";

// The section list in the capture screen's sidebar from 1280 px (BUILD_SPEC
// 8: on desktop, modules show in a left sidebar). The included pages
// (lib/inspections/capture/sections.ts capturePages: packing configuration
// on the order's) are the ProgressTracker's list, each with its progress and
// result chip. Source Documents, first (General Information on its page, no
// row of its own), then the order, the sampling plan and the box/carton
// numbers (LEAD_PAGE_KEYS: Kenneth, 26 October 2026), and the Conclusion,
// last, always show; the other steps sit in one group, Inspection Steps, whose
// header reads how many are done and the worst of their results, and which
// collapses (Kenneth, 12 October 2026: "make these section collapsable,
// leaving source document and conclusion visible by default"). Collapsed at
// first, open whenever the page in view is one of its steps, and as the
// inspector last left it otherwise (use-step-group.ts). The sections an
// admin switched off for this inspection follow in their own group, marked
// off. Every row names its step by its short name, its full title on hover
// (Kenneth, 12 October 2026: "this menu is crowded, simplify the section
// name"; docs/DESIGN.md, Step Names).
import { CircleOffIcon } from "lucide-react";
import { ProgressTracker, type ProgressGroup } from "@/components/qc";
import { LEAD_PAGE_KEYS, pageStatus, progressSteps, stepIcon, type CapturePage, type IncludedPage } from "@/lib/inspections/capture/sections";
import type { ModuleKey } from "@/lib/schemas/module-result";
import { cn } from "@/lib/utils";
import { useStepGroup } from "./use-step-group";

/** The group's header. */
export const STEP_GROUP_LABEL = "Inspection Steps";

const CONCLUSION_KEY: ModuleKey = "conclusion";

/**
 * The pages the group holds: the steps after Source Documents and the lead
 * pages and before the Conclusion, in screen order (a step after the
 * Conclusion stays after it). Switched-off pages are not steps: they have a
 * list of their own.
 */
export function groupedPages(pages: readonly CapturePage[]): IncludedPage[] {
  const grouped: IncludedPage[] = [];
  for (const page of pages) {
    if (page.kind !== "included" || LEAD_PAGE_KEYS.includes(page.key)) continue;
    if (page.key === CONCLUSION_KEY) break;
    grouped.push(page);
  }
  return grouped;
}

type SectionListProps = {
  pages: readonly CapturePage[];
  /** The open page's key. */
  activeKey: string;
  onSelect: (key: string) => void;
  /** Whose choice to open or collapse the steps is kept on this device: the signed-in user. None, nothing is kept. */
  viewerId?: string;
  className?: string;
};

export function SectionList({ pages, activeKey, onSelect, viewerId, className }: SectionListProps) {
  const excluded = pages.filter((page) => page.kind === "excluded");
  const grouped = groupedPages(pages);
  // A header over a single step would only add a row.
  const grouping = grouped.length > 1;
  const [open, setOpen] = useStepGroup(
    viewerId ?? null,
    activeKey,
    grouping && grouped.some((page) => page.key === activeKey),
  );
  const group: ProgressGroup | undefined = grouping
    ? {
        label: STEP_GROUP_LABEL,
        keys: grouped.map((page) => page.key),
        // The worst of their results, as a page of two modules takes the worse of its two.
        result: stepIcon(pageStatus(grouped.flatMap((page) => page.sections))).status,
        resultLabel: stepIcon(pageStatus(grouped.flatMap((page) => page.sections))).label,
        open,
        onOpenChange: setOpen,
      }
    : undefined;
  return (
    <nav aria-label="Sections" data-slot="section-list" className={cn("space-y-5", className)}>
      <ProgressTracker
        variant="list"
        label="Sections, with progress and result"
        steps={progressSteps(pages)}
        activeKey={activeKey}
        onStepSelect={onSelect}
        group={group}
      />
      {excluded.length > 0 && (
        <div className="space-y-1.5">
          <h2 className="px-3.5 text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">
            Switched Off
          </h2>
          <ul className="space-y-0.5">
            {excluded.map((page) => {
              const active = page.key === activeKey;
              return (
                <li key={page.key} aria-current={active ? "step" : undefined}>
                  <button
                    type="button"
                    data-section={page.key}
                    title={page.title}
                    onClick={() => onSelect(page.key)}
                    className={cn(
                      "relative flex min-h-9 w-full items-center gap-2.5 rounded-md py-1.5 pr-2 pl-3.5 text-sm text-muted-foreground outline-none hover:bg-muted focus-ring-inset touch:min-h-11",
                      active && "bg-accent font-semibold text-accent-foreground hover:bg-accent",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "absolute inset-y-1.5 left-0 w-1 rounded-full",
                        active && "bg-linear-to-b from-brand-500 to-accent-600",
                      )}
                    />
                    <CircleOffIcon aria-hidden className="size-4 shrink-0 text-slate-500" />
                    <span className="line-clamp-2 min-w-0 flex-1 text-left leading-snug [overflow-wrap:anywhere]">
                      {page.shortTitle}
                    </span>
                    <span className="sr-only">, switched off for this inspection</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </nav>
  );
}
