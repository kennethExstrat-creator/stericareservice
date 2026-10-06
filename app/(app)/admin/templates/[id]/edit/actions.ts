"use server";

// The template editor's actions (BUILD_SPEC 4.2 rule 8, 10). Server Actions
// are public endpoints: each checks the caller is an active admin, validates
// its input with zod, and re-reads the row before it writes. Writes go
// through the admin's own client, so RLS and the templates guard (a version
// in use is frozen) check them again.
import { refresh } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { authorizeAction } from "@/lib/auth/session";
import { TemplateDefinitionSchema, type TemplateDefinition } from "@/lib/schemas/template";
import { createClient } from "@/lib/supabase/server";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { lookupFrom, planTemplateEdit, templateRowFields } from "@/lib/templates";
import { deepEqual } from "@/lib/zod-form";
import { resolveTemplate } from "@/modules";
import { loadActiveBases } from "./_lib/load";
import {
  lockedReason,
  MAX_DEFINITION_CHARS,
  type SaveResult,
  type ServerProblem,
  type VersionResult,
} from "./_lib/results";

const SaveInputSchema = z.strictObject({
  id: z.uuid(),
  /** templates.updated_at as the editor read it: the save is a compare-and-set on it. */
  updatedAt: z.iso.datetime({ offset: true }),
  definition: z.string().min(2).max(MAX_DEFINITION_CHARS),
});

const VersionInputSchema = z.strictObject({
  id: z.uuid(),
  /** Unsaved changes to carry into the new version (a draft that was used while it was being edited). */
  definition: z.string().min(2).max(MAX_DEFINITION_CHARS).optional(),
});

const UNEXPECTED = "Something went wrong on the server. Try again; if it keeps happening, reload the page.";

function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

/** Writes a draft's definition and its resolution (lib/templates, extends applied). */
export async function saveTemplate(_previous: SaveResult, formData: FormData): Promise<SaveResult> {
  try {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return { status: "error", message: auth.error };

    const input = SaveInputSchema.safeParse({
      id: field(formData, "id"),
      updatedAt: field(formData, "updatedAt"),
      definition: field(formData, "definition"),
    });
    if (!input.success) return { status: "error", message: "The template did not arrive whole. Reload the page and try again." };

    let raw: unknown;
    try {
      raw = JSON.parse(input.data.definition);
    } catch {
      return { status: "error", message: "The template did not arrive whole. Reload the page and try again." };
    }
    const parsed = TemplateDefinitionSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        status: "error",
        message: "The template has problems. Fix them, then save.",
        problems: parsed.error.issues.map((issue) => ({
          template: "",
          path: issue.path.map((segment) => (typeof segment === "number" ? segment : String(segment))),
          message: issue.message,
        })),
      };
    }

    const supabase = await createClient();
    const { data: row, error } = await supabase
      .from("templates")
      .select("id, code, version, status, definition, resolved, updated_at, source_file_path, coverage_confirmed_at")
      .eq("id", input.data.id)
      .maybeSingle();
    if (error) {
      console.error("[admin/templates] could not read the template to save", error.code, error.message);
      return { status: "error", message: UNEXPECTED };
    }
    if (!row) return { status: "error", message: "This template version no longer exists." };
    if (parsed.data.code !== row.code) {
      return { status: "error", message: `The code of this version is ${row.code}; it cannot change.` };
    }

    const { count, error: usageError } = await supabase
      .from("inspections")
      .select("id", { count: "exact", head: true })
      .eq("template_id", row.id);
    if (usageError) {
      console.error("[admin/templates] could not count inspections", usageError.code, usageError.message);
      return { status: "error", message: UNEXPECTED };
    }
    const inUse = count ?? 0;
    const plan = planTemplateEdit({ id: row.id, status: row.status, inUse: inUse > 0 }, []);
    if (plan.kind !== "update") {
      return { status: "locked", message: lockedReason({ version: row.version, status: row.status, inUse }) ?? UNEXPECTED };
    }

    // The source file uploaded to the template record stays with it (4.2 rule 10).
    const definition =
      parsed.data.sourceFile === undefined && row.source_file_path
        ? { ...parsed.data, sourceFile: row.source_file_path }
        : parsed.data;
    const resolution = resolveTemplate(definition, lookupFrom(await loadActiveBases(supabase)));
    if (!resolution.ok) {
      return {
        status: "error",
        message: "The template does not resolve. Fix the problems listed, then save.",
        problems: resolution.problems satisfies ServerProblem[],
      };
    }

    // A changed template needs its field coverage confirmed again before it is activated (4.2 rule 10): changed
    // itself, or in what it resolves to (a base that moved on, a module whose defaults changed).
    const changed = !deepEqual(row.definition, definition) || !deepEqual(row.resolved, resolution.template);
    const clearCoverage = changed && row.coverage_confirmed_at !== null;
    const { data: saved, error: saveError } = await supabase
      .from("templates")
      .update({
        ...templateRowFields(definition, resolution.template),
        ...(clearCoverage ? { coverage_confirmed_at: null, coverage_confirmed_by: null } : {}),
      })
      .eq("id", row.id)
      // Unchanged since the editor read it, or the update matches nothing.
      .eq("updated_at", input.data.updatedAt)
      .select("updated_at")
      .maybeSingle();
    if (saveError) {
      if (saveError.code === "42501") {
        return {
          status: "locked",
          message: `Version ${row.version} has just been used by an inspection, so it can no longer be changed. Make a new version.`,
        };
      }
      if (saveError.code === "23503") {
        return {
          status: "error",
          message: "The client or manufacturer this template applies to no longer exists. Choose another in Details.",
        };
      }
      console.error("[admin/templates] save refused", saveError.code, saveError.message);
      return { status: "error", message: UNEXPECTED };
    }
    if (!saved) {
      return {
        status: "conflict",
        message:
          "Someone else saved this draft after you opened it, so yours was not saved. Copy your changes from the JSON tab if you need them, then reload to see theirs.",
      };
    }

    refresh();
    return {
      status: "saved",
      message: `Saved ${row.code} version ${row.version}.`,
      updatedAt: saved.updated_at,
      coverageCleared: clearCoverage,
    };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[admin/templates] saveTemplate failed", error);
    return { status: "error", message: UNEXPECTED };
  }
}

