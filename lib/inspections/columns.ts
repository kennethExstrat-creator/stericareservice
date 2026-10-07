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
  /**
   * The narrowest layout with the column of its own. The columns fit side
   * by side only in the desktop layout (`xl`: 1280 px and a mouse or
   * trackpad). In the iPad layout (every touch screen, and narrower windows)
   * the PO shows under the ref, the product under the manufacturer, the
   * result under the status and the inspector's name under the date. Below
   * `lg` (iPad portrait) the date and the inspector's name join the ref too,
   * and the manufacturer and product the client. So every value shows on the
   * iPad, and the row actions keep their room.
   *
   * On the desktop rows stay one line, so a value without a column is not
   * in the list: admins' Inspector column takes the product's room on
   * desktops narrower than 1536 px (`2xl`), where nine columns and the
   * actions would cut every name to a few letters. The inspection itself
   * shows the product.
   */
  from?: "lg" | "xl" | "2xl";
  /** A heading for screen readers only: the buttons below it say what they do. */
  srOnlyLabel?: boolean;
};

const COLUMNS: readonly InspectionColumn[] = [
  { key: "ref", label: "Ref" },
  { key: "date", label: "Date", from: "lg" },
  { key: "client", label: "Client" },
  { key: "manufacturer", label: "Manufacturer", from: "lg" },
  { key: "product", label: "Product", from: "xl" },
  { key: "po", label: "PO", from: "xl" },
  { key: "status", label: "Status" },
  { key: "result", label: "Result", from: "xl" },
];

const INSPECTOR_COLUMN: InspectionColumn = { key: "inspector", label: "Inspector", from: "xl" };

/** Continue, Review or View, and Delete where it is allowed: always the last column. */
const ACTIONS_COLUMN: InspectionColumn = { key: "actions", label: "Actions", srOnlyLabel: true };

/**
 * The list's columns in order (BUILD_SPEC 10), the row actions last.
 * Inspectors only ever see their own inspections, so only admins get the
 * Inspector column; on narrower desktops it takes the product's room.
 */
export function inspectionListColumns(role: UserRole): readonly InspectionColumn[] {
  if (role !== "admin") return [...COLUMNS, ACTIONS_COLUMN];
  const columns = COLUMNS.map((column): InspectionColumn =>
    column.key === "product" ? { ...column, from: "2xl" } : column,
  );
  return [...columns, INSPECTOR_COLUMN, ACTIONS_COLUMN];
}
