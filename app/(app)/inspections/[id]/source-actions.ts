"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { attachTargets, readSourceDocument, type SourceModule } from "@/lib/ai/source-reader";
import { loadAiEnv, loadGlossary } from "@/lib/ai/settings";
import { authorizeAction } from "@/lib/auth/session";
import {
  linkSourceFile,
  NOT_FILLED_BY_AI,
  SOURCE_DOCUMENTS_KEY,
  type SourceFileStatus,
  type SourceProposals,
} from "@/lib/inspections/source-documents";
import type { ModuleKey } from "@/lib/schemas/module-result";
import { ResolvedTemplateSchema } from "@/lib/schemas/template";
import type { DocumentMediaType } from "@/lib/schemas/document-fill";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { MODULE_REGISTRY } from "@/modules";
import { InspectionDataSchema, readModuleEntry } from "@/modules/_framework/data";
import type { FileKind } from "@/modules/_framework/files";

/*
 * Source Documents (docs/AI.md, "Source Documents"). Server Actions are
 * public endpoints: each checks the caller and reads through the caller's
 * client, so Row Level Security decides what they see. The reading is
 * recorded on the file row with the secret key, once the caller is known to
 * be allowed to edit the inspection: with the file's kind when the AI read
 * it as a lab report or certificate. The AI is told where this inspection
 * files a document itself, in the template's words (attachTargets), and the
 * file is linked there (linkSourceFile: tensile's or force at break's
 * labReport, a documents row's file, only where nothing is linked yet, never
 * over an earlier link), beside the values it read from it: module pages
 * link nothing by hand, and messages call the AI Steri-AI (Kenneth, 12
 * October 2026).
 */

export type SourceReadResult =
  | { status: "read"; summary: string; proposals: SourceProposals }
  | { status: "error"; message: string };

const IdSchema = z.uuid();
const READ_FAILED = "The file could not be read. Try again.";
const EDITABLE = new Set(["draft", "reopened"]);
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3.75 * 1024 * 1024;

/** Each Source Document's reading so far, by file id. */
export async function getSourceDocumentStatuses(inspectionId: string): Promise<Record<string, SourceFileStatus>> {
  const auth = await authorizeAction();
  if (!auth.ok || !IdSchema.safeParse(inspectionId).success) return {};
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inspection_files")
    .select("id, ai_status, ai_summary")
    .eq("inspection_id", inspectionId)
    .eq("module_key", SOURCE_DOCUMENTS_KEY);
  if (error) {
    console.error("[source documents] reading the statuses failed", error.code, error.message);
    return {};
  }
  const statuses: Record<string, SourceFileStatus> = {};
  for (const row of data) {
    if (row.ai_status === "read" || row.ai_status === "failed") statuses[row.id] = { status: row.ai_status, summary: row.ai_summary };
  }
  return statuses;
}

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

/**
 * Reads one Source Document with the AI and answers what it proposes for
 * the inspection's modules, the file itself as a step's lab report or a
 * documents row's file included. The capture screen fills the proposals into
 * empty fields only. A file the AI could not read is marked so, with why.
 */
