import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInMalaysia } from "@/lib/inspections/create";
import { manufacturerLabel, personLabel } from "@/lib/inspections/format";
import type { Database } from "@/lib/supabase/database.types";
import { readFrom, summariseDashboard, type DashboardPeriod, type DashboardRow, type DashboardSummary } from "./dashboard";

/**
 * The admin dashboard's reads (lib/admin/dashboard.ts sums them up). Always
 * with the signed-in admin's own client: Row Level Security gives an admin
 * every inspection. Only the columns the dashboard counts by are read, never
 * an inspection's data. Neither function throws: a failed read is logged and
 * comes back as null, for the page to say so.
 */

type Client = SupabaseClient<Database>;

/** The inspections not yet approved, by status: what waits for an admin or an inspector. */
export type OpenCounts = { submitted: number; reopened: number; draft: number };

const OPEN_STATUSES = ["submitted", "reopened", "draft"] as const;

/** PostgREST answers at most this many rows at a time. */
const PAGE = 1000;
/** A stop well past any real count (100,000 inspections), so a fault can never loop. */
const MAX_PAGES = 100;

const ROW_SELECT =
  "id, inspection_date, status, result, inspector_id, client:clients(id, name), manufacturer:manufacturers(id, name, factory_name), inspector:profiles!inspections_inspector_id_fkey(full_name, email)";

function logFailure(what: string, error: { code?: string; message: string }) {
  console.error(`Admin dashboard: reading ${what} failed`, { code: error.code, message: error.message });
}

export async function loadOpenCounts(supabase: Client): Promise<OpenCounts | null> {
  const answers = await Promise.all(
    OPEN_STATUSES.map((status) =>
      supabase.from("inspections").select("id", { count: "exact", head: true }).eq("status", status),
    ),
  );
  const counts: Partial<OpenCounts> = {};
  for (const [index, { count, error }] of answers.entries()) {
    if (error || count === null) {
      if (error) logFailure("the open inspections", error);
      return null;
    }
    counts[OPEN_STATUSES[index]] = count;
  }
  return counts as OpenCounts;
}

/** Every inspection dated `from` or later (all of them for null), page by page. */
async function readRows(supabase: Client, from: string | null): Promise<DashboardRow[] | null> {
  const rows: DashboardRow[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let query = supabase
      .from("inspections")
      .select(ROW_SELECT)
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (from) query = query.gte("inspection_date", from);
    const { data, error } = await query;
    if (error) {
      logFailure("the inspections", error);
      return null;
    }
    for (const row of data) {
      rows.push({
        date: row.inspection_date,
        status: row.status,
        result: row.result,
        client: row.client ? { id: row.client.id, label: row.client.name } : null,
        manufacturer: row.manufacturer ? { id: row.manufacturer.id, label: manufacturerLabel(row.manufacturer) } : null,
        inspector: { id: row.inspector_id, label: personLabel(row.inspector) ?? "Unnamed Inspector" },
      });
    }
    if (data.length < PAGE) return rows;
  }
  return rows;
}

/** The first inspection's date of all, or null before any. Undefined when it cannot be read. */
async function readFirstDay(supabase: Client): Promise<string | null | undefined> {
  const { data, error } = await supabase
    .from("inspections")
    .select("inspection_date")
    .order("inspection_date")
    .limit(1)
    .maybeSingle();
  if (error) {
    logFailure("the first inspection's date", error);
    return undefined;
  }
  return data?.inspection_date ?? null;
}

export async function loadDashboardSummary(
  supabase: Client,
  period: DashboardPeriod,
  now: Date = new Date(),
): Promise<DashboardSummary | null> {
  const today = todayInMalaysia(now);
  const [rows, firstDay] = await Promise.all([readRows(supabase, readFrom(period, today)), readFirstDay(supabase)]);
  if (rows === null || firstDay === undefined) return null;
  return summariseDashboard({ rows, period, today, firstDay });
}
