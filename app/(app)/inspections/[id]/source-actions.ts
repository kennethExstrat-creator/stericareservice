"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { readSourceDocument, type SourceModule, type SourcePart } from "@/lib/ai/source-reader";
import { loadAiEnv, loadGlossary } from "@/lib/ai/settings";
import { authorizeAction, type SessionUser } from "@/lib/auth/session";
import { captureAccess } from "@/lib/inspections/capture/access";
import { partLabel, type InspectionPart } from "@/lib/inspections/parts";
import { createPart, loadParts } from "@/lib/inspections/parts-server";
import { applyProposals, NOT_FILLED_BY_AI, SOURCE_DOCUMENTS_KEY, type SourceProposals } from "@/lib/inspections/source-documents";
import { sourceHomeOf, sourceHomes } from "@/lib/inspections/source-group";
import { describeOutcomes, partFacts, readingSummary, routeReading, type PartOutcome } from "@/lib/inspections/source-parts";
import {
  claimFile,
  fillPartOnServer,
  partModules,
  recordReading,
  releaseFile,
  type StoredReading,
} from "@/lib/inspections/source-parts-server";
import { JsonValueSchema } from "@/lib/schemas/common";
import type { DocumentMediaType } from "@/lib/schemas/document-fill";
import type { ModuleKey } from "@/lib/schemas/module-result";
import { ResolvedTemplateSchema, type ModuleOverrides, type ResolvedTemplate } from "@/lib/schemas/template";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseModuleOverrides } from "@/lib/templates";
import { MODULE_REGISTRY } from "@/modules";
import { InspectionDataSchema, readModuleEntry, type InspectionData } from "@/modules/_framework/data";

/*
 * Source Documents (docs/AI.md, "Source Documents"). Server Actions are
 * public endpoints: each checks the caller and reads through the caller's
 * client, so Row Level Security decides what they see. One set of files
 * serves every PO part of the inspection: they are kept on its first part
 * (lib/inspections/source-group.ts), and each is read once for all the
 * parts. The part whose screen asked gets its values back to fill in
 * through its autosave; the other parts are filled and saved here, and POs
 * no part has yet are added as parts (source-parts-server.ts). The reading
 * is recorded on the file row with the secret key, once the caller is
 * known to be allowed to edit the inspection.
 */

export type SourceReadResult =
  | {
      status: "read";
      /** Kept with the file: what it is, what happened to each PO, how shortforms were read. */
      summary: string;
      /** This part's values: the screen fills them into its empty fields through its autosave. */
      proposals: SourceProposals;
      /** What happened to the other POs, in a sentence or two; empty for an inspection of one PO. */
      others: string;
      /** The other parts filled here and the parts added: the screen reloads the list of POs. */
      changedParts: string[];
    }
  /** Another screen is reading the file: that reading counts for this part too. */
  | { status: "busy" }
  /** Read meanwhile, by another screen. */
  | { status: "done"; summary: string | null }
  | { status: "error"; message: string };

const IdSchema = z.uuid();
const READ_FAILED = "The file could not be read. Try again.";
const NOT_AVAILABLE = { status: "error", message: "That file is not available." } as const;
const EDITABLE = new Set(["draft", "reopened"]);
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3.75 * 1024 * 1024;

