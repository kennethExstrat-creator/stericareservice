import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { DIRECTORY_SELECT, directoryFromRows, directoryOptions, type ManufacturerDirectory } from "./reference-match";

/**
 * The clients and manufacturers the pickers offer, read through the
 * signed-in user's client (every active user reads the reference tables):
 * New Inspection's, and General Information's on the capture screen while
 * the inspection can be changed (Kenneth, 30 October 2026: "manufacturer and
 * client should be editable"), so both list the same, the same way. Clients
 * by name; each factory by its label, "Top Glove · TG-F40", read as brands
 * with their companies and factories in one query, so they come from one
 * moment (New Manufacturer matches a document's names against the
 * directory). Null when either cannot be read.
 */

type Client = SupabaseClient<Database>;

export type PickerOption = { id: string; label: string };

export type PickerOptions = {
  clients: PickerOption[];
  manufacturers: PickerOption[];
  directory: ManufacturerDirectory;
};

/** @param where names the screen in the log line when a list cannot be read: "New inspection", "Capture". */
export async function loadPickerOptions(supabase: Client, where: string): Promise<PickerOptions | null> {
  const [clients, brands] = await Promise.all([
    supabase.from("clients").select("id, name").order("name"),
    supabase.from("manufacturer_brands").select(DIRECTORY_SELECT),
  ]);
  for (const [what, result] of [
    ["clients", clients],
    ["manufacturers", brands],
  ] as const) {
    if (result.error) {
      console.error(`${where}: loading ${what} failed`, { code: result.error.code, message: result.error.message });
      return null;
    }
  }
  const directory = directoryFromRows(brands.data ?? []);
  return {
    clients: (clients.data ?? []).map((client) => ({ id: client.id, label: client.name })),
    manufacturers: directoryOptions(directory),
    directory,
  };
}
