import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seesTeamInspections } from "@/lib/auth/org";
import type { InspectionResult, InspectionStatus } from "@/lib/schemas/common";
import type { Database } from "@/lib/supabase/database.types";
import { manufacturerLabel, personLabel } from "./format";
import { inspectionSearchFilter } from "./postgrest";
import { PAGE_SIZE, type FilterOption, type InspectionListFilters } from "./search-params";

/**
 * Reads for the inspections list. Always called with the signed-in user's
 * client (lib/supabase/server), never the admin client: Row Level Security
 * decides whose inspections come back (inspectors their own, lead inspectors
 * their own and their team's, admins all).
 */

type Client = SupabaseClient<Database>;
type UserRole = Database["public"]["Enums"]["user_role"];
/** Who reads the list: only the shape of the rows depends on it. */
type ListReader = { role: UserRole; isLead?: boolean };

/**
 * The list's columns plus the client, manufacturer and inspector names, and
 * the inspector's id for the row actions (who may continue or delete). The
 * inspector embed names its foreign key because approved_by also points at
 * profiles.
 */
export const INSPECTION_LIST_SELECT =
  "id, ref_no, inspection_date, po_no, product_name, status, result, inspector_id, client:clients(name), manufacturer:manufacturers(name, factory_name), inspector:profiles!inspections_inspector_id_fkey(full_name, email)";

/** PostgREST's answer to a page past the last row. */
const RANGE_NOT_SATISFIABLE = "PGRST103";

type ListQueryRow = {
  id: string;
  ref_no: string;
  inspection_date: string;
  po_no: string | null;
  product_name: string | null;
  status: InspectionStatus;
  result: InspectionResult | null;
  inspector_id: string;
  client: { name: string } | null;
  manufacturer: { name: string; factory_name: string | null } | null;
  inspector: { full_name: string | null; email: string | null } | null;
};

/** One row of the list, with only what the screen shows. */
export type InspectionListRow = {
  id: string;
  refNo: string;
  inspectionDate: string;
  client: string | null;
  manufacturer: string | null;
  product: string | null;
  po: string | null;
  status: InspectionStatus;
  result: InspectionResult | null;
  /** Whose inspection it is: the row actions compare it with the signed-in user. */
  inspectorId: string;
  /** Who is in charge of it, for admins and lead inspectors; null for inspectors, who only see their own. */
  inspector: string | null;
};

export type InspectionListResult =
  | { kind: "rows"; rows: InspectionListRow[]; total: number }
  /** The page asked for is past the last one; `total` rows exist. */
  | { kind: "out-of-range"; total: number }
  | { kind: "error" };

function logFailure(what: string, error: { code?: string; message: string }) {
  console.error(`Inspections list: ${what} failed`, { code: error.code, message: error.message });
}

/** The list query with the filters applied, before ordering and paging. */
function filteredQuery(supabase: Client, filters: InspectionListFilters, head: boolean) {
  let query = supabase.from("inspections").select(INSPECTION_LIST_SELECT, { count: "exact", head });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.client) query = query.eq("client_id", filters.client);
  if (filters.manufacturer) query = query.eq("manufacturer_id", filters.manufacturer);
  if (filters.q) query = query.or(inspectionSearchFilter(filters.q));
  return query;
}

export function toListRow(row: ListQueryRow, reader: ListReader): InspectionListRow {
  return {
    id: row.id,
    refNo: row.ref_no,
    inspectionDate: row.inspection_date,
    client: row.client?.name ?? null,
    manufacturer: row.manufacturer ? manufacturerLabel(row.manufacturer) : null,
    product: row.product_name,
    po: row.po_no,
    status: row.status,
    result: row.result,
    inspectorId: row.inspector_id,
    inspector: seesTeamInspections(reader) ? personLabel(row.inspector) : null,
  };
}

/**
 * One page of inspections, newest first (inspection date, then creation), with
 * the total for the filters. `reader` only shapes the rows; RLS does the scoping.
 */
export async function listInspections(
  supabase: Client,
  filters: InspectionListFilters,
  reader: ListReader,
): Promise<InspectionListResult> {
  const from = (filters.page - 1) * PAGE_SIZE;
  const { data, error, count } = await filteredQuery(supabase, filters, false)
    .order("inspection_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (error) {
    if (error.code !== RANGE_NOT_SATISFIABLE) {
      logFailure("list", error);
      return { kind: "error" };
    }
    return pastTheEnd(supabase, filters);
  }

  const total = count ?? data.length;
  if (data.length === 0 && total > 0) return { kind: "out-of-range", total };
  return { kind: "rows", rows: data.map((row) => toListRow(row, reader)), total };
}

/** A stale or hand-made link past the last page: count what there is instead. */
async function pastTheEnd(supabase: Client, filters: InspectionListFilters): Promise<InspectionListResult> {
  const { error, count } = await filteredQuery(supabase, filters, true);
  if (error) {
    logFailure("count", error);
    return { kind: "error" };
  }
  const total = count ?? 0;
  return total > 0 ? { kind: "out-of-range", total } : { kind: "rows", rows: [], total: 0 };
}

export type FilterOptionsResult =
  | { ok: true; clients: FilterOption[]; manufacturers: FilterOption[] }
  | { ok: false };

/** Every client and manufacturer, by name, for the filter bar. */
export async function loadFilterOptions(supabase: Client): Promise<FilterOptionsResult> {
  const [clients, manufacturers] = await Promise.all([
    supabase.from("clients").select("id, name").order("name"),
    supabase
      .from("manufacturers")
      .select("id, name, factory_name")
      .order("name")
      .order("factory_name", { nullsFirst: true }),
  ]);
  if (clients.error) {
    logFailure("clients", clients.error);
    return { ok: false };
  }
  if (manufacturers.error) {
    logFailure("manufacturers", manufacturers.error);
    return { ok: false };
  }
  return {
    ok: true,
    clients: clients.data.map((client) => ({ id: client.id, label: client.name })),
    manufacturers: manufacturers.data.map((manufacturer) => ({
      id: manufacturer.id,
      label: manufacturerLabel(manufacturer),
    })),
  };
}
