"use server";

import { refresh, revalidatePath } from "next/cache";
import {
  ActiveTargetSchema,
  CodeTargetSchema,
  DEFECTS_PATH,
  DefectCodeDetailsSchema,
  EditTargetSchema,
  MAP_FIELDS,
  MESSAGES,
  MapChoiceSchema,
  MapTargetSchema,
  NewDefectCodeSchema,
  canMap,
  codeSnapshot,
  deleteBlocker,
  describeCodeInsertError,
  describeCodeWriteError,
  describeMappingProblem,
  failed,
  fieldErrors,
  guarded,
  inspectionCountingCode,
  labelScope,
  loadTemplates,
  mapOneOffLabel,
  readDefectCode,
  readForm,
  readResolvedTemplate,
  shortformsByCode,
  succeeded,
  templatesMentioning,
  warned,
  type ActionResult,
  type CodeSnapshot,
  type DatabaseClient,
  type DefectCodeField,
  type LabelScope,
  type LabelTarget,
  type MapField,
  type MappingChange,
} from "@/lib/admin/defects";
import {
  SHORTFORM_MESSAGES,
  applyShortformChange,
  notActiveCode,
  readOriginal,
  readShortformForm,
  type ShortformResult,
} from "@/lib/admin/shortforms";
import { loadGlossaryState, saveGlossary, type GlossaryState } from "@/lib/ai/settings";
import { authorizeAction } from "@/lib/auth/session";
import type { InspectionStatus } from "@/lib/schemas/common";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { MODULE_REGISTRY } from "@/modules/registry";

/*
 * Actions for /admin/defects (BUILD_SPEC 4.2 rule 4 and 10). Server Actions
 * are public HTTP endpoints: each one checks for an active admin first,
 * validates its input with zod and re-reads what it needs. Writes go through
 * the admin's own client, so Row Level Security and the database guards
 * check them again (an approved inspection stays read-only whatever the
 * page sent). Shortforms are the exception: ai_settings is the service
 * role's alone, so lib/ai/settings.ts saves them once the admin is checked.
 */

/** A refused edit answers with the code as it is now (`latest`), so a second save replaces it, as the message offers. */
export type CodeFormResult = ActionResult<DefectCodeField, CodeSnapshot>;
export type MapLabelResult = ActionResult<MapField>;

/* ------------------------------------------------------------------ *
 * Codes
 * ------------------------------------------------------------------ */

/**
 * Adds a code (`mode` create) or saves the name and description of one
 * (`mode` edit, with the version the form was opened on, so a save never
 * silently replaces someone else's newer change). A code never changes once
 * saved: templates and inspection data refer to it by value.
 */
export async function saveDefectCode(_previous: CodeFormResult, formData: FormData): Promise<CodeFormResult> {
  return guarded("saveDefectCode", async (): Promise<CodeFormResult> => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return failed(auth.error);

    const fields = readForm(formData, ["mode", "code", "version", "name", "description"]);

    if (fields.mode === "create") {
      const input = NewDefectCodeSchema.safeParse(fields);
      if (!input.success) return failed(MESSAGES.checkFields, fieldErrors(input.error));
      const { code, name, description } = input.data;
      const supabase = await createClient();
      const { error } = await supabase.from("defect_codes").insert({ code, name, description }).select("code").single();
      if (error) return insertFailed(supabase, code, error);
      refresh();
      return succeeded(`Code ${code} added.`);
    }

    if (fields.mode !== "edit") return failed(MESSAGES.stale);
    const target = EditTargetSchema.safeParse(fields);
    if (!target.success) return failed(MESSAGES.stale);
    const details = DefectCodeDetailsSchema.safeParse(fields);
    if (!details.success) return failed(MESSAGES.checkFields, fieldErrors(details.error));

    const { code, version } = target.data;
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("defect_codes")
      .update(details.data)
      .eq("code", code)
      // Only the version the form was opened on: a newer save by someone else matches nothing.
      .eq("updated_at", version)
      .select("code")
      .maybeSingle();
    if (error) {
      console.error("[admin/defects] save refused", error.code, error.message);
      return failed(describeCodeWriteError(error, "saved"));
    }
    if (!data) {
      const current = await readDefectCode(supabase, code);
      refresh();
      if (!current) return failed("This code has been deleted, so your changes were not saved.");
      // Their version: the panel's next save goes against it, so it replaces their change, as offered.
      return {
        ...failed(
          "Someone else changed this code while you were editing. Close the panel to see their changes, or save again to replace them with yours.",
        ),
        latest: codeSnapshot({ updatedAt: current.updated_at, name: current.name, description: current.description }),
      };
    }
    refresh();
    return succeeded(`Code ${code} saved.`);
  });
}

