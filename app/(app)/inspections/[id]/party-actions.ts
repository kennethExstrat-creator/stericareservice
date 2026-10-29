"use server";

import { refresh, revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeAction } from "@/lib/auth/session";
import { captureAccess, EDITABLE_STATUSES, readOnlyMessage } from "@/lib/inspections/capture/access";
import { PARTY_MESSAGES, partyChangedEvent, type InspectionParty, type PartyRef } from "@/lib/inspections/capture/party-events";
import { PartyChangeInputSchema } from "@/lib/inspections/capture/schemas";
import { MANUFACTURER_NAMES_SELECT, manufacturerBrand, manufacturerLabel, type ManufacturerNames } from "@/lib/inspections/format";
import { INSPECTIONS_PATH } from "@/lib/inspections/search-params";
import { FAILURE_MESSAGES } from "@/lib/offline/failures";
import type { InspectionStatus } from "@/lib/schemas/common";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/*
 * General Information's Client Name and Manufacturer / Supplier on the
 * capture screen (Kenneth, 30 October 2026: "manufacturer and client should
 * be editable"): the inspection row's client_id and manufacturer_id, chosen
 * on New Inspection, changed here. A public endpoint like every Server
 * Action. Who may change them is who may save the inspection's data
 * (saveCaptureData): the session checked (authorizeAction), the inspection
 * read with the user's own client, so Row Level Security decides whether it
 * exists for them, and the capture rule (captureAccess: its inspector or an
 * admin, while it is a draft or reopened). The new id must be a listed
 * client (or none) or factory, read with the user's client too; one already
 * set changes nothing.
 *
 * The column is written with the secret key, for the user, as their data
 * is (the database refuses an inspector's own update): only while the
 * inspection is still a draft or reopened and still has the client or
 * factory just read, so a change made meanwhile is never overwritten or
 * misrecorded. Then one audit row in the user's name (party-events.ts), the
 * old and new names as they read now: added directly with the secret key,
 * which may only add and read rows (an inspector records few events
 * themselves). The change stands if that row fails; the answer says so.
 * Without the secret key the user's own session writes, which only an admin's
 * may (lib/inspections/writes.ts).
 *
 * The capture screen shows the answer's names at once; the action refreshes
 * the screen's page, so its header line, the Report page and Steri-AI follow
 * the row, and the list (every server reader joins the row: the list, the
 * export, the report, the sampling plan's "Prepared for", Steri-AI). A
 * manufacturer change answers the old and new factory's stored addresses:
 * the screen puts the new one in the header's factory address through its
 * autosave, as New Inspection filled it, unless the inspector typed their own
 * (followFactoryAddress, modules/header/edit.ts). Only the column moves here,
 * never the data, so the autosave's next save goes on on top of it.
 */

export type PartyName = { id: string; name: string };

export type ChangePartyResult =
  | {
      ok: true;
      party: "client";
      /** False when the client was already this one: nothing was written. */
      changed: boolean;
      client: PartyName | null;
      /** The change stands but its audit row could not be written. */
      warning?: string;
    }
  | {
      ok: true;
      party: "manufacturer";
      changed: boolean;
      /** `name`: the factory's label, "Top Glove · TG-F40"; `brand`: the capture header line's "Top Glove". */
      manufacturer: PartyName & { brand: string | null };
      /** The old and new factory's stored addresses (manufacturers.address), for the header's factory address. */
      address: { previous: string | null; next: string | null };
      warning?: string;
    }
  | { ok: false; message: string };

type Client = SupabaseClient<Database>;
type Factory = { id: string; address: string | null } & ManufacturerNames;

const ROW_SELECT = `id, status, inspector_id, client:clients(id, name), manufacturer:manufacturers(id, address, ${MANUFACTURER_NAMES_SELECT})` as const;
const FACTORY_SELECT = `id, address, ${MANUFACTURER_NAMES_SELECT}` as const;

type Row = {
  id: string;
  status: InspectionStatus;
  inspector_id: string;
  client: PartyName | null;
  manufacturer: Factory | null;
};

/** Who writes: the secret-key client for the user (`admin`), or the user's own session on a server without the key. */
type Writer = { client: Client; admin: boolean; actorId: string };

const failed = (message: string) => ({ ok: false, message }) as const;

