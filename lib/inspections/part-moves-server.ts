import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { partLabel, type InspectionPart } from "./parts";
import { loadParts } from "./parts-server";
import type { PartState } from "./part-moves";

/*
 * The parts of an inspection as a review decision weighs them
 * (lib/inspections/part-moves.ts): the parts loadParts finds, first part
 * first, each with its status, version and results read in one go, so the
 * status and the version belong together. Read through the caller's client:
 * Row Level Security decides what they see.
 */

type Client = Awaited<ReturnType<typeof createClient>>;

/** The states of these parts, in their order; null when they cannot be read. */
export async function readPartStates(client: Client, parts: readonly InspectionPart[]): Promise<PartState[] | null> {
  const { data, error } = await client
    .from("inspections")
    .select("id, ref_no, status, updated_at, result, suggested_result")
    .in(
      "id",
      parts.map((part) => part.id),
    );
  if (error) {
    console.error("[parts] reading the parts' states failed", error.code, error.message);
    return null;
  }
  const rows = new Map(data.map((row) => [row.id, row]));
  const states: PartState[] = [];
  for (const [index, part] of parts.entries()) {
    const row = rows.get(part.id);
    // Gone since loadParts read it (deleted): the caller reads the parts again.
    if (!row) return null;
    states.push({
      id: part.id,
      label: partLabel(part, index),
      refNo: row.ref_no,
      status: row.status,
      version: row.updated_at,
      primary: part.primary,
      result: row.result,
      suggestedResult: row.suggested_result,
    });
  }
  return states;
}

/** Every part of the inspection `inspectionId` belongs to, with its state; null when they cannot be read. */
export async function loadPartStates(client: Client, inspectionId: string): Promise<PartState[] | null> {
  const parts = await loadParts(client, inspectionId);
  return parts ? readPartStates(client, parts) : null;
}
