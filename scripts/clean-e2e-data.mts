/**
 * Lists, and with --apply deletes, what end-to-end runs left behind in the
 * Supabase project they share (e2e/README.md): templates whose code starts
 * with E2E_, every inspection that uses one, with its photos and files and
 * their Storage objects, and the templates' source files. A run that crashed
 * leaves these; the specs' own teardown removes them otherwise.
 *
 *   npm run clean:e2e                       list what would go; delete nothing
 *   npm run clean:e2e -- --apply            delete it
 *   npm run clean:e2e -- --apply --min-age 0
 *
 * Options:
 *   --apply          delete; without it the run only lists
 *   --min-age <min>  leave templates and inspections younger than this many
 *                    minutes alone (default 60): a run may be using them now
 *   --only <prefix>  only templates whose code starts with this (itself
 *                    starting with E2E_), e.g. --only E2E_TEMPLATES
 *
 * With --apply, template by template:
 *   1. each of its inspections: its objects in inspection-photos and
 *      inspection-files (the <inspection id>/ folder), then the inspection
 *      through delete_test_inspection(), approved ones included. Its photo
 *      and file rows, AI reviews and audit rows go with it, and the database
 *      records a 'deleted' audit row (admins only) that stays;
 *   2. its source files in template-sources (<code>/v<version>/);
 *   3. the template itself.
 * An inspection whose inspector is not a test account (an @test.local
 * address) is listed and kept, since delete_test_inspection() refuses it, and
 * so is its template: delete those by hand if they really are a test's.
 *
 * Never touched: other templates, clients, manufacturers, defect codes and
 * accounts. Clients, manufacturers and accounts that look like e2e leftovers
 * are listed at the end, to delete by hand once nothing uses them. Ref
 * numbers that e2e runs drew are not given back (docs/DATABASE.md).
 *
 * Needs Node 22.18+ (built-in TypeScript, so no path aliases here) and
 * NEXT_PUBLIC_SUPABASE_URL plus SUPABASE_SECRET_KEY in .env.local.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types";

/* ------------------------------------------------------------------ *
 * What e2e runs leave
 * ------------------------------------------------------------------ */

/** Template codes the specs use: E2E_NEW, E2E_CAPTURE, E2E_TEMPLATES_<run>_ROOT... */
export const E2E_CODE_PREFIX = "E2E_";
/** The buckets that hold an inspection's photos and files, under <inspection id>/. */
export const INSPECTION_BUCKETS = ["inspection-photos", "inspection-files"] as const;
/** Template source forms, under <code>/v<version>/. */
export const SOURCE_BUCKET = "template-sources";
/** delete_test_inspection() deletes only the inspections of these inspectors. */
export const TEST_ACCOUNT_DOMAIN = "@test.local";
export const DEFAULT_MIN_AGE_MINUTES = 60;

type TemplateStatus = Database["public"]["Enums"]["template_status"];
type InspectionStatus = Database["public"]["Enums"]["inspection_status"];

export type E2eTemplate = { id: string; code: string; version: number; status: TemplateStatus; createdAt: string };

export type E2eInspection = {
  id: string;
  refNo: string;
  status: InspectionStatus;
  templateId: string;
  createdAt: string;
  /** The inspector's email, null when it cannot be read. */
  inspector: string | null;
  photos: number;
  files: number;
};

/** Rows that look like e2e leftovers but are never deleted here. */
export type Untouched = { clients: string[]; manufacturers: string[]; accounts: string[] };

export function isE2eCode(code: string): boolean {
  return code.startsWith(E2E_CODE_PREFIX);
}

export function isTestAccount(email: string | null): boolean {
  return email !== null && email.trim().toLowerCase().endsWith(TEST_ACCOUNT_DOMAIN);
}

/* ------------------------------------------------------------------ *
 * Planning: pure, so it is tested without a database
 * ------------------------------------------------------------------ */

/** Why a row stays, or null when it goes. */
export type Keep = string | null;

export type PlannedInspection = { inspection: E2eInspection; keep: Keep };
export type PlannedTemplate = { template: E2eTemplate; inspections: PlannedInspection[]; keep: Keep };
export type CleanupPlan = PlannedTemplate[];

export type PlanOptions = {
  now: Date;
  minAgeMinutes: number;
  /** Only codes that start with this; it must itself start with E2E_. */
  only?: string;
};

