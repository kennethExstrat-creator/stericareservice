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
  | "inspector";

export type InspectionColumn = {
  key: InspectionColumnKey;
  label: string;
  /**
   * The narrowest layout with the column of its own; nine columns only fit
   * side by side on a desktop. Below `xl` (the iPad) the inspector's name
   * shows under the date and the product under the manufacturer. Below `lg`
   * (iPad portrait) the PO shows under the ref, and the manufacturer and
   * product under the client. Every value stays on screen at every size.
   */
  from?: "lg" | "xl";
};

const COLUMNS: readonly InspectionColumn[] = [
  { key: "ref", label: "Ref" },
  { key: "date", label: "Date" },
  { key: "client", label: "Client" },
  { key: "manufacturer", label: "Manufacturer", from: "lg" },
  { key: "product", label: "Product", from: "xl" },
  { key: "po", label: "PO", from: "lg" },
  { key: "status", label: "Status" },
  { key: "result", label: "Result" },
];

const INSPECTOR_COLUMN: InspectionColumn = { key: "inspector", label: "Inspector", from: "xl" };

/**
 * The list's columns in order (BUILD_SPEC 10). Inspectors only ever see
 * their own inspections, so only admins get the Inspector column.
 */
export function inspectionListColumns(role: UserRole): readonly InspectionColumn[] {
  return role === "admin" ? [...COLUMNS, INSPECTOR_COLUMN] : COLUMNS;
}
