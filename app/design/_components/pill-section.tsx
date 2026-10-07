import { ResultChip, SaveStatus, StatusPill } from "@/components/qc";
import { STATUSES, STATUS_LABEL } from "@/lib/design/status";
import { DesignSection, Specimen } from "./design-section";

const TABS = [
  { label: "Header", status: "info" },
  { label: "Glove Info", status: "info" },
  { label: "Packing", status: "warn" },
  { label: "Dimensions", status: "fail" },
  { label: "Watertight", status: "pass" },
  { label: "Visual", status: "not_done" },
] as const;

export function PillSection() {
  return (
    <DesignSection
      id="pills"
      description="StatusPill for results, ResultChip where space is tight (module tabs), SaveStatus in the capture header. Saving is never shown in status colours except Offline (amber), which will sync by itself, and Not Saved (red), which needs the inspector."
      source="app-specific (BUILD_SPEC 4.2 rule 7, 8)"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Specimen label="StatusPill">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((status) => (
                <StatusPill key={status} status={status} />
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((status) => (
                <StatusPill key={status} status={status} variant="solid" />
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((status) => (
                <StatusPill key={status} status={status} size="sm" />
              ))}
            </div>
          </div>
        </Specimen>

        <Specimen label="ResultChip in Module Tabs">
          <ul className="flex flex-wrap gap-2">
            {TABS.map(({ label, status }) => (
              <li
                key={label}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground touch:h-11"
              >
                {label}
                <ResultChip status={status} />
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted-foreground">
            Each chip reads its result to screen readers ({TABS.map(({ status }) => STATUS_LABEL[status]).join(", ")}).
          </p>
        </Specimen>

        <Specimen label="SaveStatus" className="lg:col-span-2">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <SaveStatus state="saved" />
            <SaveStatus state="saving" />
            <SaveStatus state="offline" />
            <SaveStatus state="offline" pendingUploads={3} />
            <SaveStatus state="saved" pendingUploads={1} />
            <SaveStatus state="error" />
            <SaveStatus state="error" pendingUploads={1} />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            The count is photos still in the upload queue; submit stays blocked until it reaches zero. Not Saved
            means saving needs the inspector (a change made on another device, a refused save, no copy kept on this
            device): the notice under the header says what happened and what to do.
          </p>
        </Specimen>
      </div>
    </DesignSection>
  );
}
