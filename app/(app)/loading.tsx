import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown inside the shell while an app page loads: the page header and a list
 * card, the shape most pages share, so the content does not jump in.
 */
export default function AppLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-8">
      <span className="sr-only">Loading…</span>
      <div aria-hidden className="space-y-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div aria-hidden className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border">
        <div className="flex items-center gap-4 border-b border-border px-5 py-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="ml-auto h-9 w-28 rounded-full touch:h-11" />
        </div>
        {Array.from({ length: 6 }, (_, row) => (
          <div key={row} className="flex items-center gap-6 border-b border-border px-5 py-4 last:border-0">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-4 w-24 md:block" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
