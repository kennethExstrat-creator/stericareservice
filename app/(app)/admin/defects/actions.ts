"use server";

import { refresh } from "next/cache";
import {
  ActiveTargetSchema,
  CodeTargetSchema,
  DefectCodeDetailsSchema,
  EditTargetSchema,
  MAP_FIELDS,
  MESSAGES,
  MapChoiceSchema,
  MapTargetSchema,
  NewDefectCodeSchema,
  canMap,
  deleteBlocker,
  describeCodeInsertError,
  describeCodeWriteError,
  describeMappingProblem,
  failed,
  fieldErrors,
  guarded,
  inspectionCountingCode,
  loadTemplates,
  mapOneOffLabel,
  readDefectCode,
  readForm,
  succeeded,
  templatesMentioning,
  warned,
  type ActionResult,
  type DatabaseClient,
  type DefectCodeField,
  type LabelTarget,
  type MapField,
  type MappingChange,
} from "@/lib/admin/defects";
import { authorizeAction } from "@/lib/auth/session";
import type { InspectionStatus } from "@/lib/schemas/common";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/*
 * Actions for /admin/defects (BUILD_SPEC 4.2 rule 4 and 10). Server Actions
 * are public HTTP endpoints: each one checks for an active admin first,
 * validates its input with zod and re-reads what it needs. Writes go through
 * the admin's own client, so Row Level Security and the database guards
 * check them again (an approved inspection stays read-only whatever the
 * page sent).
 */

export type CodeFormResult = ActionResult<DefectCodeField>;
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
      // The page reloads its data, so the panel holds the newer version for a second try.
      refresh();
      return failed(
        current
          ? "Someone else changed this code while you were editing. Close the panel to see their changes, or save again to replace them with yours."
          : "This code has been deleted, so your changes were not saved.",
      );
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
 * Deletes a code nothing uses: no template version mentions it and no
 * inspection counts it. The page offers it only for codes no template
 * mentions; inspections are checked here, at the moment it counts.
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
    const blocker = deleteBlocker({ inTemplates: templatesMentioning(await loadTemplates(supabase), code) });
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

type InspectionRow = { id: string; ref_no: string; status: InspectionStatus; updated_at: string; data: unknown };

async function readInspection(supabase: DatabaseClient, id: string): Promise<InspectionRow | null> {
  const { data, error } = await supabase
    .from("inspections")
    .select("id, ref_no, status, updated_at, data")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read inspection ${id}: ${error.message}`);
  return data;
}

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
    const outcome = mapOneOffLabel(row.data, target, code);
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
 * recorded on the inspection's data, so the label counts with that code
 * from then on, and logged in the inspection's audit trail. Only submitted
 * inspections: drafts and reopened ones are still the inspector's to change,
 * and approved ones are final.
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
    const wanted = choice.data.mode === "existing" ? choice.data.code : choice.data.newCode;
    const check = mapOneOffLabel(inspection.data, target, wanted);
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
        const message =
          error.code === "23505"
            ? `There is already a code ${newCode}. Choose it under An existing code, or pick another code.`
            : refused.message;
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
        size: change.size,
        hand: change.hand,
        class: change.defectClass,
        label: change.label,
        count: change.count,
        code: change.code,
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
