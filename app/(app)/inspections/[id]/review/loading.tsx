import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Shown inside the shell while the review loads, in the review's own shape
 * (layout A), so nothing jumps when it arrives: the back link, the header
 * card, the page index on the desktop, the verdict card and a few module
 * rows.
 */
export default function ReviewLoading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading the review…</span>
      <Bar className="h-4 w-28" />
      <div aria-hidden className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-card px-5 py-4 shadow-sm ring-1 ring-border">
        <div className="space-y-2">
          <Bar className="h-7 w-56" />
          <Bar className="h-4 w-72 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Bar className="h-9 w-36 rounded-full" />
          <Bar className="h-9 w-28 rounded-full" />
        </div>
      </div>
      <div aria-hidden className="flex flex-col gap-5 pt-1 xl:grid xl:grid-cols-[11.5rem_minmax(0,1fr)] xl:items-start xl:gap-8">
        <div className="hidden space-y-2 xl:block">
          {Array.from({ length: 7 }, (_, index) => (
            <Bar key={index} className="h-6 w-full" />
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <div className="grid gap-4 rounded-xl bg-card p-5 shadow-sm ring-1 ring-border md:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="space-y-3">
                <Bar className="h-3 w-24" />
                <Bar className="h-8 w-28 rounded-full" />
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border">
            {Array.from({ length: 6 }, (_, row) => (
              <div key={row} className="flex items-center gap-6 border-b border-border px-5 py-4 last:border-0">
                <Bar className="h-4 w-56" />
                <Bar className="ml-auto h-6 w-20 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Slate-200, not the default slate-100: placeholders must still read in factory light. */
function Bar({ className }: { className: string }) {
  return <Skeleton className={cn("bg-slate-200", className)} />;
}
