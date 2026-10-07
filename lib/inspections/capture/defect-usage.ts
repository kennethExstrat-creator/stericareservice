// "Defect picker shows the most-used defects first" (BUILD_SPEC 8): how
// often each defect code was counted in earlier inspections the user can see
// (row level security: an inspector's own, every one for an admin) for the
// same client and manufacturer, else in any of them. Watertight's hole
// locations and visual's defects are both defect codes; one-off labels have
// no code and are left out. Read once when the screen opens and never
// updated while it is open, so rows do not move while the inspector counts.
// It orders rows only: no result changes with it.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/** Defects counted, by defect code. */
export type DefectUsage = Readonly<Record<string, number>>;

/** How many earlier inspections are read: the most recent ones say what this factory's gloves show now. */
export const USAGE_SAMPLE = 50;

const HANDS = ["R", "L"] as const;
const CLASSES = ["critical", "major", "minor"] as const;

/** Watertight's and visual's saved data of one earlier inspection, as stored. */
export type UsageEntry = { watertight: unknown; visual: unknown };

/** Sums the defects counted per code over saved watertight and visual data, read as tolerantly as it is stored. */
export function defectUsageFrom(entries: readonly UsageEntry[]): Record<string, number> {
  const usage: Record<string, number> = {};
  const add = (counts: unknown) => {
    if (!isRecord(counts)) return;
    for (const [code, count] of Object.entries(counts)) {
      if (typeof count === "number" && Number.isFinite(count) && count > 0) usage[code] = (usage[code] ?? 0) + count;
    }
  };
  for (const entry of entries) {
    for (const size of sizesOf(entry.watertight)) {
      add(size.holes);
      for (const hand of HANDS) add(field(size[hand], "holes"));
    }
    for (const size of sizesOf(entry.visual)) {
      for (const cls of CLASSES) {
        add(field(size[cls], "counts"));
        for (const hand of HANDS) add(field(field(size[hand], cls), "counts"));
      }
    }
  }
  return usage;
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/**
 * Reads the usage for an inspection's screen. A failed read gives no usage
 * (the template's order): it never stops the screen from opening.
 */
export async function loadDefectUsage(
  client: Client,
  inspection: { id: string; clientId: string | null; manufacturerId: string | null },
): Promise<DefectUsage> {
  try {
    const same = await readEntries(client, inspection.id, { clientId: inspection.clientId, manufacturerId: inspection.manufacturerId });
    const usage = defectUsageFrom(same);
    if (Object.keys(usage).length > 0) return usage;
    return defectUsageFrom(await readEntries(client, inspection.id, null));
  } catch (error) {
    console.error("[capture] defect usage could not be read", error);
    return {};
  }
}

async function readEntries(
  client: Client,
  inspectionId: string,
  scope: { clientId: string | null; manufacturerId: string | null } | null,
): Promise<UsageEntry[]> {
  let query = client
    .from("inspections")
    .select("watertight:data->modules->watertight, visual:data->modules->visual")
    .neq("id", inspectionId);
  if (scope) {
    query = scope.clientId === null ? query.is("client_id", null) : query.eq("client_id", scope.clientId);
    query = scope.manufacturerId === null ? query.is("manufacturer_id", null) : query.eq("manufacturer_id", scope.manufacturerId);
  }
  const { data, error } = await query.order("created_at", { ascending: false }).limit(USAGE_SAMPLE);
  if (error) throw new Error(error.message);
  return (data as unknown as UsageEntry[]) ?? [];
}

/** The per-size records of a module's saved data (`{ sizes: { M: {...} } }`). */
function sizesOf(data: unknown): Record<string, unknown>[] {
  if (!isRecord(data) || !isRecord(data.sizes)) return [];
  return Object.values(data.sizes).filter(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