/** A refused insert: a duplicate says whether the code that exists is inactive. */
async function insertFailed(
  supabase: DatabaseClient,
  code: string,
  error: { code?: string; message?: string },
): Promise<CodeFormResult> {
  const { message, field } = describeCodeInsertError(code, error);
  if (!field) {
    console.error("[admin/defects] insert refused", error.code, error.message);
    return failed(message);
  }
  let shown: string = message;
  if (error.code === "23505") {
    const existing = await readDefectCode(supabase, code);
    if (existing && !existing.active) shown = `There is already a code ${code}, and it is inactive. Reactivate it instead.`;
  }
  return failed(MESSAGES.checkFields, { [field]: shown });
}

/**
 * Deactivates a code (kept wherever templates and inspections use it, but no
 * longer offered when mapping labels) or makes it active again.
 */
export async function setDefectCodeActive(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("setDefectCodeActive", async (): Promise<ActionResult> => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return failed(auth.error);

    const target = ActiveTargetSchema.safeParse(readForm(formData, ["code", "active"]));
    if (!target.success) return failed(MESSAGES.stale);
    const { code, active } = target.data;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("defect_codes")
      .update({ active })
      .eq("code", code)
      .select("code")
      .maybeSingle();
    if (error) {
      console.error("[admin/defects] status change refused", error.code, error.message);
      return failed(describeCodeWriteError(error, "saved"));
    }
    refresh();
    if (!data) return failed("This code has been deleted.");
    return succeeded(
      active
        ? `${code} is active again.`
        : `${code} is inactive. Templates and inspections that use it keep it; it is no longer offered when mapping labels.`,
    );
  });
}

/**
 * Deletes a code nothing uses: no template version mentions it, no shortform
 * links it and no inspection counts it. The page offers it only for codes no
 * template or shortform uses; inspections are checked here, at the moment it
 * counts.
 */
export async function deleteDefectCode(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("deleteDefectCode", async (): Promise<ActionResult> => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return failed(auth.error);

    const target = CodeTargetSchema.safeParse(readForm(formData, ["code"]));
    if (!target.success) return failed(MESSAGES.stale);
    const { code } = target.data;

    const supabase = await createClient();
    const current = await readDefectCode(supabase, code);
    if (!current) {
      refresh();
      return succeeded(`Code ${code} was already deleted.`);
    }
    const [templates, glossary] = await Promise.all([loadTemplates(supabase), loadGlossaryState()]);
    // Unread, the starting list stands in for the saved one: never delete a code a saved shortform may link.
    if (glossary.storage === "unavailable") throw new Error("Could not read the shortforms");
    const blocker = deleteBlocker({
      inTemplates: templatesMentioning(templates, code),
      shortforms: shortformsByCode(glossary.entries).get(code) ?? [],
    });
    if (blocker) {
      refresh();
      return failed(blocker);
    }
    const refNo = await inspectionCountingCode(supabase, code);
    if (refNo) return failed(`${refNo} counts it, so it cannot be deleted. Deactivate it instead.`);

    const { data, error } = await supabase.from("defect_codes").delete().eq("code", code).select("code");
    if (error) {
      console.error("[admin/defects] delete refused", error.code, error.message);
      return failed(describeCodeWriteError(error, "deleted"));
    }
    refresh();
    if (data.length === 0) return failed(`Code ${code} could not be deleted. Reload the page and try again.`);
    return succeeded(`Code ${code} deleted.`);
  });
}

