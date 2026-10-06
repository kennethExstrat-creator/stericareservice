import { z } from "zod";
import { InspectionStatusSchema, type InspectionStatus } from "@/lib/schemas/common";

/**
 * The inspections list keeps its filters in the URL (BUILD_SPEC 10), so a
 * filtered view can be bookmarked or shared. Pure functions: the page parses
 * with them on the server and the filter bar builds links with them in the
 * browser, so both always agree on the URL.
 */

export const INSPECTIONS_PATH = "/inspections";
export const PAGE_SIZE = 50;
/** Refs, PO and lot numbers are far shorter; longer text is not a search. */
export const MAX_SEARCH_LENGTH = 100;
const MAX_PAGE = 100_000;

export type InspectionListFilters = {
  /** Ref, PO or exact lot number (lib/inspections/postgrest.ts). */
  q?: string;
  status?: InspectionStatus;
  /** Client id. */
  client?: string;
  /** Manufacturer id. */
  manufacturer?: string;
  /** 1-based. */
  page: number;
};

/** A client or manufacturer in the filter bar. */
export type FilterOption = { id: string; label: string };

/** What Next.js hands a page as `searchParams`. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * Search text as it is matched: control characters (which Postgres rejects in
 * text) become spaces, runs of whitespace collapse, the ends are trimmed.
 */
export function normaliseSearchText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A repeated parameter (`?status=a&status=b`) counts with its first value. */
function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

const SearchTextSchema = z
  .string()
  .transform(normaliseSearchText)
  .pipe(z.string().max(MAX_SEARCH_LENGTH))
  .transform((text) => text || undefined);

// Database ids. guid() accepts any 8-4-4-4-12 hex id, as Postgres does; ids
// are compared in lower case, the way Postgres prints them.
const IdSchema = z.guid().transform((id) => id.toLowerCase());

const PageSchema = z
  .string()
  .regex(/^\d{1,6}$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(MAX_PAGE));

/** Each field falls back on its own, so one bad value never drops the rest. */
function optionalParam<T extends z.ZodType>(schema: T) {
  return z.preprocess(firstValue, schema.optional()).catch(undefined);
}

export const InspectionListSearchParamsSchema = z.object({
  q: optionalParam(SearchTextSchema),
  status: optionalParam(InspectionStatusSchema),
  client: optionalParam(IdSchema),
  manufacturer: optionalParam(IdSchema),
  page: optionalParam(PageSchema),
});

/** The filters in a URL. Invalid or unknown values are dropped, never an error. */
export function parseInspectionSearchParams(raw: RawSearchParams): InspectionListFilters {
  const parsed = InspectionListSearchParamsSchema.parse(raw);
  const filters: InspectionListFilters = { page: parsed.page ?? 1 };
  if (parsed.q) filters.q = parsed.q;
  if (parsed.status) filters.status = parsed.status;
  if (parsed.client) filters.client = parsed.client;
  if (parsed.manufacturer) filters.manufacturer = parsed.manufacturer;
  return filters;
}

/**
 * Drops a client or manufacturer filter that names no row the user can see
 * (a deleted client, a mistyped link), like any other invalid value, so the
 * filter bar never holds a choice it cannot show. Returns the same object
 * when nothing changes.
 */
export function dropUnknownReferences(
  filters: InspectionListFilters,
  known: { clients: readonly { id: string }[]; manufacturers: readonly { id: string }[] },
): InspectionListFilters {
  const clientKnown = !filters.client || known.clients.some((client) => client.id === filters.client);
  const manufacturerKnown =
    !filters.manufacturer || known.manufacturers.some((manufacturer) => manufacturer.id === filters.manufacturer);
  if (clientKnown && manufacturerKnown) return filters;

  const next: InspectionListFilters = { ...filters, page: 1 };
  if (!clientKnown) delete next.client;
  if (!manufacturerKnown) delete next.manufacturer;
  return next;
}

/** True when the list is narrowed by search, status, client or manufacturer. */
export function hasActiveFilters(filters: Partial<InspectionListFilters>): boolean {
  return Boolean(filters.q || filters.status || filters.client || filters.manufacturer);
}

/**
 * The canonical URL of a list view: empty filters and page 1 are left out, so
 * every view has exactly one address and parsing it gives the same filters.
 */
export function buildInspectionsHref(filters: Partial<InspectionListFilters>): string {
  const params = new URLSearchParams();
  const q = filters.q ? normaliseSearchText(filters.q).slice(0, MAX_SEARCH_LENGTH) : "";
  if (q) params.set("q", q);
  if (filters.status) params.set("status", filters.status);
  if (filters.client) params.set("client", filters.client);
  if (filters.manufacturer) params.set("manufacturer", filters.manufacturer);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  return query ? `${INSPECTIONS_PATH}?${query}` : INSPECTIONS_PATH;
}

/** Number of pages for `total` rows (at least 1, so "page 1 of 1" holds when empty). */
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

/** The 1-based first and last row numbers shown on `page`. */
export function pageRange(page: number, total: number): { from: number; to: number } {
  if (total === 0) return { from: 0, to: 0 };
  const from = (page - 1) * PAGE_SIZE + 1;
  return { from, to: Math.min(page * PAGE_SIZE, total) };
}
