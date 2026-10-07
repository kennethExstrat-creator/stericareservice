"use server";

// /admin/templates' action: a new template from a base (BUILD_SPEC 4.5 step 2).
// A Server Action is a public endpoint: it checks for an active admin,
// validates its input with zod and reads the base again before it writes,
// on the admin's own client, so Row Level Security checks the write too.
import { redirect, unstable_rethrow } from "next/navigation";
import {
  codeTakenMessage,
  NewTemplateInputSchema,
  newTemplateDefinition,
  readNewTemplateForm,
  type NewTemplateField,
  type NewTemplateResult,
} from "@/lib/admin/new-template";
import { fieldErrors } from "@/lib/admin/reference";
import { baseVersionOf, loadBases, MESSAGES, templateEditPath } from "@/lib/admin/templates";
import { authorizeAction } from "@/lib/auth/session";
import { TemplateDefinitionSchema, type TemplateDefinition } from "@/lib/schemas/template";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { templateRowFields } from "@/lib/templates";
import { resolveTemplate } from "@/modules";

const CHECK_FIELDS = "Check the highlighted fields.";

function refused(message: string, errors?: Partial<Record<NewTemplateField, string>>): NewTemplateResult {
  return errors ? { status: "error", message, fieldErrors: errors } : { status: "error", message };
}

function codeTaken(code: string): Partial<Record<NewTemplateField, string>> {
  return { code: codeTakenMessage(code) };
}

/**
 * Creates version 1 of a new template as a draft, built on the base's active
 * version (or on nothing), resolved, and opens it in the template editor.
 * The definition lists only what it must: code, name, base, scope, and the
 * base's unit and sizes (lib/admin/new-template newTemplateDefinition).
 *
 * Not in the audit log: audit_log holds inspection events only (each row
 * names an inspection, migration 200). The row itself records when the
 * template was created; who confirmed its coverage is kept when they do.
 */
export async function createTemplate(_previous: NewTemplateResult, formData: FormData): Promise<NewTemplateResult> {
  let createdId: string;
  try {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return refused(auth.error);

    const input = NewTemplateInputSchema.safeParse(readNewTemplateForm(formData));
    if (!input.success) return refused(CHECK_FIELDS, fieldErrors(input.error));
    const { code, base } = input.data;

    const supabase = await createClient();
    const { data: sameCode, error: codeError } = await supabase.from("templates").select("id").eq("code", code).limit(1);
    if (codeError) throw new Error(`Could not check template code ${code}: ${codeError.message}`);
    if (sameCode.length > 0) return refused(CHECK_FIELDS, codeTaken(code));

    // The base as inspectors start from it: its active version (lib/admin/templates baseVersionOf).
    let baseDefinition: TemplateDefinition | null = null;
    if (base !== null) {
      const { data: versions, error } = await supabase
        .from("templates")
        .select("version, status, definition")
        .eq("code", base)
        .order("version", { ascending: false });
      if (error) throw new Error(`Could not read base template ${base}: ${error.message}`);
      const active = baseVersionOf(versions);
      if (!active) {
        return refused(CHECK_FIELDS, {
          base: `${base} has no active version: build on a template inspectors can start from, or on None.`,
        });
      }
      const parsed = TemplateDefinitionSchema.safeParse(active.definition);
      if (!parsed.success) {
        return refused(CHECK_FIELDS, {
          base: `${base} version ${active.version} does not read as a template: open it in the editor first, or choose another base.`,
        });
      }
      baseDefinition = parsed.data;
    }

    const definition = newTemplateDefinition(input.data, baseDefinition);
    const resolution = resolveTemplate(definition, await loadBases(supabase, definition));
    // A base that no longer resolves with today's modules still makes the draft: the editor lists its problems.
    const fields: Omit<TablesInsert<"templates">, "version" | "status"> = resolution.ok
      ? templateRowFields(definition, resolution.template)
      : {
          code: definition.code,
          extends_code: definition.extends ?? null,
          product_type: definition.scope.productType,
          standard: definition.scope.standard,
          client_id: definition.scope.clientId ?? null,
          manufacturer_id: definition.scope.manufacturerId ?? null,
          definition,
          resolved: null,
          source_file_path: null,
        };
    const { data: created, error: insertError } = await supabase
      .from("templates")
      .insert({ ...fields, version: 1, status: "draft", coverage_confirmed_by: null, coverage_confirmed_at: null })
      .select("id")
      .single();
    if (insertError) {
      // Another admin made the same code at the same moment.
      if (insertError.code === "23505") return refused(CHECK_FIELDS, codeTaken(code));
      if (insertError.code === "23503") {
        return refused("The client or manufacturer you chose no longer exists. Reload the page and choose again.");
      }
      if (insertError.code === "42501") return refused("Only active admins can add templates. Reload the page to check your access.");
      console.error("[admin/templates] new template refused", insertError.code, insertError.message);
      return refused(MESSAGES.unexpected);
    }
    createdId = created.id;
  } catch (error) {
    unstable_rethrow(error);
    console.error("[admin/templates] createTemplate failed", error);
    return refused(MESSAGES.unexpected);
  }
  // Outside the try: redirect() throws to navigate.
  redirect(templateEditPath(createdId));
}

export type { NewTemplateResult };