/* ------------------------------------------------------------------ *
 * Mapping a one-off label
 * ------------------------------------------------------------------ */

type InspectionRow = {
  id: string;
  ref_no: string;
  status: InspectionStatus;
  updated_at: string;
  data: unknown;
  module_overrides: unknown;
  /** The template version it was started with, as resolved. */
  template: { resolved: unknown } | null;
};

async function readInspection(supabase: DatabaseClient, id: string): Promise<InspectionRow | null> {
  const { data, error } = await supabase
    .from("inspections")
    .select(
      "id, ref_no, status, updated_at, data, module_overrides, template:templates!inspections_template_id_fkey(resolved)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read inspection ${id}: ${error.message}`);
  return data;
}

/**
 * Where the inspection counts one-off labels, as its calc does (labelScope):
 * only there is a label listed, so only there is it mapped. Null when its
 * template version cannot be read.
 */
function scopeOf(row: InspectionRow): LabelScope | null {
  const template = readResolvedTemplate(row.template?.resolved);
  return template && labelScope(template, { moduleOverrides: row.module_overrides, data: row.data }, MODULE_REGISTRY);
}

const unreadableTemplate = (refNo: string) =>
  `The template version ${refNo} uses could not be read, so its labels cannot be mapped. Ask a developer to check the template.`;

/** Why an inspection's labels cannot be mapped now. */
function notMappable(row: Pick<InspectionRow, "ref_no" | "status">): string {
  switch (row.status) {
    case "draft":
      return `${row.ref_no} is a draft: the inspector may still change it. Map the label once it is submitted.`;
    case "reopened":
      return `${row.ref_no} is reopened: the inspector may still change it. Map the label once it is submitted again.`;
    default:
      return `${row.ref_no} is approved, so its data is final and the label stays as recorded.`;
  }
}

const GONE = "This inspection no longer exists. Reload the page.";

type Saved = { ok: true; refNo: string; change: MappingChange } | { ok: false; message: string };

/** Writes the mapping over the version it was made on; when someone saved in between, reads again and retries. */
async function saveMapping(supabase: DatabaseClient, id: string, target: LabelTarget, code: string): Promise<Saved> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await readInspection(supabase, id);
    if (!row) return { ok: false, message: GONE };
    if (!canMap(row.status)) return { ok: false, message: notMappable(row) };
    const scope = scopeOf(row);
    if (!scope) return { ok: false, message: unreadableTemplate(row.ref_no) };
    const outcome = mapOneOffLabel(row.data, target, code, scope);
    if (!outcome.ok) return { ok: false, message: describeMappingProblem(outcome.problem, row.ref_no) };

    const { data, error } = await supabase
      .from("inspections")
      .update({ data: outcome.data as NonNullable<Json> })
      .eq("id", row.id)
      .eq("updated_at", row.updated_at)
      .eq("status", "submitted")
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[admin/defects] mapping refused", error.code, error.message);
      return {
        ok: false,
        message:
          error.code === "42501"
            ? `${row.ref_no} could not be changed: only active admins can, and approved inspections are final.`
            : `${row.ref_no} could not be saved. Try again.`,
      };
    }
    if (data) return { ok: true, refNo: row.ref_no, change: outcome.change };
  }
  return { ok: false, message: "The inspection kept changing while the label was being mapped. Reload the page and try again." };
}