export async function changeInspectionParty(input: unknown): Promise<ChangePartyResult> {
  try {
    const auth = await authorizeAction();
    if (!auth.ok) return failed(auth.error);

    const parsed = PartyChangeInputSchema.safeParse(input);
    if (!parsed.success) return failed(PARTY_MESSAGES.invalid);
    const request = parsed.data;

    const supabase = await createClient();
    const read = await supabase.from("inspections").select(ROW_SELECT).eq("id", request.inspectionId).maybeSingle();
    if (read.error) throw new Error(`Could not read inspection ${request.inspectionId}: ${read.error.message}`);
    if (!read.data) return failed(FAILURE_MESSAGES.not_found);
    const row = read.data as unknown as Row;

    const access = captureAccess({
      status: row.status,
      role: auth.user.role,
      userId: auth.user.id,
      inspectorId: row.inspector_id,
    });
    if (!access.editable) return failed(readOnlyMessage(row.status));

    const writer: Writer = isAdminClientConfigured()
      ? { client: createAdminClient(), admin: true, actorId: auth.user.id }
      : { client: supabase, admin: false, actorId: auth.user.id };

    if (request.party === "client") {
      const from = row.client ? { id: row.client.id, name: row.client.name } : null;
      if ((from?.id ?? null) === request.id) return { ok: true, party: "client", changed: false, client: from };
      let to: PartyName | null = null;
      if (request.id !== null) {
        const listed = await supabase.from("clients").select("id, name").eq("id", request.id).maybeSingle();
        if (listed.error) throw new Error(`Could not read client ${request.id}: ${listed.error.message}`);
        if (!listed.data) return failed(PARTY_MESSAGES.clientGone);
        to = { id: listed.data.id, name: listed.data.name };
      }
      const written = await writeColumn(writer, row.id, "client", from?.id ?? null, to?.id ?? null);
      if (written) return failed(written);
      const logged = await recordChange(writer, row.id, "client", from, to);
      refreshViews();
      return { ok: true, party: "client", changed: true, client: to, ...(logged ? {} : { warning: PARTY_MESSAGES.notLogged }) };
    }

    const previous = row.manufacturer;
    const named = (factory: Factory) => ({ id: factory.id, name: manufacturerLabel(factory), brand: manufacturerBrand(factory) });
    if (previous?.id === request.id) {
      return { ok: true, party: "manufacturer", changed: false, manufacturer: named(previous), address: { previous: previous.address, next: previous.address } };
    }
    const listed = await supabase.from("manufacturers").select(FACTORY_SELECT).eq("id", request.id).maybeSingle();
    if (listed.error) throw new Error(`Could not read manufacturer ${request.id}: ${listed.error.message}`);
    if (!listed.data) return failed(PARTY_MESSAGES.manufacturerGone);
    const next = listed.data as unknown as Factory;
    const written = await writeColumn(writer, row.id, "manufacturer", previous?.id ?? null, next.id);
    if (written) return failed(written);
    const to = named(next);
    const logged = await recordChange(writer, row.id, "manufacturer", previous ? { id: previous.id, name: manufacturerLabel(previous) } : null, {
      id: to.id,
      name: to.name,
    });
    refreshViews();
    return {
      ok: true,
      party: "manufacturer",
      changed: true,
      manufacturer: to,
      address: { previous: previous?.address ?? null, next: next.address },
      ...(logged ? {} : { warning: PARTY_MESSAGES.notLogged }),
    };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[capture] changing the client or manufacturer failed", error);
    return failed(PARTY_MESSAGES.notSaved);
  }
}

/**
 * Writes the column while the inspection is still a draft or reopened and
 * still has `from`. Answers null once written, else what to tell the user.
 */
async function writeColumn(
  writer: Writer,
  inspectionId: string,
  party: InspectionParty,
  from: string | null,
  to: string | null,
): Promise<string | null> {
  const column = party === "client" ? "client_id" : "manufacturer_id";
  const update = writer.client
    .from("inspections")
    .update(party === "client" ? { client_id: to } : { manufacturer_id: to })
    .eq("id", inspectionId)
    .in("status", [...EDITABLE_STATUSES]);
  const { data, error } = await (from === null ? update.is(column, null) : update.eq(column, from)).select("id");
  if (error) {
    console.error(`[capture] the ${party} change was refused`, error.code, error.message);
    // Row level security or the guard: a session that may not write the inspection directly.
    return error.code === "42501" ? FAILURE_MESSAGES.forbidden : PARTY_MESSAGES.notSaved;
  }
  return data && data.length > 0 ? null : PARTY_MESSAGES.changedMeanwhile;
}

/** The audit row, in the user's name. True once written. */
async function recordChange(
  writer: Writer,
  inspectionId: string,
  party: InspectionParty,
  from: PartyRef | null,
  to: PartyRef | null,
): Promise<boolean> {
  const { action, changes } = partyChangedEvent(party, from, to);
  try {
    const { error } = writer.admin
      ? await writer.client.from("audit_log").insert({ inspection_id: inspectionId, actor_id: writer.actorId, action, changes })
      : await writer.client.rpc("log_inspection_event", { inspection_id: inspectionId, action, changes });
    if (error) console.error(`[capture] could not record ${action}`, error.code, error.message);
    return !error;
  } catch (error) {
    console.error(`[capture] could not record ${action}`, error);
    return false;
  }
}

/**
 * The screen's page, for its header line and everything built from the row,
 * and the pages that list the inspection (the list; every page visited
 * before is fetched again when it is next opened).
 */
function refreshViews(): void {
  revalidatePath(INSPECTIONS_PATH);
  refresh();
}
