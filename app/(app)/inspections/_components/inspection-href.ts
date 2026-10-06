// Where a row of the list opens its inspection. While it can still change
// (draft, reopened) that is the capture screen: its inspector and admins edit
// there. Once submitted or approved it is the review, which shows the results
// and, for admins, approve and reopen. The list only holds inspections the
// user may read (RLS), so the same rule serves inspectors and admins.
import { INSPECTIONS_PATH } from "@/lib/inspections/search-params";
import type { InspectionStatus } from "@/lib/schemas/common";

const OPENS_ON_CAPTURE: Readonly<Record<InspectionStatus, boolean>> = {
  draft: true,
  reopened: true,
  submitted: false,
  approved: false,
};

export function inspectionHref(id: string, status: InspectionStatus): string {
  const capture = `${INSPECTIONS_PATH}/${id}`;
  return OPENS_ON_CAPTURE[status] ? capture : `${capture}/review`;
}