/**
 * A new draft version from a version that cannot be changed (in use, active
 * or retired): the same definition, resolved against today's bases, then
 * the editor for it.
 */
export async function createTemplateVersion(_previous: VersionResult, formData: FormData): Promise<VersionResult> {
  let createdId: string;
  try {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return { status: "error", message: auth.error };

    const input = VersionInputSchema.safeParse({ id: field(formData, "id"), definition: field(formData, "definition") });
    if (!input.success) return { status: "error", message: "That template version was not found." };

    const supabase = await createClient();
    const { data: row, error } = await supabase
      .from("templates")
      .select("id, code, version, status, definition, extends_code, product_type, standard, client_id, manufacturer_id, source_file_path")
      .eq("id", input.data.id)
      .maybeSingle();
    if (error) {
      console.error("[admin/templates] could not read the template to copy", error.code, error.message);
      return { status: "error", message: UNEXPECTED };
    }
    if (!row) return { status: "error", message: "That template version was not found." };

    // The admin's unsaved changes, when the version was locked while they edited it.
    let carried: TemplateDefinition | undefined;
    if (input.data.definition !== undefined) {
      const parsed = TemplateDefinitionSchema.safeParse(parseJson(input.data.definition));
      if (!parsed.success || parsed.data.code !== row.code) {
        return {
          status: "error",
          message: "Your changes have problems, so they cannot go into a new version. Reload to start from the saved version.",
        };
      }
      carried = parsed.data;
    }

    const { count, error: usageError } = await supabase
      .from("inspections")
      .select("id", { count: "exact", head: true })
      .eq("template_id", row.id);
    if (usageError) {
      console.error("[admin/templates] could not count inspections", usageError.code, usageError.message);
      return { status: "error", message: UNEXPECTED };
    }

    const insert = async (): Promise<{ id: string } | { error: { code: string; message: string } } | "editable"> => {
      const { data: versions, error: versionsError } = await supabase.from("templates").select("version").eq("code", row.code);
      if (versionsError) return { error: versionsError };
      const plan = planTemplateEdit(
        { id: row.id, status: row.status, inUse: (count ?? 0) > 0 },
        versions.map((entry) => entry.version),
      );
      if (plan.kind === "update") return "editable";
      const { data: created, error: insertError } = await supabase
        .from("templates")
        .insert({ ...(await newVersionRow(row, carried)), version: plan.version, status: "draft" })
        .select("id")
        .single();
      return insertError ? { error: insertError } : created;
    };

    let outcome = await insert();
    // Two admins at once: the number was taken in between. Take the next one.
    if (typeof outcome === "object" && "error" in outcome && outcome.error.code === "23505") outcome = await insert();
    if (outcome === "editable") {
      return { status: "error", message: `Version ${row.version} is a draft no inspection uses: change it directly.` };
    }
    if ("error" in outcome) {
      console.error("[admin/templates] new version refused", outcome.error.code, outcome.error.message);
      return { status: "error", message: UNEXPECTED };
    }
    createdId = outcome.id;
  } catch (error) {
    unstable_rethrow(error);
    console.error("[admin/templates] createTemplateVersion failed", error);
    return { status: "error", message: UNEXPECTED };
  }
  redirect(`/admin/templates/${createdId}/edit`);
}

type CopiedRow = {
  code: string;
  definition: unknown;
  extends_code: string | null;
  product_type: TablesInsert<"templates">["product_type"];
  standard: TablesInsert<"templates">["standard"];
  client_id: string | null;
  manufacturer_id: string | null;
  source_file_path: string | null;
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The row of a copy: resolved again, so the new draft takes in its bases'
 * active versions. A definition that no longer resolves (a module's schema
 * moved on) is still copied, with no resolution, to be fixed in the editor.
 * `carried` replaces the stored definition with the admin's unsaved one.
 */
async function newVersionRow(
  row: CopiedRow,
  carried?: TemplateDefinition,
): Promise<Omit<TablesInsert<"templates">, "version" | "status">> {
  const parsed = carried ? { success: true as const, data: carried } : TemplateDefinitionSchema.safeParse(row.definition);
  if (parsed.success) {
    // The source file uploaded to the template record stays with it (4.2 rule 10).
    const definition =
      parsed.data.sourceFile === undefined && row.source_file_path
        ? { ...parsed.data, sourceFile: row.source_file_path }
        : parsed.data;
    const resolution = resolveTemplate(definition, lookupFrom(await loadActiveBases()));
    if (resolution.ok) return templateRowFields(definition, resolution.template);
    return {
      code: definition.code,
      extends_code: definition.extends ?? null,
      product_type: definition.scope.productType,
      standard: definition.scope.standard,
      client_id: definition.scope.clientId ?? null,
      manufacturer_id: definition.scope.manufacturerId ?? null,
      definition,
      resolved: null,
      source_file_path: definition.sourceFile ?? null,
    };
  }
  return {
    code: row.code,
    extends_code: row.extends_code,
    product_type: row.product_type,
    standard: row.standard,
    client_id: row.client_id,
    manufacturer_id: row.manufacturer_id,
    definition: (row.definition ?? {}) as TablesInsert<"templates">["definition"],
    resolved: null,
    source_file_path: row.source_file_path,
  };
}
