"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { authorizeAction } from "@/lib/auth/session";
import {
  chooseTemplate,
  describeCreateError,
  fieldErrorsOf,
  newInspectionData,
  NewInspectionInputSchema,
  previousMatches,
  readNewInspectionForm,
  todayInMalaysia,
  type NewInspectionField,
  type NewInspectionInput,
} from "@/lib/inspections/create";
import { INSPECTIONS_PATH } from "@/lib/inspections/search-params";
import { ResolvedTemplateSchema } from "@/lib/schemas/template";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { templateCandidateFromRow, type TemplateCandidate } from "@/lib/templates/select";
import { MODULE_REGISTRY } from "@/modules";
import { InspectionDataSchema, type InspectionData } from "@/modules/_framework/data";

/*
 * Starts an inspection (BUILD_SPEC 4.4, 8 and 10). A Server Action is a public
 * endpoint: it checks the caller, validates the form with zod and decides the
 * template again from the database; the form's own choice is only a preview.
 * Everything is read and written through the caller's client, so Row Level
 * Security and the database guards check it once more: an inspector creates
 * their own draft from an active template; an admin may choose any template
 * that is not retired. On success it goes straight to the capture screen.
 */

export type CreateInspectionState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Partial<Record<NewInspectionField, string>> };

type Outcome = CreateInspectionState | { status: "created"; id: string };

const fail = (message: string, fieldErrors?: Partial<Record<NewInspectionField, string>>): CreateInspectionState => ({
  status: "error",
  message,
  ...(fieldErrors ? { fieldErrors } : {}),
});

const UNEXPECTED = "The inspection could not be created. Try again.";
const RELOAD = "Something changed while the form was open. Reload the page and try again.";

export async function createInspection(_previous: CreateInspectionState, formData: FormData): Promise<CreateInspectionState> {
  let outcome: Outcome;
  try {
    outcome = await create(formData);
  } catch (error) {
    unstable_rethrow(error);
    console.error("[inspections/new] createInspection failed", error);
    outcome = fail(UNEXPECTED);
  }
  // Outside the try: redirect() throws to navigate.
  if (outcome.status === "created") redirect(`${INSPECTIONS_PATH}/${outcome.id}`);
  return outcome;
}

