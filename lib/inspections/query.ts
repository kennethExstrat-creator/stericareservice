import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seesTeamInspections } from "@/lib/auth/org";
import type { InspectionResult, InspectionStatus } from "@/lib/schemas/common";
import type { Database } from "@/lib/supabase/database.types";
import { manufacturerLabel, personLabel } from "./format";
import { summedResult, summedStatus } from "./part-summary";
import type { InspectionPart } from "./parts";
import { arrayLiteral, inspectionSearchFilter, quoteFilterValue } from "./postgrest";
import { PAGE_SIZE, type FilterOption, type InspectionListFilters } from "./search-params";

/**
 * Reads for the inspections list. Always called with the signed-in user's
 * client (lib/supabase/server), never the admin client: Row Level Security
 * decides whose inspections come back (inspectors their own, lead inspectors
 * their own and their team's, admins all).
 *
 * One row per inspection (PO parts, lib/inspections/parts.ts): the list pages
 * through first parts only (group_id null), so paging and counts count
 * inspections, then reads the other parts of the inspections on the page.
 * The search and the status filter read every part, through the computed
 * columns of PARTS_COLUMNS_MIGRATION.
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

/** The other parts of the inspections on a page: what their row shows of each PO. */
export const PART_LIST_SELECT = "id, group_id, ref_no, po_no, product_name, status, result";

/** PostgREST's answer to a page past the last row. */
const RANGE_NOT_SATISFIABLE = "PGRST103";

/** Postgres: a column the query names does not exist. */
const UNDEFINED_COLUMN = "42703";

/** The migration that adds carton_numbers and lot_numbers_upper, which the full search needs. */
export const SEARCH_COLUMNS_MIGRATION = "20261007191137_inspection_search_columns.sql";

/**
 * The migration that adds the parts_* computed columns (functions of an
 * inspections row, which PostgREST reads as columns of it): the search and
 * the status filter by every part of an inspection.
 */
export const PARTS_COLUMNS_MIGRATION = "20261011150400_inspection_list_parts.sql";

/**
 * What the search and the status filter read: every part of the inspection
 * ("parts", PARTS_COLUMNS_MIGRATION), its first part with the search columns
 * ("search", SEARCH_COLUMNS_MIGRATION), or its first part as before both
 * ("plain"). A project without a migration gets the next one down.
 */
export type ListColumns = "parts" | "search" | "plain";

/** The search's columns: the first part's own, or every part's, the same names with `parts_` in front. */
const SEARCH_COLUMNS = {
  search: {
    ref: "ref_no",
    po: "po_no",
    lots: "lot_numbers",
    lotsUpper: "lot_numbers_upper",
    cartons: "carton_numbers",
  },
  parts: {
    ref: "parts_ref_nos",
    po: "parts_po_nos",
    lots: "parts_lot_numbers",
    lotsUpper: "parts_lot_numbers_upper",
    cartons: "parts_carton_numbers",
  },
} as const;

/** The inspection's status: the least advanced of its parts' (public.parts_status()). */
const PARTS_STATUS = "parts_status";

/** A carton number as it may be typed: a whole number, nine digits at most (a Postgres integer). */
const CARTON_NUMBER = /^\d{1,9}$/;

/**
 * The list search (BUILD_SPEC 10: "Search by ref, PO, lot or carton") as one
 * `.or()` filter. An inspection matches when one of its parts does: the
 * part's ref or PO contains the text in any case, or one of its lot numbers
 * is the whole text as typed or in capitals (inspectionSearchFilter) or in
 * any case (lot_numbers_upper holds them in capitals: an iPad saves
 * 'Lt081315' for LT081315), or the text is a whole number and one of its
 * sampled cartons has that number (carton_numbers; leading zeros are
 * ignored). With `columns` "search" only the first part counts, and with
 * "plain" only by its ref, PO and lots as typed or in capitals.
 */
