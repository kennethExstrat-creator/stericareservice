// The header facts: what was inspected, for whom, by whom and when, and the
// exact template version the results come from.
import type { ReactNode } from "react";
import { formatInspectionDate } from "@/lib/inspections/format";
import { actorText } from "@/lib/inspections/review/actor";
import { formatDateTime } from "@/lib/inspections/review/format";
import type { ReviewInspection, ReviewTemplate } from "@/lib/inspections/review/load";
import { Missing, Panel } from "./review-section";

function Fact({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-base font-medium text-foreground [overflow-wrap:anywhere] fine:text-sm">{children}</dd>
    </div>
  );
}

function When({ iso }: { iso: string }) {
  return <time dateTime={iso}>{formatDateTime(iso)}</time>;
}

export function InspectionFacts({
  inspection,
  template,
}: {
  inspection: ReviewInspection;
  template: ReviewTemplate | null;
}) {
  return (
    <Panel>
      <dl data-slot="inspection-facts" className="grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <Fact label="Client">{inspection.client ?? <Missing label="No client" />}</Fact>
        <Fact label="Manufacturer">{inspection.manufacturer ?? <Missing label="No manufacturer" />}</Fact>
        <Fact label="PO">{inspection.poNo ?? <Missing label="No PO yet" />}</Fact>
        <Fact label="Product">{inspection.productName ?? <Missing label="No product yet" />}</Fact>
        <Fact label="Lot numbers">
          {inspection.lotNumbers.length > 0 ? inspection.lotNumbers.join(", ") : <Missing label="No lot numbers yet" />}
        </Fact>
        <Fact label="Inspector">{inspection.inspector.name}</Fact>
        <Fact label="Inspection date">
          <time dateTime={inspection.inspectionDate}>{formatInspectionDate(inspection.inspectionDate)}</time>
        </Fact>
        <Fact label="Submitted">
          {inspection.submittedAt ? <When iso={inspection.submittedAt} /> : <Missing label="Not submitted yet" />}
        </Fact>
        {inspection.status === "approved" && inspection.approvedAt && (
          <Fact label="Approved">
            <When iso={inspection.approvedAt} />
            {inspection.approver && (
              <span className="block font-normal text-muted-foreground">by {actorText(inspection.approver)}</span>
            )}
          </Fact>
        )}
        <Fact label="Template">
          {template ? (
            <>
              {template.code} version {template.version}
              {template.name && <span className="block font-normal text-muted-foreground">{template.name}</span>}
            </>
          ) : (
            <Missing label="Template not readable" />
          )}
        </Fact>
      </dl>
    </Panel>
  );
}
