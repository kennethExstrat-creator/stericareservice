"use client";

// The Report page's one line about Steri-AI describing the report's photos
// in the background (docs/AI.md, "Describing photos"; Kenneth, 27 October
// 2026, a lean screen): "Steri-AI is describing 4 photos…" while it runs,
// then nothing, the preview having followed; a failure in a short line with
// Try Again. A live region there from the start, so each change is read out.
import { RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import type { DescribeRunState } from "@/components/capture/photos";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { describingLine } from "@/lib/inspections/photos/descriptions";

export function PhotoDescribeStatus({ state, retry }: { state: DescribeRunState; retry: () => void }) {
  return (
    <div role="status" data-slot="photo-describe-status" className="empty:hidden">
      {state.status === "describing" && (
        <p className="flex items-center gap-2 text-sm text-brand-700 touch:text-base">
          <Spinner aria-hidden />
          {describingLine(state.count)}
        </p>
      )}
      {state.status === "failed" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-warn-border bg-warn-tint px-3 py-2 text-sm text-warn touch:text-base">
          <TriangleAlertIcon aria-hidden className="size-4 shrink-0" />
          <p className="min-w-0 flex-1">{state.message}</p>
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            <RotateCwIcon aria-hidden />
            Try Again
          </Button>
        </div>
      )}
    </div>
  );
}
