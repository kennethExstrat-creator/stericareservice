import "server-only";
import { evaluateCapture } from "@/lib/inspections/capture/evaluate";
import { mirroredColumns } from "@/lib/inspections/capture/mirror";
import { newInspectionData, todayInMalaysia } from "@/lib/inspections/create";
import { personLabel } from "@/lib/inspections/format";
import { createInspectionRow, serverWriter } from "@/lib/inspections/writes";
import { ResolvedTemplateSchema } from "@/lib/schemas/template";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import type { createClient } from "@/lib/supabase/server";
import { MODULE_REGISTRY } from "@/modules";
import { readModuleEntry, writeModuleData } from "@/modules/_framework/data";
import { groupIdOf, type InspectionPart } from "./parts";

/*
 * PO parts on the server (lib/inspections/parts.ts). Reads go through the
 * caller's client, so Row Level Security decides what they see; a new part
 * is written with the secret key, like every new inspection
 * (public.create_inspection()), for the inspection's own inspector.
 */

type Client = Awaited<ReturnType<typeof createClient>>;

const PART_COLUMNS = "id, ref_no, po_no, product_name, status, group_id, created_at";

/** Every part of the inspection `inspectionId` belongs to, first part first; null when it cannot be read. */
export async function loadParts(client: Client, inspectionId: string): Promise<InspectionPart[] | null> {
  const own = await client.from("inspections").select("id, group_id").eq("id", inspectionId).maybeSingle();
  if (own.error || !own.data) return null;
  const group = groupIdOf(own.data);
  const { data, error } = await client
    .from("inspections")
    .select(PART_COLUMNS)
    .or(`id.eq.${group},group_id.eq.${group}`)
    .order("created_at")
    .order("id");
  if (error) {
    console.error("[parts] reading the parts failed", error.code, error.message);
    return null;
  }
  return data.map((row) => ({
    id: row.id,
    refNo: row.ref_no,
    poNo: row.po_no,
    productName: row.product_name,
    status: row.status,
    primary: row.group_id === null,
  }));
}

export type CreatePartResult = { ok: true; id: string } | { ok: false; message: string };

const EDITABLE = new Set(["draft", "reopened"]);

/**
 * Adds a PO part to the inspection `inspectionId` belongs to: the same
 * client, manufacturer, template and inspector, empty modules (a PO can be
 * another variant, so no product facts are copied), the PO number when one
 * is given. The caller must be allowed to edit the inspection.
 */
export async function createPart(
  client: Client,
  user: { id: string; role: "inspector" | "admin" },
  inspectionId: string,
  poNo: string | null,
): Promise<CreatePartResult> {
  const own = await client
    .from("inspections")
    .select("id, group_id, status, inspector_id, template_id, client_id, manufacturer_id, inspection_date")
    .eq("id", inspectionId)
    .maybeSingle();
  if (own.error || !own.data) return { ok: false, message: "That inspection is not available." };
  const row = own.data;
  if (!EDITABLE.has(row.status) || (user.role !== "admin" && row.inspector_id !== user.id)) {
    return { ok: false, message: "This inspection can no longer be changed here." };
  }
  if (!row.manufacturer_id) return { ok: false, message: "This inspection has no manufacturer, so no PO can be added." };

  const [template, manufacturer, client_, inspector] = await Promise.all([
    client.from("templates").select("resolved").eq("id", row.template_id).maybeSingle(),
    client.from("manufacturers").select("id, name, address").eq("id", row.manufacturer_id).maybeSingle(),
    row.client_id ? client.from("clients").select("id, name").eq("id", row.client_id).maybeSingle() : null,
    client.from("profiles").select("full_name, email").eq("id", row.inspector_id).maybeSingle(),
  ]);
  const resolved = ResolvedTemplateSchema.safeParse(template.data?.resolved);
  if (!resolved.success || !manufacturer.data) return { ok: false, message: "This inspection's template cannot be read." };

  // The same visit: a new PO takes the inspection's date (on paper, the visit comes before the inspection is created).
  const inspectionDate = row.inspection_date ?? todayInMalaysia();
  let { data } = newInspectionData({
    template: resolved.data,
    registry: MODULE_REGISTRY,
    inspectionDate,
    productName: null,
    factoryAddress: manufacturer.data.address,
    previous: null,
  });
  const po = poNo?.trim().slice(0, 2000) || null;
  const header = readModuleEntry(data, "modules", "header");
  if (po && header.value && typeof header.value === "object") {
    data = writeModuleData(data, "modules", "header", { ...(header.value as Record<string, unknown>), poNo: po });
  }

  const columns = mirroredColumns(
    evaluateCapture({
      template: resolved.data,
      overrides: {},
      data,
      meta: {
        refNo: null,
        inspectionDate,
        inspector: { id: row.inspector_id, name: personLabel(inspector.data ?? null) ?? "Inspector" },
        client: client_?.data ? { id: client_.data.id, name: client_.data.name } : null,
        manufacturer: { id: manufacturer.data.id, name: manufacturer.data.name },
      },
    }),
  );

  // For the inspection's own inspector, so the part is theirs whoever adds it.
  const inserted = await createInspectionRow(client, serverWriter(row.inspector_id), {
    templateId: row.template_id,
    clientId: row.client_id,
    manufacturerId: row.manufacturer_id,
    data: data as unknown as NonNullable<Json>,
    columns: { ...columns, inspection_date: columns.inspection_date ?? inspectionDate },
  });
  if ("error" in inserted) {
    console.error("[parts] creating a part failed", inserted.error.code, inserted.error.message);
    return { ok: false, message: "The PO could not be added. Try again." };
  }

  const admin = createAdminClient();
  const group = groupIdOf(row);
  const linked = await admin.from("inspections").update({ group_id: group }).eq("id", inserted.id);
  if (linked.error) {
    console.error("[parts] linking the part failed", linked.error.code, linked.error.message);
    return { ok: false, message: "The PO was created but could not be linked. Reload and try again." };
  }
  const logged = await admin.rpc("log_inspection_event", {
    inspection_id: inserted.id,
    action: "part_added",
    changes: { inspection: group, po_no: po, by: user.id },
  });
  if (logged.error) console.error("[parts] could not record the new part", logged.error.code, logged.error.message);
  return { ok: true, id: inserted.id };
}
