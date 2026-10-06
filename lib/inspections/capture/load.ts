import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { InspectionResult, InspectionStatus } from "@/lib/schemas/common";
import { ResolvedTemplateSchema, type ModuleOverrides, type ResolvedTemplate } from "@/lib/schemas/template";
import type { Database } from "@/lib/supabase/database.types";
import { parseModuleOverrides } from "@/lib/templates";
import type { InspectionData } from "@/modules/_framework";
import { manufacturerLabel, personLabel } from "../format";
import type { CaptureMeta } from "./evaluate";

/**
 * Reads one inspection for the capture screen and its actions, always with
 * the signed-in user's client (lib/supabase/server): Row Level Security
 * decides whether it exists for this user (inspectors see their own, admins
 * every one). The template is the exact version the inspection started
 * with (`templates.resolved`), the per-inspection overrides come as stored.
 */

type Client = SupabaseClient<Database>;

/** The inspector embed names its foreign key because approved_by also points at profiles. */
export const CAPTURE_SELECT =
  "id, ref_no, status, data, module_overrides, updated_at, inspection_date, inspector_id, submitted_at, result, template:templates(id, code, version, resolved), client:clients(id, name), manufacturer:manufacturers(id, name, factory_name), inspector:profiles!inspections_inspector_id_fkey(id, full_name, email)";

type CaptureRow = {
  id: string;
  ref_no: string;
  status: InspectionStatus;
  data: unknown;
  module_overrides: unknown;
  updated_at: string;
  inspection_date: string;
  inspector_id: string;
  submitted_at: string | null;
  result: InspectionResult | null;
  template: { id: string; code: string; version: number; resolved: unknown } | null;
  client: { id: string; name: string } | null;
  manufacturer: { id: string; name: string; factory_name: string | null } | null;
  inspector: { id: string; full_name: string | null; email: string | null } | null;
};

export type CaptureInspection = {
  id: string;
  refNo: string;
  status: InspectionStatus;
  data: InspectionData;
  /** inspections.updated_at exactly as Postgres returned it: the autosave's version. */
  updatedAt: string;
  overrides: ModuleOverrides;
  inspectionDate: string;
  inspectorId: string;
  submittedAt: string | null;
  result: InspectionResult | null;
  template: { id: string; code: string; version: number; resolved: ResolvedTemplate };
  /** For the context: ref, date, inspector, client and manufacturer. */
  meta: CaptureMeta;
  /** "Terang Nusa Sdn. Bhd. · TG Factory 40". */
  manufacturerLabel: string | null;
};

export type CaptureLoad =
  | { kind: "found"; inspection: CaptureInspection }
  /** Not there, or not this user's to see. */
  | { kind: "not_found" }
  /** The template version cannot be read with this build's schema. */
  | { kind: "template_unreadable"; refNo: string; status: InspectionStatus; problem: string };

const UuidSchema = z.uuid();

export function isInspectionId(value: string): boolean {
  return UuidSchema.safeParse(value).success;
}

export async function loadCaptureInspection(client: Client, id: string): Promise<CaptureLoad> {
  if (!isInspectionId(id)) return { kind: "not_found" };
  const { data, error } = await client.from("inspections").select(CAPTURE_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load inspection ${id}: ${error.message}`);
  if (!data) return { kind: "not_found" };
  return toCaptureLoad(data as unknown as CaptureRow);
}

export function toCaptureLoad(row: CaptureRow): CaptureLoad {
  const resolved = ResolvedTemplateSchema.safeParse(row.template?.resolved);
  if (!row.template || !resolved.success) {
    const first = resolved.success ? null : resolved.error.issues[0];
    return {
      kind: "template_unreadable",
      refNo: row.ref_no,
      status: row.status,
      problem: first ? `${first.path.map(String).join(".") || "template"}: ${first.message}` : "no template",
    };
  }

  const inspectorName = personLabel(row.inspector) ?? "Inspector";
  return {
    kind: "found",
    inspection: {
      id: row.id,
      refNo: row.ref_no,
      status: row.status,
      data: normaliseData(row.data),
      updatedAt: row.updated_at,
      overrides: parseModuleOverrides(row.module_overrides),
      inspectionDate: row.inspection_date,
      inspectorId: row.inspector_id,
      submittedAt: row.submitted_at,
      result: row.result,
      template: { id: row.template.id, code: row.template.code, version: row.template.version, resolved: resolved.data },
      meta: {
        refNo: row.ref_no,
        inspectionDate: row.inspection_date,
        inspector: { id: row.inspector_id, name: inspectorName },
        client: row.client ? { id: row.client.id, name: row.client.name } : null,
        manufacturer: row.manufacturer ? { id: row.manufacturer.id, name: row.manufacturer.name } : null,
      },
      manufacturerLabel: row.manufacturer ? manufacturerLabel(row.manufacturer) : null,
    },
  };
}

/**
 * `{ modules, custom }` as stored. The column defaults to exactly that; a
 * missing or malformed half reads as empty, so the screen still opens.
 */
export function normaliseData(value: unknown): InspectionData {
  const record = isRecord(value) ? value : {};
  return {
    modules: isRecord(record.modules) ? record.modules : {},
    custom: isRecord(record.custom) ? record.custom : {},
  };
}

/**
 * Names of the admins who switched modules off, for "Switched off by …".
 * Inspectors may read only their own profile, so for them the names stay
 * unknown and the screen says "an admin".
 */
export async function loadOverrideAuthors(client: Client, overrides: ModuleOverrides): Promise<Record<string, string>> {
  const ids = [...new Set(Object.values(overrides).flatMap((override) => (override ? [override.by] : [])))];
  if (ids.length === 0) return {};
  const { data, error } = await client.from("profiles").select("id, full_name, email").in("id", ids);
  if (error || !data) return {};
  const names: Record<string, string> = {};
  for (const person of data) {
    const name = personLabel(person);
    if (name) names[person.id] = name;
  }
  return names;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