export async function readSourceFile(inspectionId: string, fileId: string): Promise<SourceReadResult> {
  try {
    const auth = await authorizeAction();
    if (!auth.ok) return { status: "error", message: auth.error };
    const { user } = auth;
    if (!IdSchema.safeParse(inspectionId).success || !IdSchema.safeParse(fileId).success) {
      return { status: "error", message: "That file is not available." };
    }

    const supabase = await createClient();
    const [inspection, file] = await Promise.all([
      supabase
        .from("inspections")
        .select("id, status, inspector_id, data, module_overrides, template:templates(resolved)")
        .eq("id", inspectionId)
        .maybeSingle(),
      supabase
        .from("inspection_files")
        .select("id, name, storage_path, module_key")
        .eq("id", fileId)
        .eq("inspection_id", inspectionId)
        .maybeSingle(),
    ]);
    if (inspection.error || file.error) {
      console.error("[source documents] reading the inspection failed", inspection.error?.message ?? file.error?.message);
      return { status: "error", message: READ_FAILED };
    }
    if (!inspection.data || !file.data || file.data.module_key !== SOURCE_DOCUMENTS_KEY) {
      return { status: "error", message: "That file is not available." };
    }
    const row = inspection.data;
    if (!EDITABLE.has(row.status) || (user.role !== "admin" && row.inspector_id !== user.id)) {
      return { status: "error", message: "This inspection can no longer be changed here." };
    }
    const template = ResolvedTemplateSchema.safeParse(row.template?.resolved);
    const data = InspectionDataSchema.safeParse(row.data);
    if (!template.success || !data.success) return { status: "error", message: "This inspection's template or data cannot be read." };

    const [download, library] = await Promise.all([
      supabase.storage.from("inspection-files").download(file.data.storage_path),
      supabase.from("defect_codes").select("code, name").eq("active", true).order("name"),
    ]);
    if (download.error || !download.data) {
      console.error("[source documents] downloading the file failed", download.error?.message);
      return { status: "error", message: READ_FAILED };
    }
    const bytes = Buffer.from(await download.data.arrayBuffer());
    const mediaType = mediaTypeOf(bytes);
    const record = (status: "read" | "failed", summary: string, kind: FileKind | null = null) =>
      recordReading(fileId, status, summary, kind);
    if (!mediaType) {
      const message = "Steri-AI reads PDFs and photos (JPEG or PNG). Save this file as a PDF and upload it again.";
      await record("failed", message);
      return { status: "error", message };
    }
    if (bytes.length > (mediaType === "application/pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) {
      const message = "The file is too large for Steri-AI to read. Upload it in parts, a few pages at a time.";
      await record("failed", message);
      return { status: "error", message };
    }

    const switchedOff = new Set(Object.keys((row.module_overrides as Record<string, unknown> | null) ?? {}));
    const modules: SourceModule[] = [];
    const current: Record<string, unknown> = {};
    for (const entry of template.data.modules) {
      if (!entry.include || switchedOff.has(entry.key) || NOT_FILLED_BY_AI.includes(entry.key)) continue;
      const schema = dataJsonSchema(entry.key);
      if (schema === null) continue;
      modules.push({ key: entry.key, title: entry.title, config: entry.config, schema });
      current[entry.key] = readModuleEntry(data.data, "modules", entry.key).value ?? null;
    }
    const allowed = new Set<string>(modules.map((module) => module.key));

    const outcome = await readSourceDocument(
      {
        file: { mediaType, base64: bytes.toString("base64"), name: file.data.name },
        modules,
        sizes: template.data.sizes,
        unit: template.data.unit,
        current,
        defectLibrary: library.data ?? [],
        glossary: await loadGlossary(),
        // Where the file itself can go: the steps' lab reports and the checklist's rows, in the template's words.
        attachTargets: attachTargets(template.data.modules.filter((entry) => allowed.has(entry.key))),
      },
      await loadAiEnv(),
    );
    if (!outcome.ok) {
      // Not connected or set up wrongly is no fault of the file: it is read again once the AI is.
      if (outcome.reason === "error") await record("failed", outcome.message);
      return { status: "error", message: outcome.message };
    }

    const read = Object.fromEntries(Object.entries(outcome.proposals).filter(([key]) => allowed.has(key)));
    // The file itself as a step's lab report or a documents row's certificate: its id where none is kept yet.
    const { proposals, linked, kind } = linkSourceFile({
      proposals: read,
      attachTo: outcome.attachTo,
      fileId,
      data: data.data,
      registry: MODULE_REGISTRY,
      modules,
    });
    // Kept with the file: what it is, then how each shortform was read and recorded, for the admin to check.
    const readAs = outcome.mappings.length > 0 ? ` Read as: ${outcome.mappings.join("; ")}.` : "";
    await record("read", `${outcome.summary || "Read."}${readAs}`, kind);
    await logReading(inspectionId, { file: file.data.name, modules: Object.keys(proposals), linked, by: user.id, model: outcome.model });
    return { status: "read", summary: `${outcome.summary}${readAs}`.trim(), proposals };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[source documents] readSourceFile failed", error);
    return { status: "error", message: READ_FAILED };
  }
}

/**
 * Marks the file read or not, and what it is when the AI read it as a lab
 * report or certificate; a failure here is logged, the reading still counts.
 */
async function recordReading(fileId: string, status: "read" | "failed", summary: string, kind: FileKind | null): Promise<void> {
  const { error } = await createAdminClient()
    .from("inspection_files")
    .update({ ai_status: status, ai_read_at: new Date().toISOString(), ai_summary: summary.slice(0, 1000), ...(kind ? { kind } : {}) })
    .eq("id", fileId);
  if (error) console.error("[source documents] recording the reading failed", error.code, error.message);
}

/**
 * The inspection's audit log, written by the service role (inspectors record
 * only a few events themselves): `linked`, where the file itself was linked.
 */
async function logReading(
  inspectionId: string,
  changes: { file: string; modules: string[]; linked: string[]; by: string; model: string },
): Promise<void> {
  const { error } = await createAdminClient().rpc("log_inspection_event", {
    inspection_id: inspectionId,
    action: "source_document_read",
    changes,
  });
  if (error) console.error("[source documents] could not record the reading", error.code, error.message);
}
