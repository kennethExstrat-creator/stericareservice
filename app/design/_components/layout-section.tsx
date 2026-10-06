import { CameraIcon } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ProgressTracker, ResultChip, SaveStatus } from "@/components/qc";
import { cn } from "@/lib/utils";
import { DesignSection } from "./design-section";
import { MODULE_STEPS } from "./inspection-modules";

const ACTIVE = "dimensions";

/** Grey bars standing in for a grid, so the mock stays small. */
function GridPlaceholder({ columns }: { columns: number }) {
  return (
    <div aria-hidden className="overflow-hidden rounded-lg ring-1 ring-border">
      <div className="h-7 border-b border-border bg-slate-50" />
      {Array.from({ length: 6 }, (_, row) => (
        <div
          key={row}
          className="grid border-b border-border last:border-0"
          style={{ gridTemplateColumns: `2.5rem repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns + 1 }, (_, col) => (
            <div key={col} className="h-6 border-r border-border last:border-0">
              {col > 0 && row < 4 && <div className="mx-2 mt-2 ml-auto h-2 w-8 rounded-full bg-slate-200" />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function MockTopBar() {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5">
      <div className="flex items-center gap-3">
        <Logo variant="mark" className="h-7" />
        <span className="font-display text-sm font-bold text-foreground">INS-2026-0001</span>
      </div>
      <SaveStatus state="saved" />
    </div>
  );
}

export function LayoutSection() {
  return (
    <DesignSection
      id="layout"
      title="Layout rule"
      description={
        <>
          One responsive layout, no phone layout. Below 1280 px (iPad portrait and landscape) modules are a top tab bar
          and the grid runs full width. From 1280 px (desktop) modules move to a left sidebar, the grid widens and photos
          sit alongside. You are looking at the{" "}
          <strong className="font-semibold text-foreground">
            <span className="xl:hidden">iPad layout</span>
            <span className="hidden xl:inline">desktop layout</span>
          </strong>
          .
        </>
      }
      source="app-specific (BUILD_SPEC 8)"
    >
      {/* A picture of the layout: hidden from assistive tech, the description says it. */}
      <div aria-hidden className="overflow-hidden rounded-xl bg-mist shadow-sm ring-1 ring-border">
        {/* iPad: top tab bar */}
        <div className="xl:hidden">
          <MockTopBar />
          <div className="no-scrollbar relative flex gap-1 overflow-x-auto border-b border-border bg-card px-3">
            {MODULE_STEPS.map((step) => (
              <span
                key={step.key}
                className={cn(
                  "inline-flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap",
                  step.key === ACTIVE
                    ? "border-brand-500 font-semibold text-foreground"
                    : "border-transparent text-muted-foreground",
                )}
              >
                {step.label}
                {step.result && <ResultChip status={step.result} />}
              </span>
            ))}
          </div>
          <div className="space-y-3 p-4">
            <ProgressTracker steps={MODULE_STEPS} activeKey={ACTIVE} />
            <div className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-border">
              <p className="mb-3 font-display text-sm font-bold text-foreground">Dimension - Size M</p>
              <GridPlaceholder columns={5} />
            </div>
          </div>
        </div>

        {/* Desktop: left sidebar, photos alongside */}
        <div className="hidden xl:block">
          <MockTopBar />
          <div className="grid grid-cols-[18rem_minmax(0,1fr)_14rem]">
            <div className="border-r border-border bg-card p-3">
              <ProgressTracker variant="list" steps={MODULE_STEPS} activeKey={ACTIVE} />
            </div>
            <div className="p-5">
              <div className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-border">
                <p className="mb-3 font-display text-sm font-bold text-foreground">Dimension - Size M</p>
                <GridPlaceholder columns={5} />
              </div>
            </div>
            <div className="space-y-3 border-l border-border p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <CameraIcon aria-hidden className="size-4" />
                Photos
              </p>
              {["/design/photo-glove.svg", "/design/photo-defect.svg"].map((src) => (
                <div
                  key={src}
                  aria-hidden
                  className="aspect-[4/3] rounded-lg bg-cover bg-center ring-1 ring-border"
                  style={{ backgroundImage: `url(${src})` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </DesignSection>
  );
}
