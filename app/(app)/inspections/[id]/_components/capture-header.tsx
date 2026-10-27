// The top of the capture screen, kept short (Kenneth: too much in it before):
// the reference number and workflow status, one line with the client and the
// manufacturer, and the page's actions (Photos, Review, on the iPad Issues and
// Submit, and Back to the list last, on the right). Below 1280 px the actions
// take their own row under the title, so touch-size buttons never squeeze it.
import type { ReactNode } from "react";
import { PageHeader } from "@/components/qc";
import type { InspectionStatus } from "@/lib/schemas/common";
import { InspectionStatusBadge } from "../../_components/inspection-status-badge";

export type CaptureHeading = {
  refNo: string;
  status: InspectionStatus;
  templateName: string;
  templateVersion: number;
  clientName: string | null;
  manufacturerLabel: string | null;
  /** The manufacturer without its factory (its brand, manufacturerBrand), for the header line. */
  manufacturerName?: string | null;
  inspectionDate: string;
  inspectorName: string;
};

export function CaptureHeader({ heading, actions }: { heading: CaptureHeading; actions?: ReactNode }) {
  // Who the inspection is for and where: the template, date and inspector are on the
  // sections themselves (header module) and in the list.
  const facts = [heading.clientName, heading.manufacturerName ?? heading.manufacturerLabel].filter(
    (fact): fact is string => Boolean(fact),
  );

  return (
    <PageHeader
      className="md:flex-col md:items-stretch xl:flex-row xl:items-end"
      title={
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="tabular-nums">{heading.refNo}</span>
          <InspectionStatusBadge status={heading.status} className="align-middle" />
        </span>
      }
      description={
        // The dot stays at the end of a line when the facts wrap, never at the start of the next.
        <p className="flex flex-wrap gap-x-2 text-sm touch:text-base">
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
