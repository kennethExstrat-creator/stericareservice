import { unstable_rethrow } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Manufacturers and clients for the admin screens (BUILD_SPEC 3, 5 and 10):
 * the form schemas, how client logos are stored, list search, plain words
 * for database errors, and the queries both pages run.
 *
 * Shared by server and browser code (the pages' client components use the
 * logo rules and the search), so nothing here imports a server-only module.
 * The queries take the caller's Supabase client: they run with the signed-in
 * admin's rights, so Row Level Security checks every one of them again.
 */

export type DatabaseClient = SupabaseClient<Database>;

/* ------------------------------------------------------------------ *
 * Kinds
 * ------------------------------------------------------------------ */

export type ReferenceKind = "manufacturer" | "client";

export const KINDS = {
  manufacturer: { one: "manufacturer", many: "manufacturers" },
  client: { one: "client", many: "clients" },
} as const satisfies Record<ReferenceKind, { one: string; many: string }>;

/* ------------------------------------------------------------------ *
 * Form input
 * ------------------------------------------------------------------ */

/** Longest values the forms take: room for real names and addresses, short enough for a report header. */
export const LIMITS = {
  name: 120,
  factory_name: 120,
  country: 60,
  address: 400,
  notes: 2000,
} as const;

export const MESSAGES = {
  stale: "This page is out of date. Reload it and try again.",
  checkFields: "Check the highlighted fields.",
  unexpected: "Something went wrong on the server. Try again, and reload the page if it keeps happening.",
  unreachable: "Could not reach the server. Check the connection and try again.",
} as const;

/** One line: any run of spaces, tabs or pasted line breaks becomes a single space. */
export function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Several lines (addresses, notes): \n line ends, no spaces at line ends, no blank lines at either end. */
export function multiLine(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

const nullIfEmpty = (value: string): string | null => (value === "" ? null : value);
const tooLong = (what: string, max: number) => `Keep the ${what} to ${max.toLocaleString("en-GB")} characters or fewer.`;

function requiredLine(max: number, what: string, empty: string) {
  return z.string().overwrite(oneLine).min(1, empty).max(max, tooLong(what, max));
}

function optionalLine(max: number, what: string) {
  return z.string().overwrite(oneLine).max(max, tooLong(what, max)).transform(nullIfEmpty);
}

function optionalText(max: number, what: string) {
  return z.string().overwrite(multiLine).max(max, tooLong(what, max)).transform(nullIfEmpty);
}

/** A manufacturer as the form sends it. Keys are the table's columns; empty optional fields become null. */
export const ManufacturerInputSchema = z.object({
  name: requiredLine(LIMITS.name, "name", "Enter the manufacturer's name."),
  factory_name: optionalLine(LIMITS.factory_name, "factory name"),
  address: optionalText(LIMITS.address, "address"),
  country: optionalLine(LIMITS.country, "country"),
  notes: optionalText(LIMITS.notes, "notes"),
});
export type ManufacturerInput = z.output<typeof ManufacturerInputSchema>;
export type ManufacturerField = keyof ManufacturerInput;
export const MANUFACTURER_FIELDS = Object.keys(ManufacturerInputSchema.shape) as ManufacturerField[];

/** A client as the form sends it. The logo has its own flow (see Client logos below). */
export const ClientInputSchema = z.object({
  name: requiredLine(LIMITS.name, "name", "Enter the client's name."),
  notes: optionalText(LIMITS.notes, "notes"),
});
export type ClientField = keyof z.output<typeof ClientInputSchema>;
export const CLIENT_FIELDS = Object.keys(ClientInputSchema.shape) as ClientField[];

type ManufacturerText = { name: string; factoryName: string | null; address: string | null; country: string | null; notes: string | null };

/** A manufacturer's editable fields as the form shows them: text, "" for none. */
export function manufacturerValues(row: ManufacturerText | null): Record<ManufacturerField, string> {
  return {
    name: row?.name ?? "",
    factory_name: row?.factoryName ?? "",
    address: row?.address ?? "",
    country: row?.country ?? "",
    notes: row?.notes ?? "",
  };
}

/** A client's editable fields as the form shows them. The logo is not one: it has its own actions. */
export function clientValues(row: { name: string; notes: string | null } | null): Record<ClientField, string> {
  return { name: row?.name ?? "", notes: row?.notes ?? "" };
}

/* ------------------------------------------------------------------ *
 * Versions: a save never replaces a change its panel has not shown
 * ------------------------------------------------------------------ */

/** A row's editable fields as the form shows them, at one version of the row (its `updated_at`). */
export type Snapshot<Field extends string> = { version: string; values: Record<Field, string> };

/**
 * The version an open panel saves against, once the page has a newer copy
 * of the row. A logo change (or anything else outside the form) moves
 * `updated_at` without touching the fields, so the panel follows it and its
 * next save still goes through. If the fields changed, someone else edited
 * them: the panel keeps `base`, and its save is refused instead of quietly
 * replacing what they wrote.
 */
export function followVersion<Field extends string>(base: Snapshot<Field>, latest: Snapshot<Field>): Snapshot<Field> {
  if (latest.version === base.version) return base;
  const fields = Object.keys(base.values) as Field[];
  const unchanged = fields.every((field) => latest.values[field] === base.values[field]);
  return unchanged ? { version: latest.version, values: base.values } : base;
}

/** A row id sent back by the page. Any uuid: ids come from Postgres, which takes every version. */
export const RecordIdSchema = z.guid({ error: MESSAGES.stale });

export const RecordTargetSchema = z.object({ id: RecordIdSchema });

/**
 * Which row a form saves: no id adds a new one; an id comes with the version
 * (`updated_at`) the form was opened on, so a save never silently replaces
 * someone else's newer change.
 */
export const EditTargetSchema = z
  .object({
    id: z.union([z.literal(""), RecordIdSchema]),
    version: z.union([z.literal(""), z.iso.datetime({ offset: true })]),
  })
  .refine((target) => (target.id === "") === (target.version === ""), MESSAGES.stale);

/** A form's text fields by name. Missing fields and files read as "", which the schemas reject where a value is required. */
export function readForm<K extends string>(formData: FormData, keys: readonly K[]): Record<K, string> {
  const values = {} as Record<K, string>;
  for (const key of keys) {
    const value = formData.get(key);
    values[key] = typeof value === "string" ? value : "";
  }
  return values;
}

/** The first message for each field, shown under that field. */
export function fieldErrors<T>(error: z.ZodError<T>): Partial<Record<keyof T & string, string>> {
  const result: Partial<Record<string, string>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !(field in result)) result[field] = issue.message;
  }
  return result as Partial<Record<keyof T & string, string>>;
}

