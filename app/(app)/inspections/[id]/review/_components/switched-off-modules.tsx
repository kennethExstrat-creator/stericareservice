// Modules an admin switched off for this inspection, with the reason that is
// logged and exported (BUILD_SPEC 4.4). They have no result: capture,
// validation and the export leave them out. One line each.
import { CircleOffIcon } from "lucide-react";
import { actorText } from "@/lib/inspections/review/actor";
import { formatDateTime } from "@/lib/inspections/review/format";
import type { ReviewOverride } from "@/lib/inspections/review/load";
import { CardSection } from "./review-section";

export function SwitchedOffModules({ overrides }: { overrides: readonly ReviewOverride[] }) {
  if (overrides.length === 0) return null;
  return (
    <CardSection
      id="switched-off"
      title="Switched Off for This Inspection"
      aside={<span className="text-sm text-muted-foreground">{overrides.length}</span>}
    >
      <ul className="flex flex-col gap-2 px-5 pb-5">
        {overrides.map((override) => (
          <li key={override.key} data-module={override.key} className="flex gap-3 text-base fine:text-sm">
            <CircleOffIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-slate-500" />
            <p className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-semibold text-foreground">{override.title}</span>{" "}
              <span className="text-foreground">· Reason: {override.reason}</span>{" "}
              <span className="text-muted-foreground">
                · {actorText(override.by)} · <time dateTime={override.at}>{formatDateTime(override.at)}</time>
              </span>
            </p>
          </li>
        ))}
      </ul>
    </CardSection>
  );
}
