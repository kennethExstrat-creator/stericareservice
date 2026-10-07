import "server-only";

// Reading a template version for the editor, as the signed-in admin (RLS:
// admins read every template and inspection). The page and the save action
// both start here, so the action resolves against the same bases the admin
// saw, read again at the moment of saving.
import { cache } from "react";
import { ResolvedTemplateSchema } from "@/lib/schemas/template";
import { staleBases, type StaleBase, type TemplateBase, type TemplateStatus } from "@/lib/templates";
import { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type VersionSummary = { id: string; version: number; status: TemplateStatus };

export type EditorTemplate = {
  id: string;
  code: string;
  version: number;
  status: TemplateStatus;
  /** As stored: usually a TemplateDefinition, but the editor copes with anything. */
  definition: Record<string, unknown>;
  updatedAt: string;
  /** Inspections that use this version: one or more freezes it (BUILD_SPEC 4.2 rule 8). */
  inUse: number;
  coverageConfirmedAt: string | null;
  sourceFilePath: string | null;
  /** Every version of this code, oldest first. */
  versions: VersionSummary[];
  /** The bases this version was last resolved against that have a newer active version since. */
  stale: StaleBase[];
  /**
   * Its stored resolution: none ("missing": a seed, an import, a copy that
   * did not resolve then), one this build cannot read ("invalid"), or "ok".
   * Only a save writes a new one, so the editor offers Save for the first two.
   */
  resolution: "ok" | "missing" | "invalid";
};

/** One template version, or null when there is none with that id. */
export const loadEditorTemplate = cache(async (id: string): Promise<EditorTemplate | null> => {
  const supabase = await createClient();
  const { data: row, error } = await readTwice(() =>
    supabase
      .from("templates")
      .select("id, code, version, status, definition, resolved, updated_at, coverage_confirmed_at, source_file_path")
      .eq("id", id)
      .maybeSingle(),
  );
  if (error) throw new Error(`Could not read template ${id}: ${error.message}`);
  if (!row) return null;

  const [usage, versions, actives] = await Promise.all([
    readTwice(() => supabase.from("inspections").select("id", { count: "exact", head: true }).eq("template_id", id)),
    readTwice(() => supabase.from("templates").select("id, version, status").eq("code", row.code).order("version")),
    readTwice(() => supabase.from("templates").select("code, version").eq("status", "active")),
  ]);
  if (usage.error) throw new Error(`Could not count the inspections of template ${id}: ${usage.error.message}`);
  if (versions.error) throw new Error(`Could not read the versions of ${row.code}: ${versions.error.message}`);

  const activeVersion = new Map((actives.data ?? []).map((entry) => [entry.code, entry.version]));
  const stored = ResolvedTemplateSchema.safeParse(row.resolved);
  const definition = isRecord(row.definition) ? row.definition : {};

  return {
    id: row.id,
    code: row.code,
    version: row.version,
    status: row.status,
    // A source file uploaded to the template record (4.2 rule 10) is kept in the definition too.
    definition:
      row.source_file_path && definition.sourceFile === undefined
        ? { ...definition, sourceFile: row.source_file_path }
        : definition,
    updatedAt: row.updated_at,
    inUse: usage.count ?? 0,
    coverageConfirmedAt: row.coverage_confirmed_at,
    sourceFilePath: row.source_file_path,
    versions: versions.data,
    stale: stored.success ? staleBases(stored.data, (code) => activeVersion.get(code)) : [],
    resolution: row.resolved === null ? "missing" : stored.success ? "ok" : "invalid",
  };
});

/**
 * The active version of every template: what `extends` resolves against
 * (lib/templates TemplateLookup, "usually its active version"). Templates are
 * few, so all of them come along and the JSON view can point `extends`
 * anywhere.
 */
export async function loadActiveBases(supabase?: Supabase): Promise<TemplateBase[]> {
  const client = supabase ?? (await createClient());
  const { data, error } = await readTwice(() => client.from("templates").select("definition, version").eq("status", "active"));
  if (error) throw new Error(`Could not read the active templates: ${error.message}`);
  return data.map((row) => ({ definition: row.definition, version: row.version }));
}

type ReadResult = { error: { code?: string; message: string } | null };

/**
 * A read, tried once more after a short pause when the database answers with
 * a passing failure (a timeout or a 5xx while the shared project is busy).
 * Only for reads: a refused write is never repeated.
 */
export async function readTwice<T extends ReadResult>(query: () => PromiseLike<T>): Promise<T> {
  const first = await query();
  if (!first.error || !isPassing(first.error)) return first;
  await new Promise((resolve) => setTimeout(resolve, 400));
  return query();
}

function isPassing(error: { code?: string; message: string }): boolean {
  return (
    !error.code ||
    /^(5|08|57)/.test(error.code) ||
    /internal server error|timeout|timed out|fetch failed|network/i.test(error.message)
  );
}

export type ReferenceOption = { id: string; name: string };

/** Clients and manufacturers a template can be scoped to (BUILD_SPEC 4.4), by name. */
export async function loadScopeOptions(
  supabase?: Supabase,
): Promise<{ clients: ReferenceOption[]; manufacturers: ReferenceOption[] }> {
  const client = supabase ?? (await createClient());
  const [clients, manufacturers] = await Promise.all([
    readTwice(() => client.from("clients").select("id, name").order("name")),
    readTwice(() => client.from("manufacturers").select("id, name, factory_name").order("name")),
  ]);
  if (clients.error) throw new Error(`Could not read the clients: ${clients.error.message}`);
  if (manufacturers.error) throw new Error(`Could not read the manufacturers: ${manufacturers.error.message}`);
  return {
    clients: clients.data,
    manufacturers: manufacturers.data.map((entry) => ({
      id: entry.id,
      name: [entry.name, entry.factory_name].filter(Boolean).join(" · "),
    })),
  };
}

export type DefectCodeOption = { code: string; name: string; active: boolean };

/** Defect codes, for label keys and the flag on codes that are not in the list. */
export async function loadDefectCodes(supabase?: Supabase): Promise<DefectCodeOption[]> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client.from("defect_codes").select("code, name, active").order("code");
  if (error) return [];
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