/** What the bytes are, from their first bytes: the AI reads PDFs, JPEG, PNG, WebP and GIF. */
function mediaTypeOf(bytes: Buffer): DocumentMediaType | null {
  const head = bytes.subarray(0, 12);
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (head.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  return null;
}

/** The JSON Schema of a module's data, as the AI reads it; null when it cannot be written. */
function dataJsonSchema(key: ModuleKey): unknown {
  try {
    const schema = z.toJSONSchema(MODULE_REGISTRY[key].dataSchema, { io: "input", unrepresentable: "any" });
    delete schema.$schema;
    return schema;
  } catch {
    return null;
  }
}

/** One part as a reading sees it: where it stands in the inspection, its data, what it fills, whether it may change. */
type GroupPart = { id: string; index: number; data: InspectionData; included: Set<string>; editable: boolean };

/**
 * Every part of the inspection this user may read, the first part first,
 * with its data; the asking part with the data just read. Parts share the
 * template, so each one's modules are the template's less its own overrides.
 */
async function readGroup(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: SessionUser,
  parts: readonly InspectionPart[],
  self: { id: string; data: InspectionData; overrides: ModuleOverrides },
  template: ResolvedTemplate,
): Promise<GroupPart[]> {
  const ids = parts.map((part) => part.id).filter((id) => id !== self.id);
  const rows = ids.length === 0
    ? []
    : ((await supabase.from("inspections").select("id, status, inspector_id, data, module_overrides").in("id", ids)).data ?? []);
  const order = parts.some((part) => part.id === self.id) ? parts.map((part) => part.id) : [self.id, ...ids];
  return order.flatMap((id, index): GroupPart[] => {
    if (id === self.id) return [{ id, index, data: self.data, included: partModules(template, self.overrides), editable: true }];
    const row = rows.find((candidate) => candidate.id === id);
    const data = InspectionDataSchema.safeParse(row?.data);
    if (!row || !data.success) return [];
    const access = captureAccess({ status: row.status, role: user.role, userId: user.id, inspectorId: row.inspector_id });
    return [{ id, index, data: data.data, included: partModules(template, parseModuleOverrides(row.module_overrides)), editable: access.editable }];
  });
}

/** A part's label from its data: "PO 2680276", or "PO 2" while it has none. */
function labelOf(part: Pick<GroupPart, "index">, data: InspectionData): string {
  return partLabel({ poNo: partFacts(data).poNo }, part.index);
}

/**
 * Reads one Source Document with the AI, once for every PO part of the
 * inspection, and answers what it proposes for this part's modules; the
 * other parts are filled here and the POs no part has yet are added. The
 * capture screen fills this part's proposals into empty fields only. A file
 * the AI could not read is marked so, with why.
 */
export async function readSourceFile(inspectionId: string, fileId: string): Promise<SourceReadResult> {
  // The file's reading before this one claimed it, until the reading is recorded: given back on any failure.
  let claimed: StoredReading | null = null;
  try {
    const auth = await authorizeAction();
    if (!auth.ok) return { status: "error", message: auth.error };
    const { user } = auth;
    if (!IdSchema.safeParse(inspectionId).success || !IdSchema.safeParse(fileId).success) return NOT_AVAILABLE;

    const supabase = await createClient();
    const parts = (await loadParts(supabase, inspectionId)) ?? [];
    const [inspection, file] = await Promise.all([
      supabase
        .from("inspections")
        .select("id, status, inspector_id, data, module_overrides, template:templates(resolved)")
        .eq("id", inspectionId)
        .maybeSingle(),
      // The inspection's Source Documents: its first part's, or this part's own.
      supabase
        .from("inspection_files")
        .select("id, name, storage_path, module_key, ai_status, ai_read_at, ai_summary")
        .eq("id", fileId)
        .in("inspection_id", sourceHomes(sourceHomeOf(parts, inspectionId), inspectionId))
        .maybeSingle(),
    ]);
    if (inspection.error || file.error) {
      console.error("[source documents] reading the inspection failed", inspection.error?.message ?? file.error?.message);
      return { status: "error", message: READ_FAILED };
    }
    if (!inspection.data || !file.data || file.data.module_key !== SOURCE_DOCUMENTS_KEY) return NOT_AVAILABLE;
    const row = inspection.data;
    if (!EDITABLE.has(row.status) || (user.role !== "admin" && row.inspector_id !== user.id)) {
      return { status: "error", message: "This inspection can no longer be changed here." };
    }
    const template = ResolvedTemplateSchema.safeParse(row.template?.resolved);
    const data = InspectionDataSchema.safeParse(row.data);
    if (!template.success || !data.success) return { status: "error", message: "This inspection's template or data cannot be read." };
    const group = await readGroup(
      supabase,
      user,
      parts,
      { id: inspectionId, data: data.data, overrides: parseModuleOverrides(row.module_overrides) },
      template.data,
    );
    const self = group.find((part) => part.id === inspectionId);
    if (!self) return { status: "error", message: READ_FAILED };

    // One reading per file, whichever screen asks: another one holding it counts for this part too.
    const claim = await claimFile(fileId);
    if (claim.kind === "busy") return { status: "busy" };
    if (claim.kind === "read") return { status: "done", summary: claim.summary };
    if (claim.kind === "error") return { status: "error", message: READ_FAILED };
    claimed = { ai_status: file.data.ai_status, ai_read_at: file.data.ai_read_at, ai_summary: file.data.ai_summary };

    const [download, library] = await Promise.all([
      supabase.storage.from("inspection-files").download(file.data.storage_path),
      supabase.from("defect_codes").select("code, name").eq("active", true).order("name"),
    ]);
    if (download.error || !download.data) {
      console.error("[source documents] downloading the file failed", download.error?.message);
      await releaseFile(fileId, claimed);
      claimed = null;
      return { status: "error", message: READ_FAILED };
    }
    const bytes = Buffer.from(await download.data.arrayBuffer());
    const mediaType = mediaTypeOf(bytes);
    const failed = async (message: string) => {
      await recordReading(fileId, "failed", message);
      claimed = null;
      return { status: "error", message } as const;
    };
    if (!mediaType) return failed("The AI reads PDFs and photos (JPEG or PNG). Save this file as a PDF and upload it again.");
    if (bytes.length > (mediaType === "application/pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) {
      return failed("The file is too large for the AI to read. Upload it in parts, a few pages at a time.");
    }

    // The modules any part that may change fills, once (the parts share the template); then each part.
    const modules: SourceModule[] = [];
    for (const entry of template.data.modules) {
      if (!entry.include || NOT_FILLED_BY_AI.includes(entry.key)) continue;
      if (!group.some((part) => part.editable && part.included.has(entry.key))) continue;
      const schema = dataJsonSchema(entry.key);
      if (schema !== null) modules.push({ key: entry.key, title: entry.title, config: entry.config, schema });
    }
    const keys = new Set(modules.map((module) => module.key));
    const sourceParts: SourcePart[] = group.map((part) => {
      const facts = partFacts(part.data);
      const current: Record<string, unknown> = {};
      for (const key of keys) if (part.included.has(key)) current[key] = readModuleEntry(part.data, "modules", key).value ?? null;
      return { id: part.id, label: labelOf(part, part.data), ...facts, editable: part.editable, current };
    });

    const outcome = await readSourceDocument(
      {
        file: { mediaType, base64: bytes.toString("base64"), name: file.data.name },
        modules,
        sizes: template.data.sizes,
        unit: template.data.unit,
        parts: sourceParts,
        defectLibrary: library.data ?? [],
        glossary: await loadGlossary(),
      },
      await loadAiEnv(),
    );
    if (!outcome.ok) {
      // Not connected or set up wrongly is no fault of the file: it is read again once the AI is.
      if (outcome.reason === "error") return failed(outcome.message);
      await releaseFile(fileId, claimed);
      claimed = null;
      return { status: "error", message: outcome.message };
    }

    const { answer } = outcome;
    const route = routeReading(
      answer,
      group.map((part) => ({ id: part.id, poNo: partFacts(part.data).poNo, editable: part.editable })),
      inspectionId,
    );
    const proposals = Object.fromEntries(
      Object.entries(route.byPart[inspectionId] ?? {}).filter(([key]) => keys.has(key) && self.included.has(key)),
    );
    // A report per part only where there is more than this one: alone, the screen says what it filled.
    const several = group.length > 1 || route.create.length > 0 || route.dropped > 0;
    const all: PartOutcome[] = [];
    const others: PartOutcome[] = [];
    const filledParts: string[] = [];
    const addedParts: string[] = [];
    for (const part of group) {
      const proposed = route.byPart[part.id];
      if (!proposed) continue;
      if (part.id === inspectionId) {
        if (!several) continue;
        // Filled by the screen that asked: counted on its latest saved copy.
        const latest = await supabase.from("inspections").select("data").eq("id", inspectionId).maybeSingle();
        const base = InspectionDataSchema.safeParse(latest.data?.data);
        const counted = applyProposals(base.success ? base.data : part.data, proposals, MODULE_REGISTRY, part.included);
        all.push({ kind: "filled", label: labelOf(part, counted.data), filled: counted.filled });
        continue;
      }
      const fill = await fillPartOnServer(supabase, user, part.id, proposed);
      const result: PartOutcome =
        fill.kind === "filled"
          ? { kind: "filled", label: partLabel({ poNo: fill.poNo }, part.index), filled: fill.filled }
          : { kind: "skipped", label: labelOf(part, part.data), reason: fill.reason };
      if (fill.kind === "filled" && fill.filled > 0) filledParts.push(part.id);
      all.push(result);
      others.push(result);
    }
    for (const [offset, entry] of route.create.entries()) {
      const label = partLabel({ poNo: entry.poNo }, group.length + offset);
      const created = await createPart(supabase, user, inspectionId, entry.poNo);
      let result: PartOutcome;
      if (!created.ok) {
        result = { kind: "not_added", label, message: created.message };
      } else {
        addedParts.push(created.id);
        const fill = await fillPartOnServer(supabase, user, created.id, entry.proposals);
        result = fill.kind === "filled" ? { kind: "added", label, filled: fill.filled } : { kind: "added", label, filled: 0, problem: fill.reason };
      }
      all.push(result);
      others.push(result);
    }

    const summary = readingSummary(answer.summary, several ? describeOutcomes(all, route.dropped) : "", answer.mappings);
    await recordReading(fileId, "read", summary);
    claimed = null;
    await logReading(inspectionId, {
      file: file.data.name,
      modules: Object.keys(proposals),
      filledParts,
      addedParts,
      by: user.id,
      model: outcome.model,
    });
    return {
      status: "read",
      summary,
      proposals,
      others: several ? describeOutcomes(others, route.dropped) : "",
      changedParts: [...filledParts, ...addedParts],
    };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[source documents] readSourceFile failed", error);
    if (claimed) await releaseFile(fileId, claimed).catch(() => undefined);
    return { status: "error", message: READ_FAILED };
  }
}

const ProposalsSchema = z.record(z.string().min(1).max(64), z.record(z.string(), JsonValueSchema));

/**
 * Fills a reading's values for this part here instead of on its screen: the
 * screen that asked for the reading had gone by the time it came back
 * (another PO opened meanwhile). The same fill as every other part's.
 */
export async function fillSourcePart(inspectionId: string, proposals: unknown): Promise<{ filled: number } | { error: string }> {
  try {
    const auth = await authorizeAction();
    if (!auth.ok) return { error: auth.error };
    const parsed = ProposalsSchema.safeParse(proposals);
    if (!IdSchema.safeParse(inspectionId).success || !parsed.success) return { error: "The request was not understood." };
    const fill = await fillPartOnServer(await createClient(), auth.user, inspectionId, parsed.data);
    return fill.kind === "filled" ? { filled: fill.filled } : { error: `Nothing was filled: ${fill.reason}.` };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[source documents] fillSourcePart failed", error);
    return { error: "The values could not be filled. Try again." };
  }
}

/** The inspection's audit log, written by the service role (inspectors record only a few events themselves). */
async function logReading(
  inspectionId: string,
  changes: { file: string; modules: string[]; filledParts: string[]; addedParts: string[]; by: string; model: string },
): Promise<void> {
  const { error } = await createAdminClient().rpc("log_inspection_event", {
    inspection_id: inspectionId,
    action: "source_document_read",
    changes,
  });
  if (error) console.error("[source documents] could not record the reading", error.code, error.message);
}