export function listSearchFilter(text: string, columns: ListColumns = "parts"): string {
  if (columns === "plain") return inspectionSearchFilter(text);
  const names = SEARCH_COLUMNS[columns];
  const conditions = [
    inspectionSearchFilter(text, names),
    `${names.lotsUpper}.ov.${quoteFilterValue(arrayLiteral([text.toUpperCase()]))}`,
  ];
  if (CARTON_NUMBER.test(text) && Number(text) >= 1) {
    conditions.push(`${names.cartons}.cs.${quoteFilterValue(`{${Number(text)}}`)}`);
  }
  return conditions.join(",");
}

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

type PartQueryRow = {
  id: string;
  group_id: string | null;
  ref_no: string;
  po_no: string | null;
  product_name: string | null;
  status: InspectionStatus;
  result: InspectionResult | null;
};

/** One PO of a row (lib/inspections/parts.ts), with its own status and result. */
export type InspectionListPart = Pick<InspectionPart, "id" | "refNo" | "poNo" | "productName" | "status"> & {
  result: InspectionResult | null;
};

/** One row of the list, one inspection, with only what the screen shows. */
export type InspectionListRow = {
  /** The first part's: the row opens the first part. */
  id: string;
  /** The inspection's reference number: the first part's. */
  refNo: string;
  inspectionDate: string;
  client: string | null;
  manufacturer: string | null;
  /** The first part's product and PO; `parts` holds every PO's. */
  product: string | null;
  po: string | null;
  /** The inspection's status: its parts' when they agree, else the least advanced (`statusMixed`). */
  status: InspectionStatus;
  statusMixed: boolean;
  /** The inspection's result: its parts' when they agree, else the worst (`resultMixed`). */
  result: InspectionResult | null;
  resultMixed: boolean;
  /** Whose inspection it is: the row actions compare it with the signed-in user. */
  inspectorId: string;
  /** Who is in charge of it, for admins and lead inspectors; null for inspectors, who only see their own. */
  inspector: string | null;
  /** Every part, the first part first: one for an inspection of one PO. */
  parts: InspectionListPart[];
};

export type InspectionListResult =
  | { kind: "rows"; rows: InspectionListRow[]; total: number }
  /** The page asked for is past the last one; `total` inspections exist. */
  | { kind: "out-of-range"; total: number }
  | { kind: "error" };

function logFailure(what: string, error: { code?: string; message: string }) {
  console.error(`Inspections list: ${what} failed`, { code: error.code, message: error.message });
}

/** The list query with the filters applied, before ordering and paging: first parts only, one per inspection. */
function filteredQuery(supabase: Client, filters: InspectionListFilters, head: boolean, columns: ListColumns) {
  let query = supabase.from("inspections").select(INSPECTION_LIST_SELECT, { count: "exact", head }).is("group_id", null);
  if (filters.status) {
    query = columns === "parts" ? query.filter(PARTS_STATUS, "eq", filters.status) : query.eq("status", filters.status);
  }
  if (filters.client) query = query.eq("client_id", filters.client);
  if (filters.manufacturer) query = query.eq("manufacturer_id", filters.manufacturer);
  if (filters.q) query = query.or(listSearchFilter(filters.q, columns));
  return query;
}

/**
 * What to read instead when Postgres says a column the query names does not
 * exist (42703), with the warning that says which migration is missing; null
 * when the query reads none of the columns a migration adds.
 */
function fallback(columns: ListColumns, filters: InspectionListFilters): { columns: ListColumns; warning: string } | null {
  if (columns === "parts" && (filters.q || filters.status)) {
    return {
      columns: "search",
      warning: `Inspections list: searching and filtering by each inspection's first part only until ${PARTS_COLUMNS_MIGRATION} is applied`,
    };
  }
  if (columns === "search" && filters.q) {
    return {
      columns: "plain",
      warning: `Inspections list: searching without carton numbers and lots in any case until ${SEARCH_COLUMNS_MIGRATION} is applied`,
    };
  }
  return null;
}

function listPart(part: Omit<PartQueryRow, "group_id">): InspectionListPart {
  return {
    id: part.id,
    refNo: part.ref_no,
    poNo: part.po_no,
    productName: part.product_name,
    status: part.status,
    result: part.result,
  };
}