/* ------------------------------------------------------------------ *
 * Action results
 * ------------------------------------------------------------------ */

/**
 * What a Server Action on these pages answers. Only display data: it is
 * serialised to the browser. `id` names the row a save created or changed,
 * and `version` is a new row's first `updated_at`. `latest` comes with a
 * save refused because someone else changed the row: the row as it is now,
 * which a second save replaces (the panel says so).
 */
export type ActionResult<Field extends string = string> =
  | { status: "idle" }
  | { status: "success"; message: string; id?: string; version?: string }
  | { status: "error"; message: string; fieldErrors?: Partial<Record<Field, string>>; latest?: Snapshot<Field> };

export const IDLE = { status: "idle" } as const;

export function succeeded(
  message: string,
  row?: { id: string; version?: string },
): { status: "success"; message: string; id?: string; version?: string } {
  return { status: "success", message, ...row };
}

export function failed<Field extends string = never>(
  message: string,
  fieldErrors?: Partial<Record<Field, string>>,
): { status: "error"; message: string; fieldErrors?: Partial<Record<Field, string>> } {
  return fieldErrors ? { status: "error", message, fieldErrors } : { status: "error", message };
}

/**
 * Runs a Server Action body. An unexpected failure becomes a message on the
 * form instead of an error page; Next.js redirects and 404s pass through.
 */