/** "created just now", "created 1 minute ago", "created 25 minutes ago". */
function age(createdAt: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(createdAt)) / 60_000));
  if (minutes === 0) return "created just now";
  return `created ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
}

function isYoung(createdAt: string, { now, minAgeMinutes }: PlanOptions): boolean {
  const created = Date.parse(createdAt);
  return Number.isNaN(created) || now.getTime() - created < minAgeMinutes * 60_000;
}

/** Whether a template is one this run looks at: an E2E_ code, starting with --only's prefix when given. */
export function inScope({ only = E2E_CODE_PREFIX }: Pick<PlanOptions, "only">): (template: Pick<E2eTemplate, "code">) => boolean {
  if (!isE2eCode(only)) throw new Error(`--only takes a code prefix that starts with ${E2E_CODE_PREFIX}, not "${only}".`);
  return (template) => isE2eCode(template.code) && template.code.startsWith(only);
}

/**
 * What goes and what stays. A young template stays with all its
 * inspections; an old one goes once every inspection of it can go: none
 * young, none of an account that is not a test account.
 */
export function planCleanup(
  templates: readonly E2eTemplate[],
  inspections: readonly E2eInspection[],
  options: PlanOptions,
): CleanupPlan {
  const sorted = templates.filter(inScope(options));
  sorted.sort((a, b) => a.code.localeCompare(b.code) || a.version - b.version);
  return sorted.map((template) => {
    const own = inspections
      .filter((inspection) => inspection.templateId === template.id)
      .sort((a, b) => a.refNo.localeCompare(b.refNo));
    if (isYoung(template.createdAt, options)) {
      const keep = `template ${age(template.createdAt, options.now)}`;
      return { template, keep, inspections: own.map((inspection) => ({ inspection, keep })) };
    }
    const planned = own.map((inspection): PlannedInspection => {
      if (!isTestAccount(inspection.inspector)) {
        return { inspection, keep: `not a test account's (${inspection.inspector ?? "inspector unknown"})` };
      }
      if (isYoung(inspection.createdAt, options)) return { inspection, keep: age(inspection.createdAt, options.now) };
      return { inspection, keep: null };
    });
    const kept = planned.filter((entry) => entry.keep !== null).length;
    return {
      template,
      inspections: planned,
      keep: kept === 0 ? null : `${kept} of its inspection${kept === 1 ? "" : "s"} stay${kept === 1 ? "s" : ""}`,
    };
  });
}

/** The folder of one version's source files in template-sources (lib/admin/templates.ts sourceFolder). */
export function sourceFolder(template: Pick<E2eTemplate, "code" | "version">): string {
  return `${template.code}/v${template.version}`;
}

/* ------------------------------------------------------------------ *
 * Running it
 * ------------------------------------------------------------------ */

/** What the cleanup needs from the project; main() binds it to Supabase with the secret key. */
export type CleanDatabase = {
  /** Templates whose code starts with E2E (the plan keeps E2E_ only). */
  templates(): Promise<E2eTemplate[]>;
  inspections(templateIds: readonly string[]): Promise<E2eInspection[]>;
  untouched(): Promise<Untouched>;
  /** Every object under a folder of a bucket, at any depth. */
  listObjects(bucket: string, folder: string): Promise<string[]>;
  removeObjects(bucket: string, paths: readonly string[]): Promise<void>;
  /** False when it was already gone (a spec's own teardown may get there first). */
  deleteInspection(id: string): Promise<boolean>;
  /** False when it was already gone. */
  deleteTemplate(id: string): Promise<boolean>;
};

export type CleanOptions = PlanOptions & { apply: boolean };