/**
 * Maps an inspector's one-off label (BUILD_SPEC 4.2 rule 4, 8) to a code:
 * one that exists, or a new one added from the label. The mapping is
 * recorded on the inspection's data, in every size and hand the label was
 * counted in, so it counts with that code from then on, and logged in the
 * inspection's audit trail. Only submitted inspections: drafts and reopened
 * ones are still the inspector's to change, and approved ones are final.
 */
export async function mapDefectLabel(_previous: MapLabelResult, formData: FormData): Promise<MapLabelResult> {
  return guarded("mapDefectLabel", async (): Promise<MapLabelResult> => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return failed(auth.error);

    const fields = readForm(formData, ["inspectionId", "target", "mode", "code", "newCode", "name", "description"]);
    const where = MapTargetSchema.safeParse(fields);
    if (!where.success) return failed(MESSAGES.stale);
    const choice = MapChoiceSchema.safeParse(fields);
    if (!choice.success) {
      // Field errors of the chosen mode go under their fields; anything else means the page is out of date.
      const errors: Partial<Record<MapField, string>> = {};
      for (const [key, message] of Object.entries(fieldErrors(choice.error))) {
        if ((MAP_FIELDS as readonly string[]).includes(key)) errors[key as MapField] = message;
      }
      const known = fields.mode === "existing" || fields.mode === "new";
      return known && Object.keys(errors).length > 0 ? failed(MESSAGES.checkFields, errors) : failed(MESSAGES.stale);
    }
    const { inspectionId, target } = where.data;
    const supabase = await createClient();

    // The label first, so no code is added for a label that cannot be mapped.
    const inspection = await readInspection(supabase, inspectionId);
    if (!inspection) {
      refresh();
      return failed(GONE);
    }
    if (!canMap(inspection.status)) {
      refresh();
      return failed(notMappable(inspection));
    }
    const scope = scopeOf(inspection);
    if (!scope) return failed(unreadableTemplate(inspection.ref_no));
    const wanted = choice.data.mode === "existing" ? choice.data.code : choice.data.newCode;
    const check = mapOneOffLabel(inspection.data, target, wanted, scope);
    if (!check.ok) {
      refresh();
      return failed(describeMappingProblem(check.problem, inspection.ref_no));
    }

    // The code: an active one that exists, or the new one, added now.
    let code: string;
    let name: string;
    let added = false;
    if (choice.data.mode === "existing") {
      const existing = await readDefectCode(supabase, choice.data.code);
      if (!existing) {
        refresh();
        return failed(MESSAGES.checkFields, { code: "This code no longer exists. Choose another." });
      }
      if (!existing.active) {
        return failed(MESSAGES.checkFields, {
          code: `${existing.code} is inactive. Choose an active code, or reactivate it on the Codes tab first.`,
        });
      }
      ({ code, name } = existing);
    } else {
      const { newCode, name: newName, description } = choice.data;
      const { error } = await supabase
        .from("defect_codes")
        .insert({ code: newCode, name: newName, description })
        .select("code")
        .single();
      if (error) {
        const refused = describeCodeInsertError(newCode, error);
        if (!refused.field) {
          console.error("[admin/defects] insert refused", error.code, error.message);
          return failed(refused.message);
        }
        let message = refused.message;
        if (error.code === "23505") {
          // An existing code is offered only while it is active.
          const existing = await readDefectCode(supabase, newCode);
          message =
            existing && !existing.active
              ? `There is already a code ${newCode}, and it is inactive. Reactivate it on the Codes tab, or pick another code.`
              : `There is already a code ${newCode}. Choose it under An Existing Code, or pick another code.`;
        }
        return failed(MESSAGES.checkFields, { newCode: message });
      }
      code = newCode;
      name = newName;
      added = true;
    }

    const saved = await saveMapping(supabase, inspection.id, target, code);
    refresh();
    if (!saved.ok) {
      return added ? warned(`Code ${code} added, but the label was not mapped. ${saved.message}`) : failed(saved.message);
    }

    const { change, refNo } = saved;
    const message = added
      ? `Code ${code} added. “${change.label}” on ${refNo} now counts as ${name}.`
      : `“${change.label}” on ${refNo} now counts as ${name} (${code}).`;
    const { error: logError } = await supabase.rpc("log_inspection_event", {
      inspection_id: inspection.id,
      action: "defect_label.mapped",
      changes: {
        module: change.module,
        kind: change.kind,
        class: change.defectClass,
        label: change.label,
        code: change.code,
        count: change.count,
        places: change.places,
        new_code: added,
      },
    });
    if (logError) {
      console.error("[admin/defects] mapping saved but not logged", logError.code, logError.message);
      return warned(`${message} Its audit trail could not record the change.`);
    }
    return succeeded(message);
  });
}

