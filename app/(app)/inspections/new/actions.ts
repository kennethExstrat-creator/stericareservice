"use server";

import { unstable_rethrow } from "next/navigation";
import { readableDocument } from "@/lib/ai/document-file";
import { readOrderDocument } from "@/lib/ai/document-reader";
import { loadAiEnv, loadGlossary } from "@/lib/ai/settings";
import { recordAiUsageLater } from "@/lib/ai/usage";
import { authorizeAction, userCan } from "@/lib/auth/session";
import { evaluateCapture } from "@/lib/inspections/capture/evaluate";
import { mirroredColumns } from "@/lib/inspections/capture/mirror";
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
import { applyDocumentFill, checkReading } from "@/lib/inspections/document-fill";
import { MANUFACTURER_NAMES_SELECT, manufacturerLabel, personLabel } from "@/lib/inspections/format";
import { DIRECTORY_SELECT, directoryFromRows, directoryFullNames } from "@/lib/inspections/reference-match";
import { createInspectionRow, serverWriter } from "@/lib/inspections/writes";
import { DOCUMENT_MAX_BYTES, DocumentFillSchema, type DocumentFill, type DocumentReadResult } from "@/lib/schemas/document-fill";
import { ResolvedTemplateSchema } from "@/lib/schemas/template";
import type { Json } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { templateCandidateFromRow, type TemplateCandidate } from "@/lib/templates/select";
import { MODULE_REGISTRY } from "@/modules";
import { InspectionDataSchema, type InspectionData } from "@/modules/_framework/data";

/*
 * Starts an inspection (BUILD_SPEC 4.4, 8 and 10). A Server Action is a public
 * endpoint: it checks the caller, validates the form with zod and decides the
 * template again from the database; the form's own choice is only a preview.
 * Everything is read through the caller's client, so Row Level Security
 * decides what they may start from. The draft is then written with the
 * secret key, for the caller, through public.create_inspection()
 * (lib/inspections/writes.ts): the database refuses an inspector's own insert,
 * since only this action chooses the template and fills in the data, and
 * checks the caller again: an inspector starts their own draft from an
 * active template; an admin may choose any template that is not retired. On
 * success it answers the new inspection's id: the form then hands the
 * Source Documents it holds to the page's upload queue and to Auto-Sort, for
 * the new inspection, and opens it on Source Documents. No file comes with
 * the form: they upload in the background, so the 5 MB limit of a Server
 * Action never applies to them.
 */

export type CreateInspectionState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Partial<Record<NewInspectionField, string>> }
  | { status: "created"; id: string };

const fail = (message: string, fieldErrors?: Partial<Record<NewInspectionField, string>>): CreateInspectionState => ({
  status: "error",
  message,
  ...(fieldErrors ? { fieldErrors } : {}),
});

const UNEXPECTED = "The inspection could not be created. Try again.";
const RELOAD = "Something changed while the form was open. Reload the page and try again.";

export async function createInspection(_previous: CreateInspectionState, formData: FormData): Promise<CreateInspectionState> {
  try {
    return await create(formData);
  } catch (error) {
    unstable_rethrow(error);
    console.error("[inspections/new] createInspection failed", error);
    return fail(UNEXPECTED);
  }
}

async function create(formData: FormData): Promise<CreateInspectionState> {
  const auth = await authorizeAction({ permission: "create_inspections" });
  if (!auth.ok) return fail(auth.error);
  const { user } = auth;

  const parsed = NewInspectionInputSchema.safeParse(readNewInspectionForm(formData));
  if (!parsed.success) return fail("Check the highlighted fields.", fieldErrorsOf(parsed.error));
  const input = parsed.data;
  const documentFill = readDocumentFill(formData);
  // Choosing another template stays with the role level, not a switch: it is a choice among the
  // templates people who see every inspection may start from (any not retired), where everyone
  // else starts from the active one the rule picks. create_inspection() checks the same.
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
    input.clientId ? supabase.from("clients").select("id, name").eq("id", input.clientId).maybeSingle() : null,
    // The factory with its company and brand, for its label; its address prefills the header (lib/coverage: header.factoryAddress).
    supabase.from("manufacturers").select(`id, address, ${MANUFACTURER_NAMES_SELECT}` as const).eq("id", input.manufacturerId).maybeSingle(),
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
  const started = newInspectionData({
    template: resolved.data,
    registry: MODULE_REGISTRY,
    inspectionDate,
    productName: input.productName,
    factoryAddress: manufacturer.data.address,
    previous: previousData,
  });
  const { copied } = started;
  // The order document's header values and order lines, where nothing is set yet.
  const fromDocument = documentFill ? applyDocumentFill(started.data, documentFill, resolved.data) : null;
  const data = fromDocument?.data ?? started.data;

  // The columns the list shows and searches (PO, product, lots, date, results) repeat the
  // data (BUILD_SPEC 6.2 rule 10): written exactly as the capture screen's save writes
  // them, so they match from the start and the first save changes none of them.
  const columns = mirroredColumns(
    evaluateCapture({
      template: resolved.data,
      overrides: {},
      data,
      meta: {
        refNo: null,
        inspectionDate,
        inspector: { id: user.id, name: personLabel({ full_name: user.fullName, email: user.email }) ?? "Inspector" },
        client: client?.data ? { id: client.data.id, name: client.data.name } : null,
        manufacturer: { id: manufacturer.data.id, name: manufacturerLabel(manufacturer.data) },
      },
    }),
  );

  const inserted = await createInspectionRow(supabase, serverWriter(user.id), {
    templateId: choice.template.id,
    clientId: input.clientId ?? null,
    manufacturerId: input.manufacturerId,
    data: data as unknown as NonNullable<Json>,
    columns: { ...columns, inspection_date: columns.inspection_date ?? inspectionDate },
  });
  if ("error" in inserted) {
    console.error("[inspections/new] insert refused", inserted.error.code, inserted.error.message);
    return fail(describeCreateError(inserted.error));
  }

  // The documents it was filled from follow through the upload queue as its Source Documents,
  // read in full on the capture screen: the record names them here.
  await recordHowItStarted(supabase, inserted.id, {
    previous: previous?.data ? { id: previous.data.id, refNo: previous.data.ref_no, copied } : null,
    document: documentFill && fromDocument ? { fileName: documentFill.fileName, filled: fromDocument.filled, by: user.id } : null,
    override:
      choice.specificity === "override"
        ? { chosen: choice.template, automatic: automaticChoice(candidates, input, user.role) }
        : null,
  });
  return { status: "created", id: inserted.id };
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
    document: { fileName: string; filled: string[]; by: string } | null;
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
  // An inspector records only a few events themselves (log_inspection_event), so the
  // service role writes this one, naming who uploaded the document.
  if (how.document) {
    try {
      const { error } = await createAdminClient().rpc("log_inspection_event", {
        inspection_id: inspectionId,
        action: "filled_from_document",
        changes: { file: how.document.fileName, filled: how.document.filled, by: how.document.by },
      });
      if (error) console.error("[inspections/new] could not record filled_from_document", error.code, error.message);
    } catch (error) {
      console.error("[inspections/new] could not record filled_from_document", error);
    }
  }
}