export type CleanReport = {
  plan: CleanupPlan;
  untouched: Untouched;
  /** What --apply removed; all zero on a listing. */
  deleted: { templates: number; inspections: number; objects: number };
  /** One line per step that failed: its template stays. */
  failures: string[];
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Every object of one inspection: its folder in each inspection bucket. */
async function inspectionObjects(db: CleanDatabase, inspectionId: string) {
  const found: { bucket: string; paths: string[] }[] = [];
  for (const bucket of INSPECTION_BUCKETS) found.push({ bucket, paths: await db.listObjects(bucket, inspectionId) });
  return found;
}

/**
 * Lists what e2e runs left; with `apply`, deletes it template by template:
 * the inspections that can go (their Storage objects first), then, when all
 * of them went, the template's source files and the template. A failure
 * keeps that template and goes on with the next.
 */
export async function cleanE2eData(db: CleanDatabase, options: CleanOptions): Promise<CleanReport> {
  const templates = (await db.templates()).filter(inScope(options));
  const inspections = templates.length > 0 ? await db.inspections(templates.map((template) => template.id)) : [];
  const plan = planCleanup(templates, inspections, options);
  const untouched = await db.untouched();
  const deleted = { templates: 0, inspections: 0, objects: 0 };
  const failures: string[] = [];
  if (!options.apply) return { plan, untouched, deleted, failures };

  for (const entry of plan) {
    let allGone = true;
    for (const { inspection, keep } of entry.inspections) {
      if (keep !== null) {
        allGone = false;
        continue;
      }
      try {
        for (const { bucket, paths } of await inspectionObjects(db, inspection.id)) {
          if (paths.length === 0) continue;
          await db.removeObjects(bucket, paths);
          deleted.objects += paths.length;
        }
        if (await db.deleteInspection(inspection.id)) deleted.inspections += 1;
      } catch (error) {
        allGone = false;
        failures.push(`${inspection.refNo} (${entry.template.code} v${entry.template.version}): ${messageOf(error)}`);
      }
    }
    if (entry.keep !== null || !allGone) continue;
    try {
      const sources = await db.listObjects(SOURCE_BUCKET, sourceFolder(entry.template));
      if (sources.length > 0) {
        await db.removeObjects(SOURCE_BUCKET, sources);
        deleted.objects += sources.length;
      }
      if (await db.deleteTemplate(entry.template.id)) deleted.templates += 1;
    } catch (error) {
      failures.push(`${entry.template.code} v${entry.template.version}: ${messageOf(error)}`);
    }
  }
  return { plan, untouched, deleted, failures };
}

/* ------------------------------------------------------------------ *
 * Saying it
 * ------------------------------------------------------------------ */

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The listing: one line per template and per inspection, what goes and why the rest stays. */
export function describePlan(plan: CleanupPlan, apply: boolean, only: string = E2E_CODE_PREFIX): string[] {
  const which = only === E2E_CODE_PREFIX ? "an E2E_ code" : `a code starting ${only}`;
  if (plan.length === 0) return [`No templates with ${which}: nothing to clean up.`];
  const verb = apply ? "deleted" : "to delete";
  const lines = [`Templates with ${which}: ${plan.length}`];
  for (const { template, inspections, keep } of plan) {
    const head = `${template.code} v${template.version}`.padEnd(32);
    lines.push(`  ${head} ${template.status.padEnd(7)}  ${count(inspections.length, "inspection").padEnd(14)}  ${keep ? `kept: ${keep}` : verb}`);
  }
  const all = plan.flatMap((entry) => entry.inspections.map((planned) => ({ ...planned, template: entry.template })));
  lines.push(`Inspections of those templates: ${all.length}`);
  for (const { inspection, keep, template } of all) {
    const media = [count(inspection.photos, "photo"), count(inspection.files, "file")].join(", ");
    lines.push(
      `  ${inspection.refNo.padEnd(15)} ${inspection.status.padEnd(9)}  ${`${template.code} v${template.version}`.padEnd(32)} ${media.padEnd(18)}  ${keep ? `kept: ${keep}` : verb}`,
    );
  }
  return lines;
}

/** Leftovers this script never deletes, by name. */
export function describeUntouched(untouched: Untouched): string[] {
  const groups = [
    ["clients", untouched.clients],
    ["manufacturers", untouched.manufacturers],
    ["accounts", untouched.accounts],
  ] as const;
  const listed = groups.filter(([, names]) => names.length > 0);
  if (listed.length === 0) return [];
  return [
    "Not touched here, though e2e runs may have left them: delete by hand once nothing uses them.",
    ...listed.map(([what, names]) => `  ${what}: ${names.join("; ")}`),
  ];
}

/** The last lines: what happened, or how to make it happen (`applyArgs`: the options to run again with). */
export function describeResult(report: CleanReport, apply: boolean, applyArgs = "--apply"): string[] {
  const toDelete = report.plan.filter((entry) => entry.keep === null).length;
  const inspections = report.plan.flatMap((entry) => entry.inspections).filter((entry) => entry.keep === null).length;
  if (!apply) {
    if (toDelete === 0 && inspections === 0) return ["Nothing to delete."];
    return [
      `Listed only: nothing was deleted. npm run clean:e2e -- ${applyArgs} deletes ${count(inspections, "inspection")} and ${count(toDelete, "template")}.`,
    ];
  }
  const { deleted, failures } = report;
  const lines = [
    `Deleted ${count(deleted.inspections, "inspection")}, ${count(deleted.templates, "template")} and ${count(deleted.objects, "Storage object")}.`,
  ];
  if (failures.length > 0) lines.push("Failed (those templates stay):", ...failures.map((failure) => `  ${failure}`));
  return lines;
}

/* ------------------------------------------------------------------ *
 * Supabase
 * ------------------------------------------------------------------ */

/** The data of a Supabase answer, or an error naming what failed. */
function dataOf<T>(what: string, result: { data: T | null; error: { message: string } | null }): T {
  if (result.error || result.data === null) throw new Error(`${what} failed: ${result.error?.message ?? "no data"}`);
  return result.data;
}

const PAGE = 1000;
const REMOVE_BATCH = 100;

function supabaseDatabase(url: string, secretKey: string): CleanDatabase {
  const supabase = createClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  async function listObjects(bucket: string, folder: string): Promise<string[]> {
    const paths: string[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const entries = dataOf(
        `Listing ${bucket}/${folder}`,
        await supabase.storage.from(bucket).list(folder, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } }),
      );
      for (const entry of entries) {
        const path = `${folder}/${entry.name}`;
        // Folders come back without an id.
        if (entry.id === null) paths.push(...(await listObjects(bucket, path)));
        else paths.push(path);
      }
      if (entries.length < PAGE) return paths;
    }
  }

  return {
    templates: async () => {
      const rows = dataOf(
        "Reading templates",
        await supabase.from("templates").select("id, code, version, status, created_at").like("code", "E2E%"),
      );
      return rows.map((row) => ({ id: row.id, code: row.code, version: row.version, status: row.status, createdAt: row.created_at }));
    },
    inspections: async (templateIds) => {
      const rows = dataOf(
        "Reading inspections",
        await supabase
          .from("inspections")
          .select(
            "id, ref_no, status, template_id, created_at, inspector:profiles!inspections_inspector_id_fkey(email), inspection_photos(count), inspection_files(count)",
          )
          .in("template_id", [...templateIds]),
      );
      return rows.map((row) => ({
        id: row.id,
        refNo: row.ref_no,
        status: row.status,
        templateId: row.template_id,
        createdAt: row.created_at,
        inspector: row.inspector?.email ?? null,
        photos: row.inspection_photos[0]?.count ?? 0,
        files: row.inspection_files[0]?.count ?? 0,
      }));
    },
    untouched: async () => {
      const [clients, manufacturers, accounts] = await Promise.all([
        supabase.from("clients").select("name").like("name", "E2E%").order("name"),
        supabase.from("manufacturers").select("name").like("name", "E2E%").order("name"),
        supabase.from("profiles").select("email").like("email", "e2e-%@test.local").order("email"),
      ]);
      return {
        clients: dataOf("Reading clients", clients).map((row) => row.name),
        manufacturers: dataOf("Reading manufacturers", manufacturers).map((row) => row.name),
        accounts: dataOf("Reading accounts", accounts).flatMap((row) => (row.email ? [row.email] : [])),
      };
    },
    listObjects,
    removeObjects: async (bucket, paths) => {
      for (let start = 0; start < paths.length; start += REMOVE_BATCH) {
        dataOf(`Removing objects from ${bucket}`, await supabase.storage.from(bucket).remove(paths.slice(start, start + REMOVE_BATCH)));
      }
    },
    // Only the service role may call it, and only for inspections of @test.local inspectors (docs/DATABASE.md).
    deleteInspection: async (id) =>
      dataOf(`Deleting inspection ${id}`, await supabase.rpc("delete_test_inspection", { inspection_id: id })),
    deleteTemplate: async (id) =>
      dataOf(`Deleting template ${id}`, await supabase.from("templates").delete().eq("id", id).select("id")).length > 0,
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      apply: { type: "boolean", default: false },
      "min-age": { type: "string", default: String(DEFAULT_MIN_AGE_MINUTES) },
      only: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log("npm run clean:e2e -- [--apply] [--min-age <minutes>] [--only <E2E_ code prefix>]");
    console.log("What it deletes, and in which order: the comment at the top of scripts/clean-e2e-data.mts.");
    return;
  }
  const minAgeMinutes = Number(values["min-age"]);
  if (!/^\d+$/.test(values["min-age"]) || !Number.isSafeInteger(minAgeMinutes)) {
    console.error(`--min-age takes whole minutes, 0 or more, not "${values["min-age"]}".`);
    process.exit(1);
  }
  const only = values.only?.trim() || undefined;
  if (only !== undefined && !isE2eCode(only)) {
    console.error(`--only takes a code prefix that starts with ${E2E_CODE_PREFIX}, not "${only}".`);
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secretKey) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.");
    process.exit(1);
  }

  const apply = values.apply;
  const scope = only ? `templates ${only}*` : "E2E leftovers";
  console.log(`${scope} in ${new URL(url).hostname}${apply ? "" : " (listing only)"}:`);
  const report = await cleanE2eData(supabaseDatabase(url, secretKey), { apply, now: new Date(), minAgeMinutes, only });
  for (const line of [...describePlan(report.plan, apply, only), ...describeUntouched(report.untouched)]) console.log(line);
  console.log("");
  const applyArgs = [
    "--apply",
    ...(minAgeMinutes === DEFAULT_MIN_AGE_MINUTES ? [] : ["--min-age", String(minAgeMinutes)]),
    ...(only ? ["--only", only] : []),
  ].join(" ");
  for (const line of describeResult(report, apply, applyArgs)) console.log(line);
  if (report.failures.length > 0) process.exit(1);
}

// Run only when started as a script, so tests can import the functions above.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
