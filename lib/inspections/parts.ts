// PO parts (docs/DATABASE.md, "PO parts"; Kenneth, 11 October 2026): one
// inspection can cover several purchase orders. Each PO is a part, an
// inspections row of its own (its PO, lots, sizes, sampling, tests and
// result); the first part (group_id null) stands for the inspection and every
// other part names it in group_id. The parts share Source Documents, are
// submitted, approved and reopened together, and go out in one report.
// Client-safe: the shapes and the words; parts-server.ts reads and creates.
import type { InspectionStatus } from "@/lib/schemas/common";

/** One part of an inspection, as the screens show it. */
export type InspectionPart = {
  id: string;
  refNo: string;
  /** The header's PO / SO number, as the row repeats it (po_no). */
  poNo: string | null;
  productName: string | null;
  status: InspectionStatus;
  /** The first part: it stands for the inspection (its reference number is the inspection's). */
  primary: boolean;
};

/** The inspection a row belongs to: the first part's id. */
export function groupIdOf(row: { id: string; group_id: string | null }): string {
  return row.group_id ?? row.id;
}

/** "PO 2680276 (5400053153)", "PO-0001 (SO-0001)" as typed, or "PO 2" while the part has no PO number yet. */
export function partLabel(part: Pick<InspectionPart, "poNo">, index: number): string {
  const po = part.poNo?.trim();
  if (!po) return `PO ${index + 1}`;
  return /^P\.?O\b/i.test(po) ? po : `PO ${po}`;
}

/** The inspection's reference number: the first part's. */
export function groupRefNo(parts: readonly InspectionPart[]): string | null {
  return (parts.find((part) => part.primary) ?? parts[0])?.refNo ?? null;
}
