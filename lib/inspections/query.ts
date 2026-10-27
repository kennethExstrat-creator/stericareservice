import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seesTeamInspections } from "@/lib/auth/org";
import { InspectionStatusSchema, type InspectionResult, type InspectionStatus } from "@/lib/schemas/common";
import type { Database } from "@/lib/supabase/database.types";
import { todayInMalaysia } from "./create";
import { manufacturerLabel, personLabel } from "./format";
import { arrayLiteral, inspectionSearchFilter, quoteFilterValue } from "./postgrest";
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

/** Postgres: a column the query names does not exist. */
const UNDEFINED_COLUMN = "42703";

/** The migration that adds carton_numbers and lot_numbers_upper, which the full search needs. */
export const SEARCH_COLUMNS_MIGRATION = "20261007191137_inspection_search_columns.sql";

/** A box/carton number as it may be typed: a whole number, nine digits at most (a Postgres integer). */
const CARTON_NUMBER = /^\d{1,9}$/;

/**
 * The list search (BUILD_SPEC 10: "Search by ref, PO, lot or carton") as one
 * `.or()` filter. An inspection matches when its ref or PO contains the text
 * in any case, or one of its lot numbers is the whole text as typed or in
 * capitals (inspectionSearchFilter), or, with the search columns of
 * SEARCH_COLUMNS_MIGRATION:
 * - one of its lot numbers is the whole text in any case (lot_numbers_upper
 *   holds them in capitals: an iPad saves 'Lt081315' for LT081315);
 * - the text is a whole number and one of its sampled cartons has that
 *   number (carton_numbers; leading zeros are ignored).
 * Without them (`searchColumns` false), only the first part.
 */
