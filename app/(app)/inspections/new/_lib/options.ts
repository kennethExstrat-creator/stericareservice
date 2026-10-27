import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { copiedFieldsOff } from "@/lib/inspections/create";
import { MANUFACTURER_NAMES_SELECT, manufacturerOptions } from "@/lib/inspections/format";
import { ResolvedTemplateSchema } from "@/lib/schemas/template";
import type { Database } from "@/lib/supabase/database.types";
import { templateCandidateFromRow } from "@/lib/templates/select";
import { templateSections } from "@/lib/templates/sections";
import type { NewInspectionOptions, TemplateOption } from "./types";

/**
 * Reads for /inspections/new, through the signed-in user's client: Row Level
 * Security decides what comes back (every active user reads the reference
 * tables and templates). No earlier inspections: Start From Previous is gone
 * (Kenneth, 26 October 2026).
 */

type Client = SupabaseClient<Database>;
type UserRole = Database["public"]["Enums"]["user_role"];

export const TEMPLATE_SELECT =
  "id, code, version, status, product_type, standard, client_id, manufacturer_id, resolved" as const;

type TemplateRow = Pick<
  Database["public"]["Tables"]["templates"]["Row"],
  "id" | "code" | "version" | "status" | "product_type" | "standard" | "client_id" | "manufacturer_id" | "resolved"
>;

/** A template row as the form shows it. A resolution that does not read leaves it listed but not ready. */
export function toTemplateOption(row: TemplateRow): TemplateOption | null {
  if (row.status === "retired") return null;
  const candidate = templateCandidateFromRow(row);
  const resolved = ResolvedTemplateSchema.safeParse(row.resolved);
  if (!resolved.success) {
    return {
      ...candidate,
      status: row.status,
      name: row.code,
      ready: false,
      unit: "pcs",
      sizes: [],
      sections: [],
      fieldsOff: {},
    };
  }
  const template = resolved.data;
  return {
    ...candidate,
    status: row.status,
    name: template.name,
    ready: true,
    unit: template.unit,
    sizes: template.sizes.map((size) => size.label),
    sections: templateSections(template).map((section) =>
      section.kind === "module" ? section.module.title : section.custom.title,
    ),
    fieldsOff: copiedFieldsOff(template),
  };
}

function logFailure(what: string, error: { code?: string; message: string }) {
  console.error(`New inspection: loading ${what} failed`, { code: error.code, message: error.message });
}

/**
 * Clients, manufacturers (each factory by its label, as the inspection names
 * it) and the templates the user may start from (active ones; drafts as well
 * for an admin, who can choose one). Null when any of it cannot be read.
 */
export async function loadNewInspectionOptions(supabase: Client, role: UserRole): Promise<NewInspectionOptions | null> {
  const templates = supabase.from("templates").select(TEMPLATE_SELECT).order("code").order("version", { ascending: false });
  const [clients, manufacturers, templateRows] = await Promise.all([
    supabase.from("clients").select("id, name").order("name"),
    supabase.from("manufacturers").select(`id, ${MANUFACTURER_NAMES_SELECT}` as const),
    role === "admin" ? templates.neq("status", "retired") : templates.eq("status", "active"),
  ]);
  if (clients.error) {
    logFailure("clients", clients.error);
    return null;
  }
  if (manufacturers.error) {
    logFailure("manufacturers", manufacturers.error);
    return null;
  }
  if (templateRows.error) {
    logFailure("templates", templateRows.error);
    return null;
  }

  return {
    clients: clients.data.map((client) => ({ id: client.id, label: client.name })),
    manufacturers: manufacturerOptions(manufacturers.data),
    templates: templateRows.data.flatMap((row) => toTemplateOption(row) ?? []),
  };
}
