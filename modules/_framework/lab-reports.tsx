"use client";

// A step's lab reports on its page (tensile, force at break; docs/MODULES.md
// 10.1), in a frame of their own: one line with the template's word for the
// lab report ("Lab Reports" when several are linked), then each report
// Steri-AI linked from Source Documents, in size order, as "Size S · <file
// name>" with Steri-AI's mark, Preview and Unlink (the screen's file slot), or
// the name alone when its sizes are not known (Kenneth, 26 October 2026:
// "there are 4 different source", one lab report per size). Unlinking one
// leaves the others. None linked: one slot that says what Steri-AI found
// ("No lab report detected by Steri-AI."), or shows a lab report uploaded on
// the step before 12 October 2026, which counts without a link. The line
// carries calc's state and warnings, and the steps' issue links land on it.
import { AttachmentStatus } from "@/components/qc";
import type { ModuleKey } from "@/lib/schemas/module-result";
import { sizeLabel, type InspectionContext } from "./context";
import { ModuleFileSlot } from "./file-slot";
import { labReportSizesText, labReportsState, moduleFileState, sortLabReports, type LabReportEntry } from "./files";

export type LabReportsProps = {
  moduleKey: ModuleKey;
  /** The template's word for the step's lab report (labels.labReport), e.g. "Lab Report". */
  label: string;
  /** The step's lab reports (data.labReports). */
  reports: readonly LabReportEntry[];
  context: InspectionContext;
  /** Until one is attached the step is not done (tensile), and its not-done link lands here. */
  required?: boolean;
  /** calc's warnings about kept reports that are gone (lab_report_missing). */
  warnings: readonly string[];
  readOnly: boolean;
  /** Unlink: that report leaves the step's list, through useDataUpdater; the file stays. */
  onRemoved: (fileId: string) => void;
};

/** The line's heading: the template's word, in the plural for several reports ("Lab Reports"). */
export function labReportsHeading(label: string, count: number): string {
  const word = label.trim();
  return count > 1 && !/s$/i.test(word) ? `${word}s` : label;
}

export function LabReports({ moduleKey, label, reports, context, required = false, warnings, readOnly, onRemoved }: LabReportsProps) {
  const { state, reports: held } = labReportsState(context, moduleKey, reports);
  const listed = sortLabReports(held, context.templateSizes.map((size) => size.value));
  const heading = labReportsHeading(label, listed.length);
  // A lab report of the step no list keeps (uploaded on it before 12 October 2026) counts while no listed one is attached.
  const own = moduleFileState(context, { moduleKey, kind: "lab_report", fileId: null });
  const ownSlot = (
    <ModuleFileSlot
      moduleKey={moduleKey}
      kind="lab_report"
      fileId={null}
      state={own}
      countsModuleFiles
      readOnly={readOnly}
      onRemoved={onRemoved}
    />
  );
  return (
    // relative: screen-reader text inside never lays out against the page (docs/DESIGN.md).
    <section data-slot="lab-report" aria-label={heading} className="relative rounded-lg border border-border bg-card px-3 py-2">
      <AttachmentStatus label={heading} state={state} required={required} warning={warnings} issuePath={["labReport"]}>
        {listed.length === 0 ? (
          ownSlot
        ) : (
          <ul data-slot="lab-reports" className="flex min-w-0 flex-1 flex-col">
            {listed.map((report) => {
              const caption = labReportSizesText(report.sizes, (size) => sizeLabel(context, size));
              return (
                <li key={report.fileId} data-slot="lab-report-entry" data-file-id={report.fileId} className="min-w-0">
                  <ModuleFileSlot
                    moduleKey={moduleKey}
                    kind="lab_report"
                    fileId={report.fileId}
                    {...(caption === null ? {} : { caption })}
                    state={report.state}
                    readOnly={readOnly}
                    onRemoved={onRemoved}
                  />
                </li>
              );
            })}
            {own === "attached" && !listed.some((report) => report.state === "attached") && (
              <li data-slot="lab-report-entry" className="min-w-0">
                {ownSlot}
              </li>
            )}
          </ul>
        )}
      </AttachmentStatus>
    </section>
  );
}