export function listSearchFilter(text: string, searchColumns = true): string {
  const conditions = [inspectionSearchFilter(text)];
  if (searchColumns) {
    conditions.push(`lot_numbers_upper.ov.${quoteFilterValue(arrayLiteral([text.toUpperCase()]))}`);
    if (CARTON_NUMBER.test(text) && Number(text) >= 1) {
      conditions.push(`carton_numbers.cs.${quoteFilterValue(`{${Number(text)}}`)}`);
    }
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

/**
 * The list query with the filters applied, before ordering and paging: the
 * list's columns, or only the ids for a count (countInspections).
 */
function filteredQuery<Columns extends typeof INSPECTION_LIST_SELECT | "id">(
  supabase: Client,
  columns: Columns,
  filters: Omit<InspectionListFilters, "page">,
  head: boolean,
  searchColumns: boolean,
) {
  let query = supabase.from("inspections").select(columns, { count: "exact", head });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.client) query = query.eq("client_id", filters.client);
  if (filters.manufacturer) query = query.eq("manufacturer_id", filters.manufacturer);
  if (filters.q) query = query.or(listSearchFilter(filters.q, searchColumns));
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
 * On a project without SEARCH_COLUMNS_MIGRATION (Postgres answers 42703, no
 * such column) a search runs again without the search columns.
 */
export function listInspections(
  supabase: Client,
  filters: InspectionListFilters,
  reader: ListReader,
): Promise<InspectionListResult> {
  return listPage(supabase, filters, reader, true);
}

async function listPage(
  supabase: Client,
  filters: InspectionListFilters,
  reader: ListReader,
  searchColumns: boolean,
): Promise<InspectionListResult> {
  const from = (filters.page - 1) * PAGE_SIZE;
  const { data, error, count } = await filteredQuery(supabase, INSPECTION_LIST_SELECT, filters, false, searchColumns)
    .order("inspection_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (error) {
    if (searchColumns && filters.q && error.code === UNDEFINED_COLUMN) {
      // A project without the migration yet: search as before it, and say so.
      console.warn(
        `Inspections list: searching without box/carton numbers and lots in any case until ${SEARCH_COLUMNS_MIGRATION} is applied`,
        { code: error.code, message: error.message },
      );
      return listPage(supabase, filters, reader, false);
    }
    if (error.code !== RANGE_NOT_SATISFIABLE) {
      logFailure("list", error);
      return { kind: "error" };
    }
    return pastTheEnd(supabase, filters, searchColumns);
  }

  const total = count ?? data.length;
  if (data.length === 0 && total > 0) return { kind: "out-of-range", total };
  return { kind: "rows", rows: data.map((row) => toListRow(row, reader)), total };
}

/**
 * A stale or hand-made link past the last page: count what there is instead,
 * with the search the page query could run (a count's error has no code).
 */
async function pastTheEnd(
  supabase: Client,
  filters: InspectionListFilters,
  searchColumns: boolean,
): Promise<InspectionListResult> {
  const { error, count } = await filteredQuery(supabase, INSPECTION_LIST_SELECT, filters, true, searchColumns);
  if (error) {
    logFailure("count", error);
    return { kind: "error" };
  }
  const total = count ?? 0;
  return total > 0 ? { kind: "out-of-range", total } : { kind: "rows", rows: [], total: 0 };
}

/**
 * The counts above the list (inspection-metrics.tsx): inspections per
 * status, and those dated this month. Null where a count could not be read.
 */
export type InspectionCounts = {
  byStatus: Readonly<Record<InspectionStatus, number | null>>;
  /** Dated this month (Malaysia time), whatever their status. */
  thisMonth: number | null;
  /** That month's first day, YYYY-MM-DD. */
  month: string;
};

/** The first day of the month `day` (YYYY-MM-DD) falls in, and of the month after. */
export function monthOf(day: string): { from: string; to: string } {
  const [year, month] = day.split("-").map(Number);
  const first = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}-01`;
  return { from: first(year, month), to: month === 12 ? first(year + 1, 1) : first(year, month + 1) };
}

type CountFailure = { code?: string; message: string };
type CountAnswer = { count: number | null; error: CountFailure | null; status: number };

/**
 * A head-only count, built and read inside one try. Its error has no code or
 * message (a HEAD answer has no body), so the HTTP status stands in; an answer
 * without a count (a HEAD 404 reads as No Content) fails too.
 */
async function readCount(query: () => PromiseLike<CountAnswer>): Promise<number | CountFailure> {
  try {
    const { count, error, status } = await query();
    if (error) return { code: error.code, message: error.message || `HTTP ${status}` };
    return count ?? { message: `HTTP ${status} without a count` };
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error) };
  }
}

/** One count per status, in InspectionStatusSchema's order, then this month's. */
function readCounts(
  supabase: Client,
  filters: Pick<InspectionListFilters, "q" | "client" | "manufacturer">,
  month: { from: string; to: string },
  searchColumns: boolean,
): Promise<(number | CountFailure)[]> {
  const ids = (status?: InspectionStatus) => filteredQuery(supabase, "id", { ...filters, status }, true, searchColumns);
  return Promise.all([
    ...InspectionStatusSchema.options.map((status) => readCount(() => ids(status))),
    readCount(() => ids().gte("inspection_date", month.from).lt("inspection_date", month.to)),
  ]);
}

/**
 * How many inspections each status has, and how many are dated this month
 * (Malaysia time). They follow the search, client and manufacturer filters,
 * never the status filter or the page, so a status's count is what choosing
 * it lists. Head-only exact counts of ids: no row, and never an inspection's
 * data, is read. Never throws: a count that fails is null, and logged.
 */
export async function countInspections(
  supabase: Client,
  filters: InspectionListFilters,
  now: Date = new Date(),
): Promise<InspectionCounts> {
  const month = monthOf(todayInMalaysia(now));
  const { q, client, manufacturer } = filters;
  let reads = await readCounts(supabase, { q, client, manufacturer }, month, true);
  // With no error code to go by, a project without SEARCH_COLUMNS_MIGRATION
  // shows as every count with search text failing: count again without the
  // search columns, as the list then searches.
  if (q && reads.every((read) => typeof read !== "number")) {
    reads = await readCounts(supabase, { q, client, manufacturer }, month, false);
  }
  const failures = reads.filter((read) => typeof read !== "number");
  if (failures.length > 0) logFailure(`${failures.length} of ${reads.length} counts`, failures[0]);

  const counts = reads.map((read) => (typeof read === "number" ? read : null));
  const statuses = InspectionStatusSchema.options;
  return {
    byStatus: Object.fromEntries(statuses.map((status, index) => [status, counts[index]])) as Record<
      InspectionStatus,
      number | null
    >,
    thisMonth: counts[statuses.length],
    month: month.from,
  };
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
