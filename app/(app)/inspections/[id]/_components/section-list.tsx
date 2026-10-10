"use client";

// The section list in the capture screen's sidebar from 1280 px (BUILD_SPEC
// 8: on desktop, modules show in a left sidebar). The included pages
// (lib/inspections/capture/sections.ts capturePages: packing configuration
// on the order's) are the ProgressTracker's list, each with its progress and
// result chip; the sections an admin switched off for this inspection follow
// in their own group, marked off.
import { CircleOffIcon } from "lucide-react";
import { ProgressTracker } from "@/components/qc";
import { progressSteps, type CapturePage } from "@/lib/inspections/capture/sections";
import { cn } from "@/lib/utils";

type SectionListProps = {
  pages: readonly CapturePage[];
  /** The open page's key. */
  activeKey: string;
  onSelect: (key: string) => void;
  className?: string;
};

export function SectionList({ pages, activeKey, onSelect, className }: SectionListProps) {
  const excluded = pages.filter((page) => page.kind === "excluded");
  return (
    <nav aria-label="Sections" data-slot="section-list" className={cn("space-y-5", className)}>
      <ProgressTracker
        variant="list"
        label="Sections, with progress and result"
        steps={progressSteps(pages)}
        activeKey={activeKey}
        onStepSelect={onSelect}
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
                      {page.title}
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