/**
 * The documents' header values and order lines the form posts with Create,
 * merged from every file read on the page (the first answer wins); anything
 * that does not check out is ignored.
 */
function readDocumentFill(formData: FormData): DocumentFill | null {
  const raw = formData.get("documentFill");
  if (typeof raw !== "string" || raw === "") return null;
  try {
    const parsed = DocumentFillSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const READ_FAILED = "The document could not be read. Try again.";
/** authorizeAction's words for a role that does not allow it. */
const NOT_ALLOWED = "You do not have permission to do that.";

/**
 * Reads one of the Source Documents held on the form with the AI (docs/AI.md,
 * "Reading order documents") and answers what the form can fill in. For
 * anyone whose role starts inspections and allows Steri-AI Reading (Fill From
 * a Document). The file is passed to the AI and not stored (it uploads after
 * Create); its bytes decide what it is, and an Excel or CSV file goes as its
 * text (lib/ai/document-file.ts). The lists
 * are read through the caller's client, so the AI matches only clients and
 * manufacturers the caller can pick; checkReading then matches by name what
 * it missed, and passes on what the document prints about a client or
 * manufacturer neither list has, for New Client and New Manufacturer
 * (./reference-actions.ts).
 */
export async function readDocument(formData: FormData): Promise<DocumentReadResult> {
  try {
    const auth = await authorizeAction({ permission: "ai_reading" });
    if (!auth.ok) return { status: "error", message: auth.error };
    // It fills in New Inspection, which only a role that starts inspections opens.
    if (!userCan(auth.user, "create_inspections")) return { status: "error", message: NOT_ALLOWED };

    const file = formData.get("document");
    if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Choose a file to read." };
    if (file.size > DOCUMENT_MAX_BYTES) {
      return { status: "error", message: "The file is larger than 4 MB. Upload just the pages with the order details." };
    }
    const readable = readableDocument(Buffer.from(await file.arrayBuffer()), { name: file.name, declared: file.type });
    if (!readable.ok) return { status: "error", message: readable.message };

    const supabase = await createClient();
    const [clients, brands] = await Promise.all([
      supabase.from("clients").select("id, name"),
      supabase.from("manufacturer_brands").select(DIRECTORY_SELECT),
    ]);
    if (clients.error || brands.error) {
      console.error("[inspections/new] reading the lists failed", clients.error?.message ?? brands.error?.message);
      return { status: "error", message: READ_FAILED };
    }
    const lists = { clients: clients.data, directory: directoryFromRows(brands.data) };

    const outcome = await readOrderDocument(
      readable.file,
      {
        clients: lists.clients,
        // Each factory by every name a document may print for it: brand, company and factory.
        manufacturers: directoryFullNames(lists.directory),
        glossary: await loadGlossary(),
      },
      await loadAiEnv(),
      // Its cost (Steri-AI Cost), recorded after the response: no inspection exists before Create.
      recordAiUsageLater({ feature: "new_inspection_read", inspectionId: null, actorId: auth.user.id, itemCount: 1 }),
    );
    if (!outcome.ok) return { status: "error", message: outcome.message };
    return { status: "read", fileName: file.name, ...checkReading(outcome.reading, lists, file.name) };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[inspections/new] readDocument failed", error);
    return { status: "error", message: READ_FAILED };
  }
}
