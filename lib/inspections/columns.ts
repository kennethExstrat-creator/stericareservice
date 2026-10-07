import { INSPECTOR_IN_CHARGE, seesTeamInspections, type UserRole } from "@/lib/auth/org";

export type InspectionColumnKey =
  | "ref"
  | "date"
  | "client"
  | "manufacturer"
  | "product"
  | "po"
  | "status"
  | "result"
  | "inspector"
  | "actions";

export type InspectionColumn = {
  key: InspectionColumnKey;
  label: string;
  /** A heading for screen readers only: the buttons below it say what they do. */
  srOnlyLabel?: boolean;
};

/**
 * Every column shows at every size, one line per row: when they do not fit,
 * the list scrolls sideways with the ref and the actions pinned
 * (inspection-table.tsx). Status and result come straight after the ref, so
 * they show without a sideways scroll at every size: they are what people
 * scan the list for. The longer names follow and run past the card's edge.
 */
const COLUMNS: readonly InspectionColumn[] = [
  { key: "ref", label: "Ref" },
  { key: "status", label: "Status" },
  { key: "result", label: "Result" },
  { key: "date", label: "Date" },
  { key: "client", label: "Client" },
  { key: "manufacturer", label: "Manufacturer" },
  { key: "product", label: "Product" },
  { key: "po", label: "PO" },
];

/** Who carried each inspection out: for admins and lead inspectors, who see other people's. */
const INSPECTOR_COLUMN: InspectionColumn = { key: "inspector", label: INSPECTOR_IN_CHARGE };

/** Continue, Review or View, and Delete where it is allowed: always the last column. */
const ACTIONS_COLUMN: InspectionColumn = { key: "actions", label: "Actions", srOnlyLabel: true };

/**
 * The list's columns in order (BUILD_SPEC 10), the row actions last.
 * Inspectors only ever see their own inspections, so only admins and lead
 * inspectors (who see their team's) get the Inspector in Charge column.
 */
export function inspectionListColumns(viewer: { role: UserRole; isLead?: boolean }): readonly InspectionColumn[] {
  return seesTeamInspections(viewer) ? [...COLUMNS, INSPECTOR_COLUMN, ACTIONS_COLUMN] : [...COLUMNS, ACTIONS_COLUMN];
}
