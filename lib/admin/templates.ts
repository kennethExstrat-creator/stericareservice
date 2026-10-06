import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  defaultLabels,
  DEFECT_CLASSES,
  groupLabelKey,
  isConfigTarget,
  isCustomTarget,
  isFieldTarget,
  isLabelTarget,
  isTemplateTarget,
  LABELLING_LEVELS,
  MEASURES,
  moduleSpec,
  SOURCE_DOCUMENTS,
  sourceFields,
  TEMPLATE_CODES,
  TEMPLATES,
  type SourceField,
  type SourceId,
  type SourceInput,
  type SourceTarget,
  type TemplateCode,
} from "@/lib/coverage";
import type { ProductType, Standard } from "@/lib/schemas/common";
import { ALWAYS_ON_MODULE_KEYS, type ModuleKey } from "@/lib/schemas/module-result";
import { normaliseSize } from "@/lib/sizes";
import {
  ResolvedTemplateSchema,
  TemplateDefinitionSchema,
  type CustomModule,
  type ResolvedModule,
  type ResolvedTemplate,
  type TemplateDefinition,
} from "@/lib/schemas/template";
import type { Database, Json, TablesInsert } from "@/lib/supabase/database.types";
import {
  lookupFrom,
  MAX_EXTENDS_DEPTH,
  nextVersion,
  planActivation,
  staleBases,
  type ActivationPlan,
  type StaleBase,
  type TemplateBase,
  type TemplateLookup,
  type TemplateStatus,
} from "@/lib/templates";
import { labelFor, type ModuleRegistry } from "@/modules/_framework";

/*
 * Template versions for the admin screens (BUILD_SPEC 4.2 rules 8 to 10, 4.5
 * and 10): the list by code, one version with its resolved modules, the
 * source form in the template-sources bucket, the field coverage checklist
 * built from lib/coverage, and the rules for activating, retiring and making
 * a new version. Pure functions and queries; the queries take the caller's
 * Supabase client, so Row Level Security checks every one of them again.
 *
 * Server only: it carries the whole data dictionary. Client components
 * import its types, never its values (a value import would ship the
 * dictionary to the browser); the pages pass what they need as props.
 */

export type DatabaseClient = SupabaseClient<Database>;
export type { TemplateStatus } from "@/lib/templates";

/* ------------------------------------------------------------------ *
 * Paths and words
 * ------------------------------------------------------------------ */

export const TEMPLATES_PATH = "/admin/templates";

export function templatePath(id: string): string {
  return `${TEMPLATES_PATH}/${id}`;
}

/** The template editor (another screen): a draft is edited there. */
export function templateEditPath(id: string): string {
  return `${TEMPLATES_PATH}/${id}/edit`;
}

export const TEMPLATE_STATUS_LABEL: Readonly<Record<TemplateStatus, string>> = {
  draft: "Draft",
  active: "Active",
  retired: "Retired",
};

export const PRODUCT_TYPE_LABEL: Readonly<Record<ProductType, string>> = {
  examination: "Examination",
  surgical: "Surgical",
};

export const STANDARD_LABEL: Readonly<Record<Standard, string>> = {
  EN455: "EN 455",
  ASTM_D6319: "ASTM D6319",
  ASTM_D3578: "ASTM D3578",
  ASTM_D3577: "ASTM D3577",
  custom: "Custom standard",
};

export const UNIT_LABEL = { pcs: "Pieces", pairs: "Pairs" } as const;

export const MESSAGES = {
  stale: "This page is out of date. Reload it and try again.",
  changed: "Someone changed this version while you had it open. Reload the page and check it again.",
  notFound: "This template version no longer exists. Go back to the templates list.",
  unexpected: "Something went wrong on the server. Try again, and reload the page if it keeps happening.",
  unreachable: "Could not reach the server. Check the connection, then reload the page and try again.",
} as const;

/** How many inspections use a version, in words. */
export function usageText(count: number): string {
  if (count === 0) return "Not used yet";
  return `${count.toLocaleString("en-GB")} ${count === 1 ? "inspection" : "inspections"}`;
}

// Rendered on the server only, in the team's time zone, so a date reads the
// same on every device and never differs between server and browser.
const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kuala_Lumpur",
});
const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Kuala_Lumpur",
});

/** `6 Oct 2026` in Malaysia time; anything unreadable as it is. */
export function formatDate(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : DATE.format(time);
}

/** `6 Oct 2026, 14:05` in Malaysia time. */
export function formatDateTime(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : DATE_TIME.format(time);
}

/** A person by name, falling back to their email address. */
export function personName(person: { full_name: string | null; email: string | null } | null | undefined): string | null {
  if (!person) return null;
  return person.full_name?.trim() || person.email?.trim() || null;
}

/* ------------------------------------------------------------------ *
 * Source files (the original form or report, BUILD_SPEC 4.2 rule 10)
 * ------------------------------------------------------------------ */

/** The private bucket for template sources (migration 20261006000500). Admins write, active users read. */
export const SOURCE_BUCKET = "template-sources";

/** The bucket's size limit: 50 MiB. */
export const SOURCE_MAX_BYTES = 50 * 1024 * 1024;

/** How long a download link works: the page asks for a fresh one on every click. */
export const SOURCE_URL_SECONDS = 60;

/** An upload that never became a version's source file (the browser closed half-way) is removed after this. */
export const ABANDONED_UPLOAD_MS = 60 * 60 * 1000;

/**
 * The types the bucket accepts, with the extensions a browser may report
 * instead of a type (an .xls from some pickers arrives as an empty type).
 */
