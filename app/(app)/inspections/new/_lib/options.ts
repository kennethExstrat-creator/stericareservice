import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { copiedFieldsOff, latestPerProduct, type PreviousInspectionRow } from "@/lib/inspections/create";
import { manufacturerLabel } from "@/lib/inspections/format";
import { ResolvedTemplateSchema } from "@/lib/schemas/template";
import type { Database } from "@/lib/supabase/database.types";
import { templateCandidateFromRow } from "@/lib/templates/select";
import { templateSections } from "@/lib/templates/sections";
import type { NewInspectionOptions, TemplateOption } from "./types";

/**
 * Reads for /inspections/new, through the signed-in user's client: Row Level
 * Security decides what comes back (every active user reads the reference
 * tables and templates; inspectors only their own inspections).
 */

type Client = SupabaseClient<Database>;
type UserRole = Database["public"]["Enums"]["user_role"];

/**
 * How many recent inspections "start from previous" looks through. Inspectors
 * see their own, so this is years of work; for an admin, older products than
 * the newest 1000 inspections are not offered.
 */
export const PREVIOUS_SCAN_LIMIT = 1000;

export const TEMPLATE_SELECT =
  "id, code, version, status, product_type, standard, client_id, manufacturer_id, resolved" as const;

/**
 * Each earlier inspection with the three modules "start from previous" copies
 * (lib/inspections/create.ts PREVIOUS_COPY), not its whole data: the form
 * says what a copy would take.
 */
export const PREVIOUS_SELECT =
  "id, ref_no, inspection_date, status, created_at, client_id, manufacturer_id, product_name, template:templates(code, version, product_type), header:data->modules->header, glove_info:data->modules->glove_info, packing_config:data->modules->packing_config" as const;

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
      titles: {},
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
    titles: Object.fromEntries(template.modules.filter((entry) => entry.include).map((entry) => [entry.key, entry.title])),
    fieldsOff: copiedFieldsOff(template),
  };
}

function logFailure(what: string, error: { code?: string; message: string }) {
  console.error(`New inspection: loading ${what} failed`, { code: error.code, message: error.message });
}

/**
 * Clients, manufacturers, the templates the user may start from (active
 * ones; drafts as well for an admin, who can choose one) and the products of
 * their earlier inspections. Null when any of it cannot be read.
 */
export async function loadNewInspectionOptions(supabase: Client, role: UserRole): Promise<NewInspectionOptions | null> {
  const templates = supabase.from("templates").select(TEMPLATE_SELECT).order("code").order("version", { ascending: false });
  const [clients, manufacturers, templateRows, previous] = await Promise.all([
    supabase.from("clients").select("id, name").order("name"),
    supabase.from("manufacturers").select("id, name, factory_name").order("name").order("factory_name", { nullsFirst: true }),
    role === "admin" ? templates.neq("status", "retired") : templates.eq("status", "active"),
    supabase
      .from("inspections")
      .select(PREVIOUS_SELECT)
      .order("inspection_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(PREVIOUS_SCAN_LIMIT),
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
  if (previous.error) {
    logFailure("earlier inspections", previous.error);
    return null;
  }

  return {
    clients: clients.data.map((client) => ({ id: client.id, label: client.name })),
    manufacturers: manufacturers.data.map((manufacturer) => ({ id: manufacturer.id, label: manufacturerLabel(manufacturer) })),
    templates: templateRows.data.flatMap((row) => toTemplateOption(row) ?? []),
    previous: latestPerProduct(previous.data as PreviousInspectionRow[]),
  };
}
