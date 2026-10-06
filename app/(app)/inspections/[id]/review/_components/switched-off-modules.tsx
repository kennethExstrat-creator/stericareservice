// Modules an admin switched off for this inspection, with the reason that is
// logged and exported (BUILD_SPEC 4.4). They have no result: capture,
// validation and the export leave them out.
import { CircleOffIcon } from "lucide-react";
import { actorText } from "@/lib/inspections/review/actor";
import { formatDateTime } from "@/lib/inspections/review/format";
import type { ReviewOverride } from "@/lib/inspections/review/load";
import { Panel, ReviewSection } from "./review-section";

export function SwitchedOffModules({ overrides }: { overrides: readonly ReviewOverride[] }) {
  if (overrides.length === 0) return null;
  return (
    <ReviewSection
      id="switched-off"
      title="Switched off for this inspection"
      description="These modules are left out of the results and the export."
    >
      <Panel>
        <ul className="divide-y divide-border">
          {overrides.map((override) => (
            <li key={override.key} data-module={override.key} className="flex gap-3 px-5 py-4">
              <CircleOffIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-slate-500" />
              <div className="min-w-0 space-y-1">
                <h3 className="text-base font-bold text-foreground">{override.title}</h3>
                <p className="text-base text-foreground [overflow-wrap:anywhere] fine:text-sm">
                  <span className="font-medium">Reason:</span> {override.reason}
                </p>
                <p className="text-sm text-muted-foreground">
                  Switched off by {actorText(override.by)} on{" "}
                  <time dateTime={override.at}>{formatDateTime(override.at)}</time>
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </ReviewSection>
  );
}
