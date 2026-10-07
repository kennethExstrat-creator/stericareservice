import type { Database } from "@/lib/supabase/database.types";

type UserRole = Database["public"]["Enums"]["user_role"];

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
 * (inspection-table.tsx).
 */
const COLUMNS: readonly InspectionColumn[] = [
  { key: "ref", label: "Ref" },
  { key: "date", label: "Date" },
  { key: "client", label: "Client" },
  { key: "manufacturer", label: "Manufacturer" },
  { key: "product", label: "Product" },
  { key: "po", label: "PO" },
  { key: "status", label: "Status" },
  { key: "result", label: "Result" },
];

const INSPECTOR_COLUMN: InspectionColumn = { key: "inspector", label: "Inspector" };

/** Continue, Review or View, and Delete where it is allowed: always the last column. */
const ACTIONS_COLUMN: InspectionColumn = { key: "actions", label: "Actions", srOnlyLabel: true };

/**
 * The list's columns in order (BUILD_SPEC 10), the row actions last.
 * Inspectors only ever see their own inspections, so only admins get the
 * Inspector column.
 */
export function inspectionListColumns(role: UserRole): readonly InspectionColumn[] {
  return role === "admin" ? [...COLUMNS, INSPECTOR_COLUMN, ACTIONS_COLUMN] : [...COLUMNS, ACTIONS_COLUMN];
}