async function create(formData: FormData): Promise<Outcome> {
  const auth = await authorizeAction();
  if (!auth.ok) return fail(auth.error);
  const { user } = auth;

  const parsed = NewInspectionInputSchema.safeParse(readNewInspectionForm(formData));
  if (!parsed.success) return fail("Check the highlighted fields.", fieldErrorsOf(parsed.error));
  const input = parsed.data;
  if (input.templateId && user.role !== "admin") {
    const message = "Only an admin can choose the template.";
    return fail(message, { templateId: message });
  }

  const supabase = await createClient();
  const templateQuery = supabase
    .from("templates")
    .select("id, code, version, status, product_type, standard, client_id, manufacturer_id");
  const [templates, client, manufacturer, previous] = await Promise.all([
    user.role === "admin" ? templateQuery.neq("status", "retired") : templateQuery.eq("status", "active"),
    input.clientId ? supabase.from("clients").select("id").eq("id", input.clientId).maybeSingle() : null,
    supabase.from("manufacturers").select("id").eq("id", input.manufacturerId).maybeSingle(),
    input.previousId
      ? supabase
          .from("inspections")
          .select("id, ref_no, client_id, manufacturer_id, data, template:templates(product_type)")
          .eq("id", input.previousId)
          .maybeSingle()
      : null,
  ]);
  for (const [what, result] of [
    ["templates", templates],
    ["client", client],
    ["manufacturer", manufacturer],
    ["earlier inspection", previous],
  ] as const) {
    if (result?.error) {
      console.error(`[inspections/new] reading the ${what} failed`, result.error.code, result.error.message);
      return fail(UNEXPECTED);
    }
  }
  if (client && !client.data) return fail(RELOAD, { clientId: "That client is no longer in the list." });
  if (!manufacturer.data) return fail(RELOAD, { manufacturerId: "That manufacturer is no longer in the list." });

  const candidates = (templates.data ?? []).map(templateCandidateFromRow);
  const choice = chooseTemplate(candidates, input, user.role);
  if (!choice.ok) return fail(choice.message, choice.field ? { [choice.field]: choice.message } : undefined);

  const chosen = await supabase.from("templates").select("resolved").eq("id", choice.template.id).maybeSingle();
  if (chosen.error) {
    console.error("[inspections/new] reading the template failed", chosen.error.code, chosen.error.message);
    return fail(UNEXPECTED);
  }
  const resolved = ResolvedTemplateSchema.safeParse(chosen.data?.resolved);
  if (!resolved.success) {
    return fail(
      `${choice.template.code} version ${choice.template.version} cannot be used yet: an admin needs to save it again.`,
    );
  }

  let previousData: InspectionData | null = null;
  if (previous) {
    const row = previous.data;
    const message = "That earlier inspection is not available. Pick another or start blank.";
    if (!row) return fail(message, { previousId: message });
    const from = { clientId: row.client_id, manufacturerId: row.manufacturer_id, productType: row.template?.product_type ?? null };
    if (!previousMatches(from, input)) {
      const other = "That earlier inspection is for another client, manufacturer or product type.";
      return fail(other, { previousId: other });
    }
    const data = InspectionDataSchema.safeParse(row.data);
    previousData = data.success ? data.data : null;
  }

  const inspectionDate = todayInMalaysia();
  const { data, copied } = newInspectionData({
    template: resolved.data,
    registry: MODULE_REGISTRY,
    inspectionDate,
    productName: input.productName,
    previous: previousData,
  });

  const inserted = await supabase
    .from("inspections")
    .insert({
      template_id: choice.template.id,
      client_id: input.clientId,
      manufacturer_id: input.manufacturerId,
      // The row repeats the header's product name (BUILD_SPEC 6.2 rule 10), copied one included.
      product_name: headerText(data, "productName") ?? input.productName,
      inspection_date: inspectionDate,
      data: data as unknown as NonNullable<Json>,
    })
    .select("id")
    .single();
  if (inserted.error) {
    console.error("[inspections/new] insert refused", inserted.error.code, inserted.error.message);
    return fail(describeCreateError(inserted.error));
  }

  await recordHowItStarted(supabase, inserted.data.id, {
    previous: previous?.data ? { id: previous.data.id, refNo: previous.data.ref_no, copied } : null,
    override:
      choice.specificity === "override"
        ? { chosen: choice.template, automatic: automaticChoice(candidates, input, user.role) }
        : null,
  });
  return { status: "created", id: inserted.data.id };
}

function headerText(data: InspectionData, key: string): string | null {
  const header = data.modules.header;
  if (typeof header !== "object" || header === null) return null;
  const value = (header as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** What the rule would have picked without the admin's choice, for the record. */
function automaticChoice(
  candidates: readonly TemplateCandidate[],
  input: NewInspectionInput,
  role: "inspector" | "admin",
): TemplateCandidate | null {
  const choice = chooseTemplate(candidates, { ...input, templateId: undefined }, role);
  return choice.ok ? choice.template : null;
}

const ref = (template: TemplateCandidate) => ({ id: template.id, code: template.code, version: template.version });

/**
 * The audit trail records the inspection's creation itself. Two choices made
 * here go next to it: the inspection it started from, and an admin's
 * template override. A failure is logged, not shown: the inspection exists.
 */
async function recordHowItStarted(
  supabase: Awaited<ReturnType<typeof createClient>>,
  inspectionId: string,
  how: {
    previous: { id: string; refNo: string; copied: string[] } | null;
    override: { chosen: TemplateCandidate; automatic: TemplateCandidate | null } | null;
  },
): Promise<void> {
  const events: { action: string; changes: Json }[] = [];
  if (how.previous) {
    events.push({
      action: "started_from_previous",
      changes: { from: { id: how.previous.id, ref_no: how.previous.refNo }, copied: how.previous.copied },
    });
  }
  if (how.override) {
    events.push({
      action: "template_chosen",
      changes: { template: ref(how.override.chosen), instead_of: how.override.automatic ? ref(how.override.automatic) : null },
    });
  }
  for (const event of events) {
    const { error } = await supabase.rpc("log_inspection_event", { inspection_id: inspectionId, ...event });
    if (error) console.error(`[inspections/new] could not record ${event.action}`, error.code, error.message);
  }
}
