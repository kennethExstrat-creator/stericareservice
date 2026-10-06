"use server";

import { refresh } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import {
  activationBlockers,
  activationPlan,
  allSectionsTicked,
  configProblems,
  CoverageConfirmSchema,
  coverageBlocker,
  coverageChecklist,
  countOf,
  definitionForNewVersion,
  describeTemplateError,
  failed,
  isSourceOf,
  loadBases,
  loadTemplateVersion,
  MESSAGES,
  newVersionRow,
  nextVersionOf,
  parseResolution,
  removeUnusedSources,
  SOURCE_BUCKET,
  SOURCE_URL_SECONDS,
  SourceConfirmSchema,
  sourceChangeBlocker,
  sourceFileExists,
  sourceFileName,
  sourceFileProblem,
  sourceFileType,
  sourceObjectName,
  SourceUploadRequestSchema,
  succeeded,
  templateEditPath,
  VersionTargetSchema,
  withSourceFile,
  type ActionResult,
  type DatabaseClient,
  type SourceType,
} from "@/lib/admin/templates";
import { authorizeAction } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { MODULE_REGISTRY, resolveTemplate } from "@/modules";

/*
 * Actions of the template version page (BUILD_SPEC 4.2 rules 8 to 10, 4.5).
 * Server Actions are public HTTP endpoints: each one checks for an active
 * admin, validates its input with zod and re-reads the version before it
 * writes. Everything runs on the admin's own client, so Row Level Security,
 * the storage policies and the templates guard (a version in use is frozen)
 * check it again.
 *
 * A source file goes up in three steps, because a Server Action takes at
 * most 1 MB and a form may be 50 MB: prepareSourceUpload() checks the file
 * and names the object, the browser uploads straight to Storage with the
 * one-time token, and confirmSourceUpload() makes it the version's source.
 */

export type { ActionResult } from "@/lib/admin/templates";

type Failure = { status: "error"; message: string };

/** Unexpected failures become a message on the page instead of an error screen. */
async function guarded<T extends { status: string }>(name: string, run: () => Promise<T | Failure>): Promise<T | Failure> {
  try {
    return await run();
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    unstable_rethrow(error);
    console.error(`[admin/templates] ${name} failed`, error);
    return failed(MESSAGES.unexpected);
  }
}

const ROW_COLUMNS =
  "id, code, version, status, extends_code, product_type, standard, client_id, manufacturer_id, definition, resolved, source_file_path, coverage_confirmed_at, updated_at, inspections(count)";