/** A first part and the other parts of its inspection (oldest first) as one row. */
export function toListRow(row: ListQueryRow, reader: ListReader, others: readonly PartQueryRow[] = []): InspectionListRow {
  const parts = [row, ...others].map(listPart);
  const status = summedStatus(parts.map((part) => part.status));
  const result = summedResult(parts.map((part) => part.result));
  return {
    id: row.id,
    refNo: row.ref_no,
    inspectionDate: row.inspection_date,
    client: row.client?.name ?? null,
    manufacturer: row.manufacturer ? manufacturerLabel(row.manufacturer) : null,
    product: row.product_name,
    po: row.po_no,
    status: status.value,
    statusMixed: status.mixed,
    result: result.value,
    resultMixed: result.mixed,
    inspectorId: row.inspector_id,
    inspector: seesTeamInspections(reader) ? personLabel(row.inspector) : null,
    parts,
  };
}

/**
 * One page of inspections, newest first (inspection date, then creation), with
 * the total for the filters. `reader` only shapes the rows; RLS does the scoping.
 * On a project without PARTS_COLUMNS_MIGRATION or SEARCH_COLUMNS_MIGRATION
 * (Postgres answers 42703, no such column) the list reads again with what
 * the project has (fallback()).
 */
export function listInspections(
  supabase: Client,
  filters: InspectionListFilters,
  reader: ListReader,
): Promise<InspectionListResult> {
  return listPage(supabase, filters, reader, "parts");
}

async function listPage(
  supabase: Client,
  filters: InspectionListFilters,
  reader: ListReader,
  columns: ListColumns,
): Promise<InspectionListResult> {
  const from = (filters.page - 1) * PAGE_SIZE;
  const { data, error, count } = await filteredQuery(supabase, filters, false, columns)
    .order("inspection_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (error) {
    const next = error.code === UNDEFINED_COLUMN ? fallback(columns, filters) : null;
    if (next) {
      // A project without the migration yet: read what it has, and say so.
      console.warn(next.warning, { code: error.code, message: error.message });
      return listPage(supabase, filters, reader, next.columns);
    }
    if (error.code !== RANGE_NOT_SATISFIABLE) {
      logFailure("list", error);
      return { kind: "error" };
    }
    return pastTheEnd(supabase, filters, columns);
  }

  const total = count ?? data.length;
  if (data.length === 0) return total > 0 ? { kind: "out-of-range", total } : { kind: "rows", rows: [], total: 0 };

  const others = await otherParts(supabase, data.map((row) => row.id));
  // Without its other parts a row would show one PO, and that part's status as the inspection's.
  if (!others) return { kind: "error" };
  return { kind: "rows", rows: data.map((row) => toListRow(row, reader, others.get(row.id))), total };
}

/**
 * The parts after the first of the inspections whose first parts are
 * `firstPartIds`, by first part, oldest first; null when they cannot be read.
 * Through the same client: a reader sees every part of an inspection or none
 * (a part is made for the inspection's own inspector, which never changes).
 */
async function otherParts(supabase: Client, firstPartIds: string[]): Promise<Map<string, PartQueryRow[]> | null> {
  const { data, error } = await supabase
    .from("inspections")
    .select(PART_LIST_SELECT)
    .in("group_id", firstPartIds)
    .order("created_at")
    .order("id");
  if (error) {
    logFailure("parts", error);
    return null;
  }
  const byInspection = new Map<string, PartQueryRow[]>();
  for (const part of data) {
    if (!part.group_id) continue;
    const parts = byInspection.get(part.group_id);
    if (parts) parts.push(part);
    else byInspection.set(part.group_id, [part]);
  }
  return byInspection;
}

/**
 * A stale or hand-made link past the last page: count what there is instead,
 * with the search the page query could run (a count's error has no code).
 */
async function pastTheEnd(
  supabase: Client,
  filters: InspectionListFilters,
  columns: ListColumns,
): Promise<InspectionListResult> {
  const { error, count } = await filteredQuery(supabase, filters, true, columns);
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
