import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Shown inside the shell while the gallery loads: its header and a section
 * of photo tiles, so the page does not jump when the photos arrive.
 */
export default function PhotosLoading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Loading photos…</span>
      <div aria-hidden className="space-y-3">
        <Bar className="h-3 w-32" />
        <Bar className="h-8 w-72 max-w-full" />
        <Bar className="h-4 w-96 max-w-full" />
      </div>
      {[6, 3].map((tiles, section) => (
        <div key={section} aria-hidden className="rounded-xl bg-card p-5 shadow-sm ring-1 ring-border md:p-6">
          <Bar className="h-5 w-48" />
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: tiles }, (_, tile) => (
              <div key={tile} className="overflow-hidden rounded-lg ring-1 ring-border">
                <Bar className="aspect-[4/3] w-full rounded-none" />
                <div className="space-y-2 p-3">
                  <Bar className="h-3 w-24" />
                  <Bar className="h-3 w-32" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Slate-200, not the default slate-100: placeholders must still read in factory light. */
function Bar({ className }: { className: string }) {
  return <Skeleton className={cn("bg-slate-200", className)} />;
}
