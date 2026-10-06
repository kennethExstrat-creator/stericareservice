import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Shown inside the shell while an inspection opens: the header, then the
 * section tabs and a form below 1280 px, or the section sidebar beside the
 * form from 1280 px, so nothing jumps when the screen arrives.
 */
export default function CaptureLoading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Opening the inspection…</span>
      <div aria-hidden className="space-y-3">
        <Bar className="h-3 w-48" />
        <Bar className="h-8 w-64 max-w-full" />
        <Bar className="h-4 w-96 max-w-full" />
      </div>
      <div aria-hidden className="flex flex-col gap-4 xl:grid xl:grid-cols-[16rem_minmax(0,1fr)] xl:items-start xl:gap-8">
        <div className="hidden space-y-3 rounded-xl bg-card p-3 shadow-sm ring-1 ring-border xl:block">
          <Bar className="h-7 w-24 rounded-full" />
          {Array.from({ length: 9 }, (_, row) => (
            <Bar key={row} className="h-6 w-full" />
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex gap-3 border-b border-border pb-3 xl:hidden">
            {Array.from({ length: 5 }, (_, tab) => (
              <Bar key={tab} className="h-6 w-28 shrink-0" />
            ))}
          </div>
          <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border">
            <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
              <Bar className="h-6 w-56" />
              <Bar className="h-7 w-24 rounded-full" />
            </div>
            <div className="grid gap-5 px-5 py-5 md:grid-cols-2">
              {Array.from({ length: 4 }, (_, field) => (
                <div key={field} className="space-y-2">
                  <Bar className="h-4 w-32" />
                  <Bar className="h-11 w-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Slate-200: placeholders must still read in factory light. */
function Bar({ className }: { className: string }) {
  return <Skeleton className={cn("bg-slate-200", className)} />;
}