export async function guarded<T>(name: string, run: () => Promise<T>): Promise<T | { status: "error"; message: string }> {
  try {
    return await run();
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[admin/reference] ${name} failed`, error);
    return failed(MESSAGES.unexpected);
  }
}

/** For the browser: a Server Action call that never got an answer (dropped Wi-Fi, a new deployment). */
export function unreachable(error: unknown): { status: "error"; message: string } {
  console.error(error);
  return failed(MESSAGES.unreachable);
}

/* ------------------------------------------------------------------ *
 * Usage: what still refers to a manufacturer or client
 * ------------------------------------------------------------------ */

/** Templates and inspections that refer to a row. Both restrict its deletion in the database. */
export type Usage = { templates: number; inspections: number };

export function isInUse(usage: Usage): boolean {
  return usage.templates > 0 || usage.inspections > 0;
}

function counted(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-GB")} ${count === 1 ? one : many}`;
}

/** "Not in use", "1 template", "2 templates and 14 inspections". */
export function usageText(usage: Usage): string {
  const parts: string[] = [];
  if (usage.templates > 0) parts.push(counted(usage.templates, "template", "templates"));
  if (usage.inspections > 0) parts.push(counted(usage.inspections, "inspection", "inspections"));
  return parts.length > 0 ? parts.join(" and ") : "Not in use";
}

/** Why a row cannot be deleted, or null when it can. */
export function deleteBlocker(usage: Usage): string | null {
  return isInUse(usage) ? `Used by ${usageText(usage)}, so it cannot be deleted.` : null;
}

/* ------------------------------------------------------------------ *
 * Database errors in plain words (codes: docs/DATABASE.md)
 * ------------------------------------------------------------------ */

type DatabaseError = { code?: string | null; message?: string | null };

/** A failed insert or update. A duplicate belongs next to the name field. */
export function describeSaveError(kind: ReferenceKind, error: DatabaseError): { message: string; field?: "name" } {
  switch (error.code) {
    case "23505":
      return {
        field: "name",
        message:
          kind === "manufacturer"
            ? "There is already a manufacturer with this name and factory."
            : "There is already a client with this name.",
      };
    case "42501":
      return { message: `Only active admins can change ${KINDS[kind].many}. Reload the page to check your access.` };
    default:
      return { message: `The ${KINDS[kind].one} could not be saved. Try again.` };
  }
}

/** A failed delete. 23503 and 23001 are a template or inspection that still refers to the row. */
export function describeDeleteError(kind: ReferenceKind, error: DatabaseError): string {
  switch (error.code) {
    case "23503":
    case "23001":
      return `Templates or inspections use this ${KINDS[kind].one}, so it cannot be deleted.`;
    case "42501":
      return `Only active admins can delete ${KINDS[kind].many}. Reload the page to check your access.`;
    default:
      return `The ${KINDS[kind].one} could not be deleted. Try again.`;
  }
}

/**
 * How a manufacturer is named in buttons and messages. A company can have
 * several plants, so the factory goes with the name: "Terang Nusa Sdn. Bhd.,
 * TG Factory 40".
 */
export function manufacturerLabel(manufacturer: { name: string; factoryName: string | null }): string {
  return manufacturer.factoryName ? `${manufacturer.name}, ${manufacturer.factoryName}` : manufacturer.name;
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

/** Lower case, accents dropped, single spaces: "Hártalega  NGC" finds "hartalega ngc". */
export function normaliseForSearch(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** The text a row is searched by: its fields, normalised once. */
export function searchText(...values: Array<string | null | undefined>): string {
  return normaliseForSearch(values.filter(Boolean).join(" "));
}

/** True when every word of the query appears in the row's search text, in any order. */
export function matchesSearch(text: string, query: string): boolean {
  const terms = normaliseForSearch(query).split(" ").filter(Boolean);
  return terms.every((term) => text.includes(term));
}

/* ------------------------------------------------------------------ *
 * Client logos
 * ------------------------------------------------------------------ */

/** The private bucket for client logos (migration 20261006000500). Admins write, active users read. */
export const CLIENT_LOGOS_BUCKET = "client-logos";

/** The bucket's own size limit: 2 MiB. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** What the bucket accepts, and the extension each type is stored with. No SVG: it can carry script. */
export const LOGO_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;
export type LogoType = keyof typeof LOGO_TYPES;

/** For the file input's `accept`. */
export const LOGO_ACCEPT = Object.keys(LOGO_TYPES).join(",");

/** How long a logo preview link works. Pages sign fresh links on every render. */
export const LOGO_URL_SECONDS = 60 * 60;

/** An upload that never became a client's logo (the browser closed half-way) is removed after this. */
export const ABANDONED_UPLOAD_MS = 60 * 60 * 1000;

export function isLogoType(type: string): type is LogoType {
  return Object.hasOwn(LOGO_TYPES, type);
}

/** A file size for people: "3.4 MB". */
export function formatMegabytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`;
}

/** Why a chosen file cannot be a logo, or null when it can. The browser checks before uploading; the server again. */
export function logoFileProblem(file: { type: string; size: number }): string | null {
  if (!isLogoType(file.type)) return "Choose a PNG, JPEG or WebP image.";
  if (file.size <= 0) return "That file is empty. Choose another image.";
  if (file.size > LOGO_MAX_BYTES) return `That image is ${formatMegabytes(file.size)}. Choose one up to 2 MB.`;
  return null;
}

/** The upload a browser asks the server to prepare. */
export const LogoUploadRequestSchema = z.object({
  clientId: RecordIdSchema,
  type: z.string(),
  size: z.number().int().nonnegative(),
});

/** The upload a browser asks the server to make the client's logo. */
export const LogoConfirmSchema = z.object({
  clientId: RecordIdSchema,
  path: z.string().max(200),
});

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LOGO_OBJECT_NAME = new RegExp(`^(${UUID})/(${UUID}\\.(?:png|jpg|webp))$`);

/**
 * Where a client's logo is stored in client-logos: `<client_id>/<uuid>.<ext>`.
 * Every upload gets a new name, so a replaced logo never comes back from a
 * cache, and the old file goes only once the client points at the new one.
 */
export function logoObjectName(clientId: string, type: LogoType, fileId: string = crypto.randomUUID()): string {
  return `${clientId.toLowerCase()}/${fileId.toLowerCase()}.${LOGO_TYPES[type]}`;
}

/** The client folder and file name of a logo's object name, or null for any other name. */
export function parseLogoObjectName(name: string): { clientId: string; fileName: string } | null {
  const match = LOGO_OBJECT_NAME.exec(name);
  return match ? { clientId: match[1], fileName: match[2] } : null;
}

/** True when `name` is a logo object name inside this client's folder. */
export function isLogoOf(name: string, clientId: string): boolean {
  return parseLogoObjectName(name)?.clientId === clientId.toLowerCase();
}

/* ------------------------------------------------------------------ *
 * Queries
 * ------------------------------------------------------------------ */

type UsageColumns = { templates: Array<{ count: number }>; inspections: Array<{ count: number }> };

function usageOf(row: UsageColumns): Usage {
  return { templates: row.templates[0]?.count ?? 0, inspections: row.inspections[0]?.count ?? 0 };
}

const byName = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

/** One manufacturer as the admin page shows it. Display fields only: this reaches the browser. */
export type ManufacturerItem = {
  id: string;
  name: string;
  factoryName: string | null;
  address: string | null;
  country: string | null;
  notes: string | null;
  /** The row's `updated_at`: the version an edit starts from. */
  updatedAt: string;
  usage: Usage;
};

/**
 * A stored logo as the page shows it: a signed preview link, or why there is
 * none. "missing": Storage has no file by the logo's name, so it needs
 * uploading again. "unavailable": no links could be made just now (Storage
 * did not answer), so the file itself may well be fine.
 */
export type LogoPreview = { url: string } | { url: null; problem: "missing" | "unavailable" };

const LOGO_MISSING: LogoPreview = { url: null, problem: "missing" };
const LOGO_UNAVAILABLE: LogoPreview = { url: null, problem: "unavailable" };

/** One client as the admin page shows it. The logo's object name stays on the server. */
export type ClientItem = {
  id: string;
  name: string;
  notes: string | null;
  updatedAt: string;
  usage: Usage;
  logo: LogoPreview | null;
};

/** Every manufacturer with its usage counts, by name (then factory). */
export async function loadManufacturers(supabase: DatabaseClient): Promise<ManufacturerItem[]> {
  const { data, error } = await supabase
    .from("manufacturers")
    .select("id, name, factory_name, address, country, notes, updated_at, templates(count), inspections(count)");
  if (error) throw new Error(`Could not load the manufacturers: ${error.message}`);

  return data
    .map((row) => ({
      id: row.id,
      name: row.name,
      factoryName: row.factory_name,
      address: row.address,
      country: row.country,
      notes: row.notes,
      updatedAt: row.updated_at,
      usage: usageOf(row),
    }))
    .sort((a, b) => byName.compare(a.name, b.name) || byName.compare(a.factoryName ?? "", b.factoryName ?? ""));
}

/** Every client with its usage counts and a signed preview of its logo, by name. */
export async function loadClients(supabase: DatabaseClient): Promise<ClientItem[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, logo_path, notes, updated_at, templates(count), inspections(count)");
  if (error) throw new Error(`Could not load the clients: ${error.message}`);

  const previews = await signLogos(
    supabase,
    data.flatMap((row) => (row.logo_path ? [row.logo_path] : [])),
  );
  return data
    .map((row) => ({
      id: row.id,
      name: row.name,
      notes: row.notes,
      updatedAt: row.updated_at,
      usage: usageOf(row),
      logo: row.logo_path ? (previews.get(row.logo_path) ?? LOGO_UNAVAILABLE) : null,
    }))
    .sort((a, b) => byName.compare(a.name, b.name));
}

/**
 * Logo previews by object name, signed in one call. The page never fails
 * over a logo: a file Storage does not have is "missing" (upload it again),
 * and when Storage does not answer at all every logo is "unavailable" (reload
 * later), so an outage never asks admins to replace logos that are fine.
 */
export async function signLogos(supabase: DatabaseClient, paths: readonly string[]): Promise<Map<string, LogoPreview>> {
  const previews = new Map<string, LogoPreview>();
  if (paths.length === 0) return previews;

  const { data, error } = await supabase.storage.from(CLIENT_LOGOS_BUCKET).createSignedUrls([...paths], LOGO_URL_SECONDS);
  if (error) {
    console.error("[admin/reference] could not sign client logos", error.message);
    for (const path of paths) previews.set(path, LOGO_UNAVAILABLE);
    return previews;
  }
  // Storage answers each name it cannot find with an error of its own.
  for (const item of data) {
    if (item.path) previews.set(item.path, item.signedUrl && !item.error ? { url: item.signedUrl } : LOGO_MISSING);
  }
  return previews;
}

/** A manufacturer by id with its usage counts, or null when it does not exist. */
export async function readManufacturer(
  supabase: DatabaseClient,
  id: string,
): Promise<{ id: string; name: string; factoryName: string | null; usage: Usage } | null> {
  const { data, error } = await supabase
    .from("manufacturers")
    .select("id, name, factory_name, templates(count), inspections(count)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read manufacturer ${id}: ${error.message}`);
  return data ? { id: data.id, name: data.name, factoryName: data.factory_name, usage: usageOf(data) } : null;
}

/** A client by id with its logo's object name and usage counts, or null when it does not exist. */
export async function readClient(
  supabase: DatabaseClient,
  id: string,
): Promise<{ id: string; name: string; logoPath: string | null; usage: Usage } | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, logo_path, templates(count), inspections(count)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read client ${id}: ${error.message}`);
  return data ? { id: data.id, name: data.name, logoPath: data.logo_path, usage: usageOf(data) } : null;
}

/** A manufacturer's editable fields at its current version, or null when it does not exist. */
export async function readManufacturerSnapshot(
  supabase: DatabaseClient,
  id: string,
): Promise<Snapshot<ManufacturerField> | null> {
  const { data, error } = await supabase
    .from("manufacturers")
    .select("name, factory_name, address, country, notes, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read manufacturer ${id}: ${error.message}`);
  if (!data) return null;
  const { factory_name: factoryName, updated_at: version, ...text } = data;
  return { version, values: manufacturerValues({ ...text, factoryName }) };
}

