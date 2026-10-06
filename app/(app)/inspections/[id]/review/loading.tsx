import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Shown inside the shell while the review loads: the header, the status,
 * the facts and a few module rows, the review's own shape, so nothing jumps
 * when it arrives.
 */
export default function ReviewLoading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-8 md:gap-10">
      <span className="sr-only">Loading the review…</span>
      <div aria-hidden className="space-y-3">
        <Bar className="h-4 w-28" />
        <Bar className="h-3 w-36" />
        <Bar className="h-8 w-56" />
        <Bar className="h-6 w-72 max-w-full" />
      </div>
      <Bar className="h-24 w-full rounded-xl" />
      <div aria-hidden className="grid gap-x-8 gap-y-4 rounded-xl bg-card p-5 shadow-sm ring-1 ring-border sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="space-y-2">
            <Bar className="h-3 w-20" />
            <Bar className="h-4 w-40 max-w-full" />
          </div>
        ))}
      </div>
      <div aria-hidden className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border">
        {Array.from({ length: 5 }, (_, row) => (
          <div key={row} className="flex items-center gap-6 border-b border-border px-5 py-4 last:border-0">
            <Bar className="h-4 w-48" />
            <Bar className="h-6 w-20 rounded-full" />
            <Bar className="hidden h-4 flex-1 md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Slate-200, not the default slate-100: placeholders must still read in factory light. */
function Bar({ className }: { className: string }) {
  return <Skeleton className={cn("bg-slate-200", className)} />;
}
