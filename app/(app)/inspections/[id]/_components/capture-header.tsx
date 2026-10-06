// The top of the capture screen: the template's name, the reference number
// and workflow status, who and what the inspection is about, and the page's
// actions (Photos, Review, and on the iPad Issues and Submit).
import type { ReactNode } from "react";
import { PageHeader } from "@/components/qc";
import { formatInspectionDate } from "@/lib/inspections/format";
import type { InspectionStatus } from "@/lib/schemas/common";
import { InspectionStatusBadge } from "../../_components/inspection-status-badge";

export type CaptureHeading = {
  refNo: string;
  status: InspectionStatus;
  templateName: string;
  templateVersion: number;
  clientName: string | null;
  manufacturerLabel: string | null;
  inspectionDate: string;
  inspectorName: string;
};

export function CaptureHeader({ heading, actions }: { heading: CaptureHeading; actions?: ReactNode }) {
  const facts = [
    heading.clientName,
    heading.manufacturerLabel,
    formatInspectionDate(heading.inspectionDate),
    heading.inspectorName,
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <PageHeader
      eyebrow={`${heading.templateName} · v${heading.templateVersion}`}
      title={
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="tabular-nums">{heading.refNo}</span>
          <InspectionStatusBadge status={heading.status} className="align-middle" />
        </span>
      }
      description={
        // The dot stays at the end of a line when the facts wrap, never at the start of the next.
        <p className="flex flex-wrap gap-x-2 text-base">
          {facts.map((fact, index) => (
            <span key={`${index}-${fact}`}>
              {fact}
              {index < facts.length - 1 && (
                <span aria-hidden className="ml-2">
                  ·
                </span>
              )}
            </span>
          ))}
        </p>
      }
      actions={actions}
    />
  );
}