async function readRow(supabase: DatabaseClient, id: string) {
  const { data, error } = await supabase.from("templates").select(ROW_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not read template ${id}: ${error.message}`);
  return data ? { ...data, usage: countOf(data.inspections) } : null;
}

function readForm(formData: FormData, keys: readonly string[]): Record<string, FormDataEntryValue | null> {
  return Object.fromEntries(keys.map((key) => [key, formData.get(key)]));
}

/* ------------------------------------------------------------------ *
 * Source file
 * ------------------------------------------------------------------ */

export type PrepareSourceResult =
  | { status: "ready"; path: string; token: string; contentType: SourceType }
  | { status: "error"; message: string };

/**
 * Step 1 of an upload: checks the file's type and size and that the version
 * is a draft no inspection uses, then names the object and signs a one-time
 * upload for it.
 */
export async function prepareSourceUpload(request: {
  templateId: string;
  fileName: string;
  type: string;
  size: number;
}): Promise<PrepareSourceResult> {
  return guarded<PrepareSourceResult>("prepareSourceUpload", async () => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return failed(auth.error);

    const parsed = SourceUploadRequestSchema.safeParse(request);
    if (!parsed.success) return failed(MESSAGES.stale);
    const { templateId, fileName, type, size } = parsed.data;
    const problem = sourceFileProblem({ name: fileName, type, size });
    const contentType = sourceFileType(fileName, type);
    if (problem || !contentType) return failed(problem ?? MESSAGES.stale);

    const supabase = await createClient();
    const row = await readRow(supabase, templateId);
    if (!row) {
      refresh();
      return failed(MESSAGES.notFound);
    }
    const blocked = sourceChangeBlocker(row);
    if (blocked) {
      refresh();
      return failed(blocked);
    }

    const { data, error } = await supabase.storage
      .from(SOURCE_BUCKET)
      .createSignedUploadUrl(sourceObjectName(row, fileName));
    if (error) {
      console.error("[admin/templates] could not sign a source upload", error.message);
      return failed("The upload could not start. Try again.");
    }
    return { status: "ready", path: data.path, token: data.token, contentType };
  });
}

/**
 * Step 3 of an upload, once the browser has stored the file: makes it the
 * version's source file (the column, the definition and the resolved
 * template name it alike), clears the coverage confirmation, which was given
 * against the old file, and removes the file it replaces.
 */
export async function confirmSourceUpload(request: { templateId: string; path: string }): Promise<ActionResult> {
  return guarded("confirmSourceUpload", async () => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return failed(auth.error);

    const parsed = SourceConfirmSchema.safeParse(request);
    if (!parsed.success) return failed(MESSAGES.stale);
    const { templateId, path } = parsed.data;

    const supabase = await createClient();
    // Twice at most: an edit saved between the read and the write only means reading again.
    for (let attempt = 0; attempt < 2; attempt++) {
      const row = await readRow(supabase, templateId);
      if (!row) {
        refresh();
        return failed(MESSAGES.notFound);
      }
      // Only an object in this version's own folder, named as prepareSourceUpload() names them.
      if (!isSourceOf(path, row)) return failed(MESSAGES.stale);
      const blocked = sourceChangeBlocker(row);
      if (blocked) {
        refresh();
        return failed(blocked);
      }
      if (row.source_file_path === path) {
        refresh();
        return succeeded("Source file saved.");
      }
      if (!(await sourceFileExists(supabase, path))) return failed("The upload did not finish. Choose the file again.");

      const { data, error } = await supabase
        .from("templates")
        .update({
          source_file_path: path,
          definition: withSourceFile(row.definition, path) ?? row.definition,
          resolved: withSourceFile(row.resolved, path),
          coverage_confirmed_by: null,
          coverage_confirmed_at: null,
        })
        .eq("id", row.id)
        .eq("updated_at", row.updated_at)
        .select("id")
        .maybeSingle();
      if (error) {
        console.error("[admin/templates] could not set the source file", error.code, error.message);
        refresh();
        return failed(describeTemplateError(error, row));
      }
      if (!data) continue;

      await removeUnusedSources(supabase, row, { keep: path, previous: row.source_file_path });
      refresh();
      if (!row.source_file_path) return succeeded("Source file added.");
      return succeeded(
        row.coverage_confirmed_at
          ? "Source file replaced. Check the coverage checklist against it and confirm it again."
          : "Source file replaced.",
      );
    }
    refresh();
    return failed(MESSAGES.changed);
  });
}

export type SourceDownloadResult = { status: "ready"; url: string } | { status: "error"; message: string };

/** A download link for the version's source file, good for a minute: asked for on each click. */
export async function getSourceDownload(request: { templateId: string }): Promise<SourceDownloadResult> {
  return guarded<SourceDownloadResult>("getSourceDownload", async () => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return failed(auth.error);

    const parsed = VersionTargetSchema.pick({ templateId: true }).safeParse(request);
    if (!parsed.success) return failed(MESSAGES.stale);

    const supabase = await createClient();
    const { data: row, error } = await supabase
      .from("templates")
      .select("source_file_path")
      .eq("id", parsed.data.templateId)
      .maybeSingle();
    if (error) throw new Error(`Could not read template ${parsed.data.templateId}: ${error.message}`);
    if (!row) return failed(MESSAGES.notFound);
    if (!row.source_file_path) {
      refresh();
      return failed("This version has no source file any more.");
    }

    const { data, error: signError } = await supabase.storage
      .from(SOURCE_BUCKET)
      .createSignedUrl(row.source_file_path, SOURCE_URL_SECONDS, { download: sourceFileName(row.source_file_path) });
    if (signError || !data) {
      console.error("[admin/templates] could not sign a source download", signError?.message);
      return failed("The file could not be found in storage. If the version is a draft, upload it again.");
    }
    return { status: "ready", url: data.signedUrl };
  });
}

/* ------------------------------------------------------------------ *
 * Coverage checklist
 * ------------------------------------------------------------------ */

/**
 * Records that an admin checked every field of the source against this
 * version (coverage_confirmed_by and _at), only for the version as the page
 * showed it, with every section of the checklist ticked.
 */
export async function confirmCoverage(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("confirmCoverage", async () => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return failed(auth.error);

    const parsed = CoverageConfirmSchema.safeParse({
      ...readForm(formData, ["templateId", "seen", "attested"]),
      sections: formData.getAll("section"),
    });
    if (!parsed.success) {
      const attested = parsed.error.issues.find((issue) => issue.path[0] === "attested");
      return failed(attested?.message ?? MESSAGES.stale);
    }
    const { templateId, seen, sections } = parsed.data;

    const supabase = await createClient();
    const row = await readRow(supabase, templateId);
    if (!row) {
      refresh();
      return failed(MESSAGES.notFound);
    }
    if (row.coverage_confirmed_at) {
      refresh();
      return succeeded("Coverage was already confirmed for this version.");
    }
    if (row.updated_at !== seen) {
      refresh();
      return failed(MESSAGES.changed);
    }

    const resolution = parseResolution(row.resolved);
    const checklist = resolution.state === "ok" ? coverageChecklist(resolution.template) : null;
    const blocker = coverageBlocker(
      { sourceFilePath: row.source_file_path, resolution, coverageConfirmedAt: row.coverage_confirmed_at },
      checklist,
    );
    if (blocker || !checklist) return failed(blocker ?? MESSAGES.stale);
    if (!allSectionsTicked(checklist, sections)) return failed("Tick every section of the checklist once you have checked it.");

    const { data, error } = await supabase
      .from("templates")
      .update({ coverage_confirmed_by: auth.user.id, coverage_confirmed_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("updated_at", seen)
      .is("coverage_confirmed_at", null)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[admin/templates] could not confirm coverage", error.code, error.message);
      return failed(describeTemplateError(error, row));
    }
    refresh();
    if (!data) return failed(MESSAGES.changed);
    return succeeded(
      row.status === "active"
        ? `Coverage confirmed for ${row.code} version ${row.version}.`
        : `Coverage confirmed for ${row.code} version ${row.version}. It can be activated now.`,
    );
  });
}

/* ------------------------------------------------------------------ *
 * Activate, retire, new version
 * ------------------------------------------------------------------ */

/**
 * Makes this version the one inspectors start from. The code's active
 * version is retired first (the database allows one at a time) and put back
 * if the activation then fails, so a code never loses its active version to
 * a failed attempt.
 */
export async function activateVersion(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("activateVersion", async () => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return failed(auth.error);

    const parsed = VersionTargetSchema.safeParse(readForm(formData, ["templateId", "seen"]));
    if (!parsed.success) return failed(MESSAGES.stale);
    const { templateId, seen } = parsed.data;

    const supabase = await createClient();
    const detail = await loadTemplateVersion(supabase, templateId);
    if (!detail) {
      refresh();
      return failed(MESSAGES.notFound);
    }
    if (detail.status === "active") {
      refresh();
      return succeeded(`${detail.code} version ${detail.version} is already active.`);
    }
    if (detail.updatedAt !== seen) {
      refresh();
      return failed(MESSAGES.changed);
    }
    const problems = detail.resolution.state === "ok" ? configProblems(detail.resolution.template, MODULE_REGISTRY) : [];
    const blockers = activationBlockers(detail, problems);
    if (blockers.length > 0) return failed(blockers.join(" "));
    const plan = activationPlan(detail.versions, detail.id);
    if (!plan.ok) return failed(plan.message);

    let retired: { id: string; version: number }[] = [];
    if (plan.retire.length > 0) {
      const { data, error } = await supabase
        .from("templates")
        .update({ status: "retired" })
        .in("id", plan.retire)
        .eq("status", "active")
        .select("id, version");
      if (error) {
        console.error("[admin/templates] could not retire the active version", error.code, error.message);
        refresh();
        return failed(describeTemplateError(error, detail));
      }
      retired = data;
    }

    const { data: activated, error } = await supabase
      .from("templates")
      .update({ status: "active" })
      .eq("id", detail.id)
      .eq("updated_at", seen)
      .neq("status", "active")
      .select("id")
      .maybeSingle();
    if (error || !activated) {
      if (error) console.error("[admin/templates] could not activate", error.code, error.message);
      if (retired.length > 0) {
        const { error: restoreError } = await supabase
          .from("templates")
          .update({ status: "active" })
          .in(
            "id",
            retired.map((entry) => entry.id),
          )
          .eq("status", "retired");
        if (restoreError) {
          console.error("[admin/templates] activation failed and the retired version could not be restored", restoreError.message);
        }
      }
      refresh();
      return failed(error ? describeTemplateError(error, detail) : MESSAGES.changed);
    }

    refresh();
    const versions = retired.map((entry) => entry.version).sort((a, b) => a - b);
    const retiredText =
      versions.length === 0
        ? ""
        : ` Version ${versions.join(" and ")} ${versions.length === 1 ? "is" : "are"} retired; inspections that use ${versions.length === 1 ? "it" : "them"} keep ${versions.length === 1 ? "it" : "them"}.`;
    return succeeded(`${detail.code} version ${detail.version} is active. New inspections start from it.${retiredText}`);
  });
}

/** Stops new inspections starting from this version. Inspections that use it keep it. */
export async function retireVersion(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("retireVersion", async () => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return failed(auth.error);

    const parsed = VersionTargetSchema.safeParse(readForm(formData, ["templateId", "seen"]));
    if (!parsed.success) return failed(MESSAGES.stale);

    const supabase = await createClient();
    const row = await readRow(supabase, parsed.data.templateId);
    if (!row) {
      refresh();
      return failed(MESSAGES.notFound);
    }
    if (row.status === "retired") {
      refresh();
      return succeeded(`${row.code} version ${row.version} is already retired.`);
    }
    if (row.status === "draft") return failed("Only the active version can be retired. A draft is not offered to inspectors yet.");

    const { data, error } = await supabase
      .from("templates")
      .update({ status: "retired" })
      .eq("id", row.id)
      .eq("status", "active")
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[admin/templates] could not retire", error.code, error.message);
      return failed(describeTemplateError(error, row));
    }
    refresh();
    if (!data) return failed(MESSAGES.changed);
    return succeeded(
      `${row.code} version ${row.version} is retired. New inspections can no longer start from it; inspections that use it keep it.`,
    );
  });
}

/**
 * Copies this version's definition into a new draft version (BUILD_SPEC 4.2
 * rule 8), resolved against the bases as they are now, and opens it in the
 * template editor.
 */
export async function createNewVersion(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const created = await guarded<{ status: "created"; id: string }>("createNewVersion", async () => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return failed(auth.error);

    const parsed = VersionTargetSchema.safeParse(readForm(formData, ["templateId", "seen"]));
    if (!parsed.success) return failed(MESSAGES.stale);

    const supabase = await createClient();
    const row = await readRow(supabase, parsed.data.templateId);
    if (!row) {
      refresh();
      return failed(MESSAGES.notFound);
    }

    const definition = definitionForNewVersion(row.definition, row.source_file_path);
    const resolution = resolveTemplate(definition, await loadBases(supabase, definition));

    // A version number someone else takes at the same moment is a duplicate (23505): count again.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: versions, error: readError } = await supabase.from("templates").select("version").eq("code", row.code);
      if (readError) throw new Error(`Could not read the versions of ${row.code}: ${readError.message}`);
      const version = nextVersionOf(versions);
      const { data, error } = await supabase
        .from("templates")
        .insert(newVersionRow(row, definition, resolution.ok ? resolution.template : null, version))
        .select("id")
        .single();
      if (!error) return { status: "created", id: data.id } as const;
      if (error.code === "23505" && /code_version/i.test(error.message)) continue;
      console.error("[admin/templates] could not make a new version", error.code, error.message);
      return failed(describeTemplateError(error, row));
    }
    return failed(describeTemplateError({ code: "23505", message: "templates_code_version_key" }, row));
  });
  if (created.status !== "created") return created;
  // Outside the try: redirect() throws to navigate.
  redirect(templateEditPath(created.id));
}
