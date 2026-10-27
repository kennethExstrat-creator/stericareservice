import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown inside the shell while the report is made: the print bar, then a
 * page at the paper's shape, so nothing jumps when the pages arrive.
 */
export default function ReportPrintLoading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Making the report…</span>
      <div aria-hidden className="flex items-center justify-between gap-4 rounded-xl bg-card px-5 py-4 shadow-sm ring-1 ring-border">
        <div className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-44 rounded-full" />
      </div>
      <div aria-hidden className="flex justify-center rounded-xl bg-slate-100 p-6">
        <Skeleton className="aspect-[210/297] w-full max-w-[210mm] rounded-none bg-white shadow-md" />
      </div>
    </div>
  );
}