/** A client's editable fields at its current version, or null when it does not exist. */
export async function readClientSnapshot(supabase: DatabaseClient, id: string): Promise<Snapshot<ClientField> | null> {
  const { data, error } = await supabase.from("clients").select("name, notes, updated_at").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not read client ${id}: ${error.message}`);
  return data ? { version: data.updated_at, values: clientValues(data) } : null;
}

/** The files in a client's logo folder, oldest first. */
async function listLogoFolder(supabase: DatabaseClient, clientId: string) {
  const { data, error } = await supabase.storage
    .from(CLIENT_LOGOS_BUCKET)
    .list(clientId.toLowerCase(), { limit: 1000, sortBy: { column: "created_at", order: "asc" } });
  if (error) throw new Error(`Could not list the logo files of client ${clientId}: ${error.message}`);
  // Folders have no id.
  return data.filter((item) => item.id !== null);
}

/** True when the upload `name` is in Storage. */
export async function logoFileExists(supabase: DatabaseClient, name: string): Promise<boolean> {
  const parsed = parseLogoObjectName(name);
  if (!parsed) return false;
  const { data, error } = await supabase.storage
    .from(CLIENT_LOGOS_BUCKET)
    .list(parsed.clientId, { limit: 10, search: parsed.fileName });
  if (error) throw new Error(`Could not check the uploaded logo ${name}: ${error.message}`);
  return data.some((item) => item.id !== null && item.name === parsed.fileName);
}

/** True when another client's row points at the logo file `name` (only possible if set outside this app). */
async function isLogoOfAnotherClient(supabase: DatabaseClient, name: string, clientId: string): Promise<boolean> {
  const { data, error } = await supabase.from("clients").select("id").eq("logo_path", name).neq("id", clientId).limit(1);
  if (error) throw new Error(`Could not check who else uses the logo ${name}: ${error.message}`);
  return data.length > 0;
}

/**
 * Removes logo files of one client that nothing points at: `previous` (the
 * logo just replaced or removed) and uploads abandoned more than an hour ago.
 * Never `keep` (the current logo) and never a recent upload, which may still
 * be on its way to becoming the logo. Best effort: a file left behind is
 * untidy, not wrong, so failures are logged rather than reported.
 */
export async function removeUnusedLogos(
  supabase: DatabaseClient,
  clientId: string,
  { keep, previous = null, now = Date.now() }: { keep: string | null; previous?: string | null; now?: number },
): Promise<void> {
  try {
    const folder = clientId.toLowerCase();
    const doomed = new Set<string>();
    if (previous && previous !== keep && !(await isLogoOfAnotherClient(supabase, previous, clientId))) {
      doomed.add(previous);
    }
    for (const item of await listLogoFolder(supabase, folder)) {
      const name = `${folder}/${item.name}`;
      const created = Date.parse(item.created_at ?? "");
      if (name !== keep && Number.isFinite(created) && now - created > ABANDONED_UPLOAD_MS) doomed.add(name);
    }
    if (doomed.size === 0) return;
    const { error } = await supabase.storage.from(CLIENT_LOGOS_BUCKET).remove([...doomed]);
    if (error) throw new Error(error.message);
  } catch (error) {
    console.error(`[admin/reference] could not tidy the logo files of client ${clientId}`, error);
  }
}

/**
 * Removes a deleted client's logo files: its whole folder, and its last logo
 * if that was stored elsewhere (set outside this app) and no other client
 * uses it. Best effort, as above.
 */
export async function removeLogoFiles(
  supabase: DatabaseClient,
  clientId: string,
  logoPath: string | null,
): Promise<void> {
  try {
    const folder = clientId.toLowerCase();
    const doomed = new Set((await listLogoFolder(supabase, folder)).map((item) => `${folder}/${item.name}`));
    if (logoPath && !doomed.has(logoPath) && !(await isLogoOfAnotherClient(supabase, logoPath, clientId))) {
      doomed.add(logoPath);
    }
    if (doomed.size === 0) return;
    const { error } = await supabase.storage.from(CLIENT_LOGOS_BUCKET).remove([...doomed]);
    if (error) throw new Error(error.message);
  } catch (error) {
    console.error(`[admin/reference] could not remove the logo files of deleted client ${clientId}`, error);
  }
}