/* ------------------------------------------------------------------ *
 * Shortforms
 * ------------------------------------------------------------------ */

/** Why the shortforms cannot be saved now, or null when they can. */
function notSavable(state: GlossaryState): string | null {
  if (state.storage === "no_secret_key") return SHORTFORM_MESSAGES.noSecretKey;
  if (state.storage === "unavailable") return SHORTFORM_MESSAGES.unavailable;
  return null;
}

/**
 * Adds a shortform (`original` empty) or saves one (`original`: the entry as
 * the panel opened it). A code it newly links must be an active defect code,
 * read with the admin's own client; one it linked already may stay while
 * inactive. The list is saved whole (ai_settings.glossary, with who saved it
 * and when), so the change is applied to the list as it is now, and refused
 * when the entry changed since the panel opened it. Steri-AI reads the list
 * with every document, so it applies from the next one.
 */
export async function saveShortform(_previous: ShortformResult, formData: FormData): Promise<ShortformResult> {
  return guarded("saveShortform", async (): Promise<ShortformResult> => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return failed(auth.error);

    const form = readShortformForm(formData);
    if (!form.ok) return form.result;
    const { original, next } = form;

    const added = next.codes.filter((code) => !original?.codes.includes(code));
    if (added.length > 0) {
      const supabase = await createClient();
      const { data, error } = await supabase.from("defect_codes").select("code, active").in("code", added);
      if (error) throw new Error(`Could not read the defect codes: ${error.message}`);
      const active = new Set((data ?? []).filter((row) => row.active).map((row) => row.code));
      const refused = added.find((code) => !active.has(code));
      if (refused) return failed(MESSAGES.checkFields, { codes: notActiveCode(refused) });
    }

    const state = await loadGlossaryState();
    const blocked = notSavable(state);
    if (blocked) return failed(blocked);
    const change = applyShortformChange(state.entries, { original, next });
    if (!change.ok) return change.result;
    const saved = await saveGlossary(change.entries, auth.user.id);
    if (!saved.ok) return failed(saved.message);
    revalidatePath(DEFECTS_PATH, "layout");
    return succeeded(original ? `“${next.short}” saved.` : `“${next.short}” added.`);
  });
}

/** Deletes a shortform, as the panel opened it (`original`): refused when it changed since. */
export async function deleteShortform(_previous: ShortformResult, formData: FormData): Promise<ShortformResult> {
  return guarded("deleteShortform", async (): Promise<ShortformResult> => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return failed(auth.error);

    const original = readOriginal(formData);
    if (!original) return failed(MESSAGES.stale);

    const state = await loadGlossaryState();
    const blocked = notSavable(state);
    if (blocked) return failed(blocked);
    const change = applyShortformChange(state.entries, { original, next: null });
    if (!change.ok) return change.result;
    if (change.changed) {
      const saved = await saveGlossary(change.entries, auth.user.id);
      if (!saved.ok) return failed(saved.message);
    }
    revalidatePath(DEFECTS_PATH, "layout");
    return succeeded(change.changed ? `“${original.short}” deleted.` : `“${original.short}” was already deleted.`);
  });
}