export const SOURCE_TYPES = {
  "application/pdf": { kind: "PDF", extensions: ["pdf"] },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { kind: "Excel", extensions: ["xlsx"] },
  "application/vnd.ms-excel": { kind: "Excel", extensions: ["xls"] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { kind: "Word", extensions: ["docx"] },
  "application/msword": { kind: "Word", extensions: ["doc"] },
  "image/jpeg": { kind: "Photo", extensions: ["jpg", "jpeg"] },
  "image/png": { kind: "Image", extensions: ["png"] },
  "image/webp": { kind: "Image", extensions: ["webp"] },
  "image/heic": { kind: "Photo", extensions: ["heic"] },
  "image/heif": { kind: "Photo", extensions: ["heif"] },
} as const;
export type SourceType = keyof typeof SOURCE_TYPES;

/** For `<input accept>`: the types and the extensions, so every picker offers the files. */
export const SOURCE_ACCEPT = [
  ...Object.keys(SOURCE_TYPES),
  ...Object.values(SOURCE_TYPES).flatMap((entry) => entry.extensions.map((extension) => `.${extension}`)),
].join(",");

export const SOURCE_TYPE_HINT = "a PDF, Excel or Word file, or a photo (JPEG, PNG, WebP or HEIC), up to 50 MB";

export const SOURCE_TYPE_PROBLEM = "Choose a PDF, Excel or Word file, or a photo (JPEG, PNG, WebP or HEIC).";

function isSourceType(type: string): type is SourceType {
  return Object.hasOwn(SOURCE_TYPES, type);
}

function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** The type to store a file under: the browser's, or the one its extension stands for. Null when the bucket would refuse it. */
export function sourceFileType(name: string, type: string): SourceType | null {
  const declared = type.trim().toLowerCase();
  if (isSourceType(declared)) return declared;
  const extension = extensionOf(name);
  if (!extension) return null;
  const found = (Object.keys(SOURCE_TYPES) as SourceType[]).find((key) =>
    (SOURCE_TYPES[key].extensions as readonly string[]).includes(extension),
  );
  return found ?? null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`;
}

/** Why a chosen file cannot be a source file, or null when it can. The browser checks before uploading; the server again. */
export function sourceFileProblem(file: { name: string; type: string; size: number }): string | null {
  if (!sourceFileType(file.name, file.type)) return SOURCE_TYPE_PROBLEM;
  if (file.size <= 0) return "That file is empty. Choose the saved form or report.";
  if (file.size > SOURCE_MAX_BYTES) return `That file is ${formatBytes(file.size)}. Choose one up to 50 MB.`;
  return null;
}

/**
 * A file name safe in a storage path: ASCII letters, digits, `.`, `_` and
 * `-` only, never `.` or `..`, at most 80 characters before the extension.
 * "STD EG report (2026).xlsx" becomes "STD-EG-report-2026.xlsx".
 */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const clean = (text: string) =>
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "");
  const stem = clean(dot > 0 ? base.slice(0, dot) : base).slice(0, 80).replace(/[-.]+$/g, "") || "source";
  const extension = clean(dot > 0 ? base.slice(dot + 1) : "").toLowerCase().slice(0, 10);
  return extension ? `${stem}.${extension}` : stem;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SOURCE_OBJECT_NAME = new RegExp(`^([A-Z][A-Z0-9_]*)/v([1-9][0-9]*)/(${UUID})/([A-Za-z0-9_][A-Za-z0-9._-]*)$`);

/**
 * Where a version's source file is stored in template-sources:
 * `<code>/v<version>/<uuid>/<file name>`. Every upload gets its own folder,
 * so a replaced file never comes back from a cache and the name stays readable.
 */
export function sourceObjectName(
  template: { code: string; version: number },
  fileName: string,
  fileId: string = crypto.randomUUID(),
): string {
  return `${template.code}/v${template.version}/${fileId.toLowerCase()}/${safeFileName(fileName)}`;
}

export type SourceObject = { code: string; version: number; fileId: string; fileName: string };

/** The parts of an object name sourceObjectName() made, or null for any other name. */
export function parseSourceObjectName(path: string): SourceObject | null {
  const match = SOURCE_OBJECT_NAME.exec(path);
  if (!match) return null;
  const [, code, version, fileId, fileName] = match;
  if (fileName === "." || fileName === "..") return null;
  return { code, version: Number(version), fileId, fileName };
}

/** True when `path` is an upload for this version, named as sourceObjectName() names them. */
export function isSourceOf(path: string, template: { code: string; version: number }): boolean {
  const parsed = parseSourceObjectName(path);
  return parsed !== null && parsed.code === template.code && parsed.version === template.version;
}

/** The file name to show and download under: the last part of any stored name. */
export function sourceFileName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/** The folder of one version's uploads: `<code>/v<version>`. */
export function sourceFolder(template: { code: string; version: number }): string {
  return `${template.code}/v${template.version}`;
}

/* ------------------------------------------------------------------ *
 * Action input and results
 * ------------------------------------------------------------------ */

export type ActionResult =
  | { status: "idle" }
  | { status: "success" | "warning" | "error"; message: string };

export const IDLE: ActionResult = { status: "idle" };

export function succeeded(message: string): ActionResult {
  return { status: "success", message };
}

export function failed(message: string): { status: "error"; message: string } {
  return { status: "error", message };
}

/** A template id sent back by the page, lower-cased as Supabase gives ids. */
const TemplateIdSchema = z.uuid().transform((id) => id.toLowerCase());

/** `updated_at` as the page read it: the version of the row the admin looked at. */
const SeenSchema = z.string().trim().min(1).max(64);

/** Activate, retire, new version, download: one version, as the page saw it. */
export const VersionTargetSchema = z.object({ templateId: TemplateIdSchema, seen: SeenSchema });

export const SourceUploadRequestSchema = z.object({
  templateId: TemplateIdSchema,
  fileName: z.string().trim().min(1).max(255),
  type: z.string().max(255),
  size: z.number().int().min(0),
});

export const SourceConfirmSchema = z.object({
  templateId: TemplateIdSchema,
  path: z.string().min(1).max(512),
});

export const CoverageConfirmSchema = z.object({
  templateId: TemplateIdSchema,
  seen: SeenSchema,
  /** The checklist sections the admin ticked: every one must be. */
  sections: z.array(z.string().min(1).max(300)).max(1000),
  /** "I checked the source file": the last tick. */
  attested: z.literal("yes", { error: "Tick the last box once you have checked the source file." }),
});

/** Plain words for a refused template write (docs/DATABASE.md, Notes for app code). */
export function describeTemplateError(
  error: { code?: string; message?: string } | null | undefined,
  template?: { code: string; version: number },
): string {
  const message = error?.message ?? "";
  const named = template ? `${template.code} version ${template.version}` : "This version";
  if (error?.code === "42501" && /in use/i.test(message)) {
    return `${named} is used by inspections, so it can no longer change: an inspection keeps the exact version it started with (BUILD_SPEC 4.2 rule 8), and the database refuses edits to a version in use. Make a new version and change that one instead.`;
  }
  if (error?.code === "42501") return "Only active admins can change templates. Reload the page and sign in again if you are one.";
  if (error?.code === "23505" && /one_active_version/i.test(message)) {
    return `Another version of ${template?.code ?? "this template"} became active at the same moment. Reload the page to see which one is active now.`;
  }
  if (error?.code === "23505") {
    return `Someone made a new version of ${template?.code ?? "this template"} at the same moment. Reload the page and try again.`;
  }
  if (error?.code === "23514") return `The database refused the change: ${message || "a rule on templates failed"}.`;
  return MESSAGES.unexpected;
}

/* ------------------------------------------------------------------ *
 * The list (BUILD_SPEC 10): every code with its versions
 * ------------------------------------------------------------------ */

type Named = { name: string | null };
type Maker = { name: string; factory_name: string | null };

export type TemplateVersionSummary = {
  id: string;
  code: string;
  version: number;
  status: TemplateStatus;
  /** definition.name; null when a definition has none. */
  name: string | null;
  extendsCode: string | null;
  productType: ProductType;
  standard: Standard;
  clientName: string | null;
  /** The client id when the client row could not be read (deleted or hidden). */
  clientId: string | null;
  manufacturerName: string | null;
  manufacturerId: string | null;
  /** Inspections that use this exact version. */
  usage: number;
  sourceFileName: string | null;
  coverageConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TemplateGroup = {
  code: string;
  /** The active version's name, or the newest version's. */
  name: string | null;
  active: TemplateVersionSummary | null;
  /** Newest first. */
  versions: TemplateVersionSummary[];
};

const LIST_COLUMNS =
  "id, code, version, status, extends_code, product_type, standard, client_id, manufacturer_id, source_file_path, coverage_confirmed_at, created_at, updated_at, name:definition->>name, clients(name), manufacturers(name, factory_name), inspections(count)";

/** A manufacturer by company and, when it has several plants, factory. */
export function manufacturerName(maker: Maker | null | undefined): string | null {
  if (!maker) return null;
  const factory = maker.factory_name?.trim();
  return factory ? `${maker.name} · ${factory}` : maker.name;
}

/** `inspections(count)` as PostgREST returns it: `[{ count }]`. */
export function countOf(embedded: unknown): number {
  if (Array.isArray(embedded)) {
    const first: unknown = embedded[0];
    if (typeof first === "object" && first !== null && typeof (first as { count?: unknown }).count === "number") {
      return (first as { count: number }).count;
    }
    return 0;
  }
  if (typeof embedded === "object" && embedded !== null && typeof (embedded as { count?: unknown }).count === "number") {
    return (embedded as { count: number }).count;
  }
  return 0;
}

/** A to-one embed as PostgREST returns it: an object, or (in older clients) a one-item list. */
function one<T>(embedded: T | T[] | null | undefined): T | null {
  if (Array.isArray(embedded)) return embedded[0] ?? null;
  return embedded ?? null;
}

type ListRow = {
  id: string;
  code: string;
  version: number;
  status: TemplateStatus;
  extends_code: string | null;
  product_type: ProductType;
  standard: Standard;
  client_id: string | null;
  manufacturer_id: string | null;
  source_file_path: string | null;
  coverage_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  name: unknown;
  clients: Named | Named[] | null;
  manufacturers: Maker | Maker[] | null;
  inspections: unknown;
};

export function toVersionSummary(row: ListRow): TemplateVersionSummary {
  const name = typeof row.name === "string" && row.name.trim() !== "" ? row.name.trim() : null;
  return {
    id: row.id,
    code: row.code,
    version: row.version,
    status: row.status,
    name,
    extendsCode: row.extends_code,
    productType: row.product_type,
    standard: row.standard,
    clientName: one(row.clients)?.name ?? null,
    clientId: row.client_id,
    manufacturerName: manufacturerName(one(row.manufacturers)),
    manufacturerId: row.manufacturer_id,
    usage: countOf(row.inspections),
    sourceFileName: row.source_file_path ? sourceFileName(row.source_file_path) : null,
    coverageConfirmed: row.coverage_confirmed_at !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Versions grouped by code, codes in alphabetical order, versions newest first. */
export function groupTemplates(versions: readonly TemplateVersionSummary[]): TemplateGroup[] {
  const byCode = new Map<string, TemplateVersionSummary[]>();
  for (const version of versions) byCode.set(version.code, [...(byCode.get(version.code) ?? []), version]);
  return [...byCode.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([code, list]) => {
      const sorted = [...list].sort((a, b) => b.version - a.version);
      const active = sorted.find((version) => version.status === "active") ?? null;
      return { code, name: active?.name ?? sorted.find((version) => version.name)?.name ?? null, active, versions: sorted };
    });
}

export type TemplateList = { ok: true; groups: TemplateGroup[] } | { ok: false };

export async function listTemplates(supabase: DatabaseClient): Promise<TemplateList> {
  const { data, error } = await supabase.from("templates").select(LIST_COLUMNS).order("code").order("version", { ascending: false });
  if (error) {
    console.error("[admin/templates] could not list templates", error.code, error.message);
    return { ok: false };
  }
  return { ok: true, groups: groupTemplates((data as unknown as ListRow[]).map(toVersionSummary)) };
}

/* ------------------------------------------------------------------ *
 * One version (BUILD_SPEC 4.2 rules 8 to 10)
 * ------------------------------------------------------------------ */

export type VersionOfCode = {
  id: string;
  version: number;
  status: TemplateStatus;
  usage: number;
  coverageConfirmedAt: string | null;
  /** The stored resolution's format, or null when the version has not resolved. */
  resolvedFormat: number | null;
  updatedAt: string;
};

export type ActiveTemplate = {
  id: string;
  code: string;
  version: number;
  productType: ProductType;
  standard: Standard;
  clientId: string | null;
  manufacturerId: string | null;
};

export type ParsedResolution =
  | { state: "missing" }
  | { state: "invalid"; issues: string[] }
  | { state: "ok"; template: ResolvedTemplate };

export type ParsedDefinition = { ok: true; definition: TemplateDefinition } | { ok: false; issues: string[] };

export type TemplateVersionDetail = {
  id: string;
  code: string;
  version: number;
  status: TemplateStatus;
  name: string | null;
  extendsCode: string | null;
  productType: ProductType;
  standard: Standard;
  clientId: string | null;
  clientName: string | null;
  manufacturerId: string | null;
  manufacturerName: string | null;
  sourceFilePath: string | null;
  coverageConfirmedAt: string | null;
  coverageConfirmedBy: string | null;
  createdAt: string;
  updatedAt: string;
  usage: number;
  definition: ParsedDefinition;
  resolution: ParsedResolution;
  /** Every version of this code, newest first. */
  versions: VersionOfCode[];
  /** Every active version of every code: for stale bases and scope ties. */
  activeTemplates: ActiveTemplate[];
};

const DETAIL_COLUMNS =
  "id, code, version, status, extends_code, product_type, standard, client_id, manufacturer_id, definition, resolved, source_file_path, coverage_confirmed_at, created_at, updated_at, clients(name), manufacturers(name, factory_name), inspections(count), confirmer:profiles!templates_coverage_confirmed_by_fkey(full_name, email)";

const VERSION_COLUMNS = "id, version, status, coverage_confirmed_at, updated_at, format:resolved->format, inspections(count)";

const ACTIVE_COLUMNS = "id, code, version, product_type, standard, client_id, manufacturer_id";

function issueLines(error: z.ZodError, limit = 8): string[] {
  const lines = error.issues.map((issue) => `${issue.path.map(String).join(".") || "(top level)"}: ${issue.message}`);
  return lines.length > limit ? [...lines.slice(0, limit), `and ${lines.length - limit} more`] : lines;
}

export function parseDefinition(value: unknown): ParsedDefinition {
  const parsed = TemplateDefinitionSchema.safeParse(value);
  return parsed.success ? { ok: true, definition: parsed.data } : { ok: false, issues: issueLines(parsed.error) };
}

export function parseResolution(value: unknown): ParsedResolution {
  if (value === null || value === undefined) return { state: "missing" };
  const parsed = ResolvedTemplateSchema.safeParse(value);
  return parsed.success ? { state: "ok", template: parsed.data } : { state: "invalid", issues: issueLines(parsed.error) };
}

/** The version, every version of its code and the active templates; null when it does not exist (or RLS hides it). */
export async function loadTemplateVersion(supabase: DatabaseClient, id: string): Promise<TemplateVersionDetail | null> {
  const { data: row, error } = await supabase.from("templates").select(DETAIL_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not read template ${id}: ${error.message}`);
  if (!row) return null;

  const [versions, active] = await Promise.all([
    supabase.from("templates").select(VERSION_COLUMNS).eq("code", row.code).order("version", { ascending: false }),
    supabase.from("templates").select(ACTIVE_COLUMNS).eq("status", "active"),
  ]);
  if (versions.error) throw new Error(`Could not read the versions of ${row.code}: ${versions.error.message}`);
  if (active.error) throw new Error(`Could not read the active templates: ${active.error.message}`);

  const definition = parseDefinition(row.definition);
  const rawName = (row.definition as { name?: unknown } | null)?.name;
  return {
    id: row.id,
    code: row.code,
    version: row.version,
    status: row.status,
    name: typeof rawName === "string" && rawName.trim() !== "" ? rawName.trim() : null,
    extendsCode: row.extends_code,
    productType: row.product_type,
    standard: row.standard,
    clientId: row.client_id,
    clientName: one(row.clients as Named | Named[] | null)?.name ?? null,
    manufacturerId: row.manufacturer_id,
    manufacturerName: manufacturerName(one(row.manufacturers as Maker | Maker[] | null)),
    sourceFilePath: row.source_file_path,
    coverageConfirmedAt: row.coverage_confirmed_at,
    coverageConfirmedBy: personName(
      one(row.confirmer as { full_name: string | null; email: string | null } | null | undefined),
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usage: countOf(row.inspections),
    definition,
    resolution: parseResolution(row.resolved),
    versions: (versions.data as unknown as (Omit<VersionOfCode, "usage" | "coverageConfirmedAt" | "resolvedFormat" | "updatedAt"> & {
      coverage_confirmed_at: string | null;
      updated_at: string;
      format: unknown;
      inspections: unknown;
    })[]).map((entry) => ({
      id: entry.id,
      version: entry.version,
      status: entry.status,
      usage: countOf(entry.inspections),
      coverageConfirmedAt: entry.coverage_confirmed_at,
      resolvedFormat: typeof entry.format === "number" ? entry.format : null,
      updatedAt: entry.updated_at,
    })),
    activeTemplates: active.data.map((entry) => ({
      id: entry.id,
      code: entry.code,
      version: entry.version,
      productType: entry.product_type,
      standard: entry.standard,
      clientId: entry.client_id,
      manufacturerId: entry.manufacturer_id,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Warnings about one version
 * ------------------------------------------------------------------ */

/** Bases whose active version moved on since this version was resolved (lib/templates staleBases). */
export function staleBasesOf(detail: Pick<TemplateVersionDetail, "resolution" | "activeTemplates">): StaleBase[] {
  if (detail.resolution.state !== "ok") return [];
  const active = new Map(detail.activeTemplates.map((entry) => [entry.code, entry.version]));
  return staleBases(detail.resolution.template, (code) => active.get(code) ?? null);
}

/**
 * Active templates of another code with exactly this version's scope: once
 * this one is active too, a new inspection for that scope gets whichever
 * code sorts first (lib/templates selectTemplate breaks the tie by code).
 */
export function scopeTies(
  detail: Pick<TemplateVersionDetail, "code" | "productType" | "clientId" | "manufacturerId" | "activeTemplates">,
): ActiveTemplate[] {
  return detail.activeTemplates
    .filter(
      (entry) =>
        entry.code !== detail.code &&
        entry.productType === detail.productType &&
        entry.clientId === detail.clientId &&
        entry.manufacturerId === detail.manufacturerId,
    )
    .sort((a, b) => a.code.localeCompare(b.code, "en"));
}

export type ConfigProblem = { key: ModuleKey; title: string; messages: string[] };

/**
 * Included modules whose stored config no longer fits the module as built
 * now: the engine parses `resolved.config` with the module's schema on every
 * run, so such a version would show a settings error on every inspection.
 * Stubs (modules not built yet) accept anything.
 */
export function configProblems(template: ResolvedTemplate, registry: ModuleRegistry): ConfigProblem[] {
  return template.modules.flatMap((entry) => {
    if (!entry.include) return [];
    const definition = registry[entry.key];
    if (!definition || definition.stub) return [];
    const parsed = definition.configSchema.safeParse(entry.config);
    return parsed.success ? [] : [{ key: entry.key, title: entry.title, messages: issueLines(parsed.error, 4) }];
  });
}

/** Reasons this version cannot be activated, in the order to fix them. Empty when it can. */
export function activationBlockers(
  detail: Pick<TemplateVersionDetail, "status" | "version" | "resolution" | "coverageConfirmedAt" | "sourceFilePath">,
  problems: readonly ConfigProblem[],
): string[] {
  if (detail.status === "active") return [];
  const blockers: string[] = [];
  if (detail.resolution.state === "missing") {
    blockers.push(`Version ${detail.version} has not resolved. Open it in the editor and save it without problems.`);
  } else if (detail.resolution.state === "invalid") {
    blockers.push(
      `Version ${detail.version} was resolved by an earlier build of the app and cannot be read now. Make a new version: it resolves again.`,
    );
  }
  if (problems.length > 0) {
    const names = problems.map((problem) => problem.title).join(", ");
    blockers.push(`Settings of ${names} no longer fit the module${problems.length === 1 ? "" : "s"}. Make a new version and fix them in the editor.`);
  }
  if (detail.sourceFilePath === null && detail.status !== "draft") {
    // Only a draft takes a source file, and the checklist is checked against it.
    blockers.push(
      `Version ${detail.version} has no source file, and only a draft takes one: make a new version, upload the form to it and confirm its checklist (BUILD_SPEC 4.2 rule 10).`,
    );
    return blockers;
  }
  if (detail.sourceFilePath === null) blockers.push("Upload the source form or report first (BUILD_SPEC 4.2 rule 10).");
  if (detail.coverageConfirmedAt === null) blockers.push("Confirm the coverage checklist first (BUILD_SPEC 4.2 rule 10).");
  return blockers;
}

/** planActivation over the versions as the page lists them. */
export function activationPlan(versions: readonly VersionOfCode[], targetId: string): ActivationPlan {
  return planActivation(
    versions.map((entry) => ({
      id: entry.id,
      version: entry.version,
      status: entry.status,
      coverageConfirmedAt: entry.coverageConfirmedAt,
      resolved: entry.resolvedFormat,
    })),
    targetId,
  );
}

/* ------------------------------------------------------------------ *
 * Modules as the version shows them (BUILD_SPEC 4.3)
 * ------------------------------------------------------------------ */

export type LabelView = {
  key: string;
  label: string;
  /** The template's wording, not the module's own. */
  changed: boolean;
};

export type ModuleView = {
  kind: "module";
  key: ModuleKey;
  /** 1-based place among the modules. */
  position: number;
  title: string;
  /** The module's own title, when the template words it differently. */
  defaultTitle: string | null;
  include: boolean;
  alwaysOn: boolean;
  /** A placeholder until the module is built: "Not built yet" on inspections. */
  notBuilt: boolean;
  labels: LabelView[];
  /** Fields this version's settings switch off, by label. */
  fieldsOff: string[];
};

export type CustomFieldView = {
  key: string;
  label: string;
  type: string;
  unit: string | null;
  required: boolean;
  options: string[];
  mapsTo: string | null;
};

export type CustomModuleView = {
  kind: "custom";
  key: string;
  title: string;
  after: ModuleKey;
  afterTitle: string;
  layout: CustomModule["layout"];
  fields: CustomFieldView[];
};

export type SectionView = ModuleView | CustomModuleView;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The module's own label for a key: the built module's, else the data dictionary's (STD_EG wording). */
function moduleDefaultLabel(registry: ModuleRegistry, key: ModuleKey, labelKey: string): string | undefined {
  return registry[key]?.labels[labelKey] ?? dictionaryLabels(key)[labelKey];
}

const dictionaryLabelCache = new Map<ModuleKey, Record<string, string>>();
function dictionaryLabels(key: ModuleKey): Record<string, string> {
  let labels = dictionaryLabelCache.get(key);
  if (!labels) {
    labels = defaultLabels(key);
    dictionaryLabelCache.set(key, labels);
  }
  return labels;
}

/**
 * A label in this version's wording: the template's, then the module's own,
 * then the data dictionary's, then the key itself. `keys` go most specific
 * first: a class or level's own wording (`cartonInspected`), then the field's
 * (`inspected`), so a group label nobody wrote falls back to the field's.
 */
function wordingOf(
  entry: ResolvedModule | undefined,
  key: ModuleKey,
  keys: string | readonly string[],
  registry?: ModuleRegistry,
): string {
  const candidates = typeof keys === "string" ? [keys] : keys;
  const lookups: ((labelKey: string) => string | undefined)[] = [
    (labelKey) => entry?.labels[labelKey],
    (labelKey) => (registry ? registry[key]?.labels[labelKey] : undefined),
    (labelKey) => dictionaryLabels(key)[labelKey],
  ];
  for (const lookup of lookups) {
    for (const labelKey of candidates) {
      const label = lookup(labelKey);
      if (label !== undefined && label.trim() !== "") return label;
    }
  }
  return candidates.at(-1) ?? "";
}

/** Data fields a module's settings switch off (BUILD_SPEC 6.1: fields, columns, measures on and off). */
function switchedOffFields(entry: ResolvedModule): string[] {
  const { config } = entry;
  const off = (switches: unknown) =>
    isRecord(switches) ? Object.entries(switches).filter(([, on]) => on === false).map(([field]) => field) : [];
  switch (entry.key) {
    case "header":
    case "glove_info":
    case "order_lots":
    case "packing_config":
    case "loading":
      return off(config.fields);
    case "sampling_plan":
      return off(config.columns);
    case "dimensions":
      return Array.isArray(config.measures)
        ? MEASURES.filter((measure) => !(config.measures as unknown[]).includes(measure))
        : [];
    default:
      return [];
  }
}

/**
 * Every module of the version in order, switched off ones included, with its
 * wording; each custom module right after the module it follows (its place
 * on the capture screen, lib/templates templateSections).
 */
export function sectionViews(template: ResolvedTemplate, registry: ModuleRegistry): SectionView[] {
  const after = new Map<ModuleKey, CustomModule[]>();
  for (const custom of template.customModules) after.set(custom.after, [...(after.get(custom.after) ?? []), custom]);
  const titleOf = (key: ModuleKey) => template.modules.find((entry) => entry.key === key)?.title ?? moduleSpec(key).title;

  const views: SectionView[] = [];
  template.modules.forEach((entry, index) => {
    const definition = registry[entry.key];
    const ownTitle = definition?.title ?? moduleSpec(entry.key).title;
    views.push({
      kind: "module",
      key: entry.key,
      position: index + 1,
      title: entry.title,
      defaultTitle: entry.title === ownTitle ? null : ownTitle,
      include: entry.include,
      alwaysOn: (ALWAYS_ON_MODULE_KEYS as readonly string[]).includes(entry.key),
      notBuilt: definition?.stub ?? true,
      labels: Object.entries(entry.labels)
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([key, label]) => {
          const own = moduleDefaultLabel(registry, entry.key, key);
          return { key, label, changed: own !== undefined ? own !== label : true };
        }),
      fieldsOff: switchedOffFields(entry).map((field) => wordingOf(entry, entry.key, field, registry)),
    });
    for (const custom of after.get(entry.key) ?? []) views.push(customView(custom, titleOf));
    after.delete(entry.key);
  });
  for (const orphans of after.values()) for (const custom of orphans) views.push(customView(custom, titleOf));
  return views;
}

function customView(custom: CustomModule, titleOf: (key: ModuleKey) => string): CustomModuleView {
  return {
    kind: "custom",
    key: custom.key,
    title: custom.title,
    after: custom.after,
    afterTitle: titleOf(custom.after),
    layout: custom.layout,
    fields: custom.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      unit: field.unit ?? null,
      required: field.required === true,
      options: field.options ?? [],
      mapsTo: field.mapsTo ?? null,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * The coverage checklist (BUILD_SPEC 4.2 rules 2 and 10)
 * ------------------------------------------------------------------ */

/**
 * Where the checklist's fields come from:
 * - `own`: the version's code is a seed template (STD_EG, SAFEDON_EG,
 *   STD_SG) and lib/coverage lists every field of the forms it is built from.
 *   Nothing may be lost: a field the version leaves out blocks confirmation.
 * - `base`: the version extends a seed template. Its own form is not in the
 *   inventory, so the checklist shows the base's forms as this version keeps
 *   them; fields left out are differences to check, not errors.
 * - `none`: no inventory at all. The admin checks the uploaded file against
 *   the modules and custom modules by hand.
 */
export type CoverageMode = "own" | "base" | "none";

/**
 * Where one source field goes: `place` is the module, custom module or
 * template part (shown muted), `text` the field within it, in this version's
 * wording; `reason` says why it is not kept.
 */
export type CoverageTarget = { place: string | null; text: string; covered: boolean; reason: string | null };

export type CoverageRow = {
  id: string;
  /** As printed on the source. */
  label: string;
  /** The app's wording where the source has a typo. */
  corrected: string | null;
  input: string;
  targets: CoverageTarget[];
  covered: boolean;
  notes: string | null;
};

export type CoverageSection = {
  /** `<source id>:<section slug>`: what the admin ticks. */
  key: string;
  name: string;
  rows: CoverageRow[];
  missing: number;
};

export type CoverageDocument = {
  id: SourceId;
  title: string;
  /** Path under docs/forms. */
  file: string;
  kind: "report" | "onsite";
  sections: CoverageSection[];
  fields: number;
  missing: number;
};

export type CoverageChecklist = {
  mode: CoverageMode;
  /** The seed template the fields come from (the version's own code, or its base). */
  inventoryCode: TemplateCode | null;
  documents: CoverageDocument[];
  fields: number;
  missing: number;
  /** True when a missing field must stop confirmation (own mode). */
  blocking: boolean;
  /** Every section key, in order: the ticks the confirmation needs. */
  sectionKeys: string[];
};

const INPUT_LABEL: Readonly<Record<SourceInput, string>> = {
  text: "Text",
  number: "Number",
  date: "Date",
  select: "Choice",
  size: "Size",
  signature: "Signature",
  blank: "Blank space",
  handwritten_rows: "Handwritten rows",
  computed: "Worked out",
  fixed: "Printed value",
  heading: "Heading",
  label: "Caption",
  repeat: "Repeated value",
  image: "Image",
  page: "Page layout",
};

function isTemplateCode(code: string): code is TemplateCode {
  return (TEMPLATE_CODES as readonly string[]).includes(code);
}

/** The seed template whose forms the checklist lists, and how. */
export function inventoryOf(template: Pick<ResolvedTemplate, "code" | "chain">): {
  mode: CoverageMode;
  code: TemplateCode | null;
} {
  if (isTemplateCode(template.code)) return { mode: "own", code: template.code };
  const base = template.chain.slice(1).find(isTemplateCode);
  return base ? { mode: "base", code: base } : { mode: "none", code: null };
}

/** "indicativeWeightSize" as "indicative weight size". */
function words(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.]+/g, " ")
    .toLowerCase()
    .trim();
}

function listHas(list: unknown, code: string): boolean {
  return Array.isArray(list) && list.some((item) => item === code || (isRecord(item) && item.code === code));
}

function listLabel(list: unknown, code: string): string | null {
  if (!Array.isArray(list)) return null;
  const found = list.find((item) => isRecord(item) && item.code === code);
  return isRecord(found) && typeof found.label === "string" ? found.label : null;
}

/** The coded list a keyed field counts against: hole locations, a class's defects, a level's checks. */
function keyedList(entry: ResolvedModule, field: string, group: string | undefined): { list: unknown; name: string } | null {
  const { config } = entry;
  const classes = isRecord(config.classes) ? config.classes : null;
  const levels = isRecord(config.levels) ? config.levels : null;
  switch (`${entry.key}.${field}`) {
    case "watertight.holes":
      return { list: config.locations, name: "hole locations" };
    case "visual.counts":
      return group && classes && isRecord(classes[group]) ? { list: classes[group].defects, name: `${group} defects` } : null;
    case "labeling.defects":
      return group && levels && isRecord(levels[group]) ? { list: levels[group].checks, name: `${group} checks` } : null;
    case "dispensing_safedon.counts":
      return { list: config.defects, name: "dispensing defects" };
    default:
      return null;
  }
}

/** AQL reads better in capitals. */
function settingWords(key: string): string {
  const text = words(key);
  return text === "aql" ? "AQL" : text;
}

/** Sizes the inventory's seed template prints that this version does not have. */
function sizesLost(template: ResolvedTemplate, inventory: TemplateCode | null): string[] {
  if (!inventory) return [];
  const have = new Set(template.sizes.map((size) => size.value));
  return TEMPLATES[inventory].sizes
    .map((size) => normaliseSize(size.value) ?? size.value)
    .filter((size) => !have.has(size));
}

function evaluateTarget(target: SourceTarget, template: ResolvedTemplate, inventory: TemplateCode | null): CoverageTarget {
  if (isTemplateTarget(target)) {
    switch (target.template) {
      case "sizes": {
        const text = `Sizes: ${template.sizes.map((size) => size.label).join(", ")}`;
        const lost = sizesLost(template, inventory);
        return lost.length === 0
          ? covered("Template", text)
          : missing(
              "Template",
              text,
              `${lost.length === 1 ? "Size" : "Sizes"} ${lost.join(", ")} of the form ${lost.length === 1 ? "is" : "are"} not in this version.`,
            );
      }
      case "unit":
        return covered("Template", `Unit: ${UNIT_LABEL[template.unit].toLowerCase()}`);
      case "report.titleLines":
        return covered("Report", `Title “${template.report.title}”`);
      case "report.showClientLogo":
        return covered("Report", `Client logo ${template.report.showClientLogo ? "shown" : "not shown"}`);
    }
  }
  if (isCustomTarget(target)) {
    const custom = template.customModules.find((entry) => entry.key === target.custom);
    if (!custom) {
      return missing(`Custom module ${target.custom}`, target.field, `This version has no custom module ${target.custom}.`);
    }
    const field = custom.fields.find((entry) => entry.key === target.field);
    const place = `Custom module ${custom.title}`;
    return field ? covered(place, field.label) : missing(place, target.field, `${custom.title} has no field ${target.field}.`);
  }
  if (!("module" in target)) return covered("Report layout", target.layout);

  const entry = template.modules.find((candidate) => candidate.key === target.module);
  const title = entry?.title ?? moduleSpec(target.module).title;
  const absent = !entry
    ? `${title} is not in this version.`
    : !entry.include
      ? `${title} is switched off in this version.`
      : null;

  if (isLabelTarget(target)) {
    const [place, text] =
      target.label === "title"
        ? [null, `Section title “${title}”`]
        : [title, `Caption “${wordingOf(entry, target.module, target.label)}”`];
    return absent ? missing(place, text, absent) : covered(place, text);
  }
  if (isConfigTarget(target)) {
    const value = entry?.config[target.config];
    const place = `${title} settings`;
    const text = `${settingWords(target.config)}${target.key ? ` › ${target.key}` : ""}`;
    if (absent) return missing(place, text, absent);
    if (target.key && Array.isArray(value) && !listHas(value, target.key)) {
      return missing(place, text, `${target.key} is not in ${title}'s ${settingWords(target.config)}.`);
    }
    const item = target.key && isRecord(value) ? value[target.key] : undefined;
    if (isRecord(item) && item.include === false) return missing(place, text, `${target.key} is switched off in ${title}.`);
    return covered(place, text);
  }
  if (isFieldTarget(target)) {
    const keys = target.group ? [groupLabelKey(target.field, target.group), target.field] : [target.field];
    let text = wordingOf(entry, target.module, keys);
    if (target.key && entry) {
      const list = keyedList(entry, target.field, target.group);
      const keyText =
        (list && listLabel(list.list, target.key)) ??
        labelFor(entry.labels, ...(target.group ? [target.group] : []), target.key);
      text = `${text} › ${keyText}`;
      if (absent) return missing(title, text, absent);
      if (list && Array.isArray(list.list) && !listHas(list.list, target.key)) {
        return missing(title, text, `${keyText} is not in ${title}'s ${list.name}.`);
      }
    }
    if (absent || !entry) return missing(title, text, absent ?? `${title} is not in this version.`);
    const off = fieldOff(entry, target.field, target.group);
    return off ? missing(title, text, off) : covered(title, text);
  }
  return covered(null, "Kept");
}

/** Why a field of an included module is not shown, or null when it is. Only when the config says so plainly. */
function fieldOff(entry: ResolvedModule, field: string, group: string | undefined): string | null {
  const { config, title } = entry;
  const switchOff = (switches: unknown, what: string) =>
    isRecord(switches) && switches[field] === false ? `${what} is switched off in ${title}.` : null;
  switch (entry.key) {
    case "header":
    case "glove_info":
    case "order_lots":
    case "packing_config":
    case "loading":
      return switchOff(config.fields, wordingOf(entry, entry.key, field));
    case "sampling_plan":
      return switchOff(config.columns, `The ${wordingOf(entry, entry.key, field)} column`);
    case "dimensions":
      return (MEASURES as readonly string[]).includes(field) &&
        Array.isArray(config.measures) &&
        !config.measures.includes(field)
        ? `${wordingOf(entry, entry.key, field)} is not measured in ${title}.`
        : null;
    case "visual": {
      if (!group || !(DEFECT_CLASSES as readonly string[]).includes(group) || !isRecord(config.classes)) return null;
      const settings = config.classes[group];
      return isRecord(settings) && settings.include === false ? `The ${group} class is switched off in ${title}.` : null;
    }
    case "labeling": {
      if (!group || !(LABELLING_LEVELS as readonly string[]).includes(group) || !isRecord(config.levels)) return null;
      const settings = config.levels[group];
      return isRecord(settings) && settings.include === false ? `The ${group} level is switched off in ${title}.` : null;
    }
    default:
      return null;
  }
}

function covered(place: string | null, text: string): CoverageTarget {
  return { place, text, covered: true, reason: null };
}

function missing(place: string | null, text: string, reason: string): CoverageTarget {
  return { place, text, covered: false, reason };
}

function coverageRow(field: SourceField, template: ResolvedTemplate, inventory: TemplateCode | null): CoverageRow {
  const targets = field.targets.map((target) => evaluateTarget(target, template, inventory));
  return {
    id: field.id,
    label: field.label,
    corrected: field.corrected ?? null,
    input: INPUT_LABEL[field.input],
    targets,
    covered: targets.every((target) => target.covered),
    notes: field.notes ?? null,
  };
}

/** The section a source field belongs to: its id up to the last colon (`<source>:<section slug>`). */
export function sectionKeyOf(field: Pick<SourceField, "id">): string {
  return field.id.slice(0, field.id.lastIndexOf(":"));
}

/** Every field of the version's source forms and where this version keeps it. */
export function coverageChecklist(template: ResolvedTemplate): CoverageChecklist {
  const { mode, code } = inventoryOf(template);
  const documents: CoverageDocument[] = (code ? TEMPLATES[code].builtFrom : []).map((source) => {
    const document = SOURCE_DOCUMENTS[source];
    // By key, in the order sections first appear: one tick per section even if its fields are not together.
    const byKey = new Map<string, CoverageSection>();
    for (const field of sourceFields(source)) {
      const key = sectionKeyOf(field);
      let section = byKey.get(key);
      if (!section) {
        section = { key, name: field.section, rows: [], missing: 0 };
        byKey.set(key, section);
      }
      const row = coverageRow(field, template, code);
      section.rows.push(row);
      if (!row.covered) section.missing += 1;
    }
    const sections = [...byKey.values()];
    const fields = sections.reduce((sum, section) => sum + section.rows.length, 0);
    const missingCount = sections.reduce((sum, section) => sum + section.missing, 0);
    return { id: source, title: document.title, file: document.file, kind: document.kind, sections, fields, missing: missingCount };
  });
  const missingTotal = documents.reduce((sum, document) => sum + document.missing, 0);
  return {
    mode,
    inventoryCode: code,
    documents,
    fields: documents.reduce((sum, document) => sum + document.fields, 0),
    missing: missingTotal,
    blocking: mode === "own" && missingTotal > 0,
    sectionKeys: documents.flatMap((document) => document.sections.map((section) => section.key)),
  };
}

/** Why coverage cannot be confirmed yet, or null when the admin may confirm it. */
export function coverageBlocker(
  detail: Pick<TemplateVersionDetail, "status" | "version" | "sourceFilePath" | "resolution" | "coverageConfirmedAt">,
  checklist: CoverageChecklist | null,
): string | null {
  if (detail.resolution.state !== "ok" || !checklist) {
    return "This version has not resolved, so there is nothing to check yet. Fix it in the editor first.";
  }
  if (detail.sourceFilePath === null) {
    return detail.status === "draft"
      ? "Upload the source form or report first: the checklist is checked against it."
      : `Version ${detail.version} has no source file to check against, and only a draft takes one. Make a new version, upload the form to it and confirm its checklist there.`;
  }
  if (checklist.blocking) {
    const count = checklist.missing;
    return `${count} ${count === 1 ? "field" : "fields"} of the source ${count === 1 ? "is" : "are"} not in this version. Nothing may be lost (BUILD_SPEC 4.2 rule 2): make a new version that keeps ${count === 1 ? "it" : "them"}, in a module or a custom module.`;
  }
  return null;
}

/** True when the ticked sections are exactly the checklist's: no section missed, none from another page. */
export function allSectionsTicked(checklist: CoverageChecklist, ticked: readonly string[]): boolean {
  const wanted = new Set(checklist.sectionKeys);
  const got = new Set(ticked);
  return wanted.size === got.size && [...wanted].every((key) => got.has(key));
}

/**
 * Why a version's source file cannot change, or null when it can: only a
 * draft that no inspection uses. An active or retired version was checked
 * and activated against its file; a new version takes a different one.
 * `hasFile` picks the words: a version that never had a file (one added
 * outside the app) gets one through a new version too.
 */
export function sourceChangeBlocker(row: {
  version: number;
  status: TemplateStatus;
  usage: number;
  hasFile: boolean;
}): string | null {
  const attach = row.hasFile
    ? "Make a new version to attach a different form."
    : "Make a new version and upload the form to it.";
  if (row.usage > 0) {
    return row.hasFile
      ? `Version ${row.version} is used by inspections, so its source file stays as it is. ${attach}`
      : `Version ${row.version} is used by inspections, so it can no longer change. ${attach}`;
  }
  if (row.status !== "draft") {
    const status = TEMPLATE_STATUS_LABEL[row.status].toLowerCase();
    return row.hasFile
      ? `Version ${row.version} is ${status}, so its source file stays as it was checked. ${attach}`
      : `Version ${row.version} is ${status}, and only a draft takes a source file. ${attach}`;
  }
  return null;
}

/** sourceChangeBlocker() for a row as the actions read it. */
export function sourceChangeBlockerOf(row: {
  version: number;
  status: TemplateStatus;
  usage: number;
  source_file_path: string | null;
}): string | null {
  return sourceChangeBlocker({ ...row, hasFile: row.source_file_path !== null });
}

/** `value` (a definition or a resolved template) naming `path` as its source file. */
export function withSourceFile(value: Json | null, path: string): Json | null {
  if (!isRecord(value)) return value;
  return { ...(value as Record<string, Json | undefined>), sourceFile: path };
}

/* ------------------------------------------------------------------ *
 * New version (BUILD_SPEC 4.2 rule 8)
 * ------------------------------------------------------------------ */

/**
 * The definition a new version starts from: a copy of this one, with the
 * source file this version holds (the column is what the screens keep
 * current), so the new draft is checked against the same form.
 */
export function definitionForNewVersion(definition: Json, sourceFilePath: string | null): Record<string, Json | undefined> {
  const copy = structuredClone(isRecord(definition) ? (definition as Record<string, Json | undefined>) : {});
  if (sourceFilePath) copy.sourceFile = sourceFilePath;
  else delete copy.sourceFile;
  return copy;
}

/** The next version number of a code. */
export function nextVersionOf(versions: readonly { version: number }[]): number {
  return nextVersion(versions.map((entry) => entry.version));
}

/** The columns of the version a new version is made from that its row copies. */
export type NewVersionSource = Pick<
  TablesInsert<"templates">,
  "code" | "extends_code" | "product_type" | "standard" | "client_id" | "manufacturer_id"
>;

/**
 * The row of a new draft version: the copied definition, its resolution (or
 * null when it does not resolve: the editor lists the problems), and the
 * scope columns from the definition as lib/templates templateRowFields()
 * writes them, or from the version it was made from when the definition
 * does not parse. Coverage starts unconfirmed: each version is checked.
 */
export function newVersionRow(
  source: NewVersionSource,
  definition: Record<string, Json | undefined>,
  resolved: ResolvedTemplate | null,
  version: number,
): TablesInsert<"templates"> {
  const parsed = TemplateDefinitionSchema.safeParse(definition);
  const scope = parsed.success
    ? {
        extends_code: parsed.data.extends ?? null,
        product_type: parsed.data.scope.productType,
        standard: parsed.data.scope.standard,
        client_id: parsed.data.scope.clientId ?? null,
        manufacturer_id: parsed.data.scope.manufacturerId ?? null,
      }
    : {
        extends_code: source.extends_code ?? null,
        product_type: source.product_type,
        standard: source.standard,
        client_id: source.client_id ?? null,
        manufacturer_id: source.manufacturer_id ?? null,
      };
  return {
    code: source.code,
    version,
    status: "draft",
    ...scope,
    definition,
    resolved: (resolved ?? null) as Json | null,
    source_file_path: typeof definition.sourceFile === "string" ? definition.sourceFile : null,
    coverage_confirmed_by: null,
    coverage_confirmed_at: null,
  };
}

function extendsOf(definition: unknown): string | null {
  return isRecord(definition) && typeof definition.extends === "string" ? definition.extends : null;
}

/**
 * The bases of a definition, down its extends chain: each base's active
 * version, or its highest version when none is active. The lookup
 * resolveTemplate() needs.
 */
export async function loadBases(supabase: DatabaseClient, definition: unknown): Promise<TemplateLookup> {
  const bases: TemplateBase[] = [];
  const seen = new Set<string>();
  let code = extendsOf(definition);
  while (code && !seen.has(code) && seen.size < MAX_EXTENDS_DEPTH) {
    seen.add(code);
    const { data, error } = await supabase
      .from("templates")
      .select("version, status, definition")
      .eq("code", code)
      .order("version", { ascending: false });
    if (error) throw new Error(`Could not read base template ${code}: ${error.message}`);
    const chosen = data.find((row) => row.status === "active") ?? data[0];
    if (!chosen) break;
    bases.push({ definition: chosen.definition, version: chosen.version });
    code = extendsOf(chosen.definition);
  }
  return lookupFrom(bases);
}

/* ------------------------------------------------------------------ *
 * Storage helpers
 * ------------------------------------------------------------------ */

/** True when the object exists (the browser finished its upload). */
export async function sourceFileExists(supabase: DatabaseClient, path: string): Promise<boolean> {
  const { data, error } = await supabase.storage.from(SOURCE_BUCKET).exists(path);
  if (error && !data) {
    console.error("[admin/templates] could not check a source file", error.message);
    return false;
  }
  return data === true;
}

export type SourceFileInfo = { name: string; size: number | null; uploadedAt: string | null; missing: boolean };

/** What the page says about a stored source file. A missing object is reported, never thrown. */
export async function sourceFileInfo(supabase: DatabaseClient, path: string): Promise<SourceFileInfo> {
  const { data, error } = await supabase.storage.from(SOURCE_BUCKET).info(path);
  if (error || !data) return { name: sourceFileName(path), size: null, uploadedAt: null, missing: true };
  const size = typeof data.size === "number" ? data.size : null;
  const uploadedAt = typeof data.createdAt === "string" ? data.createdAt : typeof data.lastModified === "string" ? data.lastModified : null;
  return { name: sourceFileName(path), size, uploadedAt, missing: false };
}

/**
 * Which stored uploads of a version can go: the file a replace took over
 * from (`previous`) at once, any other upload once it is an hour old (a
 * browser that closed half-way; a younger one may still be on its way to
 * being confirmed). Never `keep`, never a file a template row still names
 * (a new version copies its source file).
 */
export function unusedSources(
  candidates: readonly { path: string; createdAt: number | null }[],
  { keep, previous, inUse, now }: { keep: string; previous: string | null; inUse: ReadonlySet<string>; now: number },
): string[] {
  return candidates
    .filter((candidate) => candidate.path !== keep && !inUse.has(candidate.path))
    .filter(
      (candidate) =>
        candidate.path === previous || (candidate.createdAt !== null && now - candidate.createdAt > ABANDONED_UPLOAD_MS),
    )
    .map((candidate) => candidate.path);
}

/**
 * Removes the uploads of one version that unusedSources() lets go. Failures
 * are logged: a leftover file in a private bucket harms nothing.
 */
export async function removeUnusedSources(
  supabase: DatabaseClient,
  template: { code: string; version: number },
  { keep, previous }: { keep: string; previous: string | null },
  now: number = Date.now(),
): Promise<void> {
  const folder = sourceFolder(template);
  const { data: uploads, error } = await supabase.storage.from(SOURCE_BUCKET).list(folder, { limit: 1000 });
  if (error) {
    console.error("[admin/templates] could not list source uploads", folder, error.message);
    return;
  }
  const candidates: { path: string; createdAt: number | null }[] = [];
  for (const upload of uploads) {
    // Folders come back without an id; each upload sits in its own folder.
    if (upload.id !== null) continue;
    const inner = `${folder}/${upload.name}`;
    const { data: files, error: listError } = await supabase.storage.from(SOURCE_BUCKET).list(inner, { limit: 100 });
    if (listError) continue;
    for (const file of files) {
      if (file.id === null) continue;
      const path = `${inner}/${file.name}`;
      if (path === keep) continue;
      candidates.push({ path, createdAt: file.created_at ? Date.parse(file.created_at) : null });
    }
  }
  if (candidates.length === 0) return;

  const { data: used, error: usedError } = await supabase
    .from("templates")
    .select("source_file_path")
    .in(
      "source_file_path",
      candidates.map((candidate) => candidate.path),
    );
  if (usedError) {
    console.error("[admin/templates] could not check which source files are in use", usedError.message);
    return;
  }
  const inUse = new Set(used.flatMap((row) => (row.source_file_path ? [row.source_file_path] : [])));
  const remove = unusedSources(candidates, { keep, previous, inUse, now });
  if (remove.length === 0) return;
  const { error: removeError } = await supabase.storage.from(SOURCE_BUCKET).remove(remove);
  if (removeError) console.error("[admin/templates] could not remove unused source files", removeError.message);
}
