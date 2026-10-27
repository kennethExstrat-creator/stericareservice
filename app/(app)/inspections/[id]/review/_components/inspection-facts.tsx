// The header facts: what was inspected, for whom, by whom and when, and the
// exact template version the results come from. When it was submitted or
// approved is in the page's header, beside its status.
import type { ReactNode } from "react";
import { formatInspectionDate } from "@/lib/inspections/format";
import { actorText } from "@/lib/inspections/review/actor";
import type { ReviewInspection, ReviewTemplate } from "@/lib/inspections/review/load";
import { CardSection, Missing } from "./review-section";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-base font-medium text-foreground [overflow-wrap:anywhere] fine:text-sm">{children}</dd>
    </div>
  );
}

export function InspectionFacts({
  inspection,
  template,
}: {
  inspection: ReviewInspection;
  template: ReviewTemplate | null;
}) {
  return (
    <CardSection id="details" title="Inspection Details">
      <dl data-slot="inspection-facts" className="grid gap-x-8 gap-y-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <Fact label="Client">{inspection.client ?? <Missing label="No Client" />}</Fact>
        <Fact label="Manufacturer">{inspection.manufacturer ?? <Missing label="No manufacturer" />}</Fact>
        <Fact label="PO">{inspection.poNo ?? <Missing label="No PO yet" />}</Fact>
        <Fact label="Product">{inspection.productName ?? <Missing label="No product yet" />}</Fact>
        <Fact label="Lot Numbers">
          {inspection.lotNumbers.length > 0 ? inspection.lotNumbers.join(", ") : <Missing label="No lot numbers yet" />}
        </Fact>
        <Fact label="Inspector">{inspection.inspector.name}</Fact>
        <Fact label="Inspection Date">
          <time dateTime={inspection.inspectionDate}>{formatInspectionDate(inspection.inspectionDate)}</time>
        </Fact>
        <Fact label="Template">
          {template ? (
            <span title={template.name ?? undefined}>
              {template.code} Version {template.version}
            </span>
          ) : (
            <Missing label="Template not readable" />
          )}
        </Fact>
        {inspection.status === "approved" && inspection.approver && (
          <Fact label="Approved By">{actorText(inspection.approver, { start: true })}</Fact>
        )}
      </dl>
    </CardSection>
  );
}
