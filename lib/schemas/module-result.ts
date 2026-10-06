import { z } from "zod";
import { SizeSchema } from "./common";

/* ------------------------------------------------------------------ *
 * Module keys (BUILD_SPEC 6.1)
 * ------------------------------------------------------------------ */

/** Modules that mirror the finished preshipment reports, in report order. */
export const REPORT_MODULE_KEYS = [
  "header",
  "glove_info",
  "order_lots",
  "packing_config",
  "sampling_plan",
  "carton_sampling",
  "dimensions",
  "weight",
  "force_at_break",
  "tensile",
  "watertight",
  "visual",
  "dispensing_packing",
  "dispensing_safedon",
  "labeling",
  "conclusion",
] as const;

/** Modules that are not in the current reports. */
export const OPTIONAL_MODULE_KEYS = ["dye_leak", "documents", "loading"] as const;

export const MODULE_KEYS = [...REPORT_MODULE_KEYS, ...OPTIONAL_MODULE_KEYS] as const;

export const ModuleKeySchema = z.enum(MODULE_KEYS);
export type ModuleKey = z.infer<typeof ModuleKeySchema>;

/** Always on in every template; only their fields switch on and off. */
export const ALWAYS_ON_MODULE_KEYS = ["header", "conclusion"] as const satisfies readonly ModuleKey[];

const moduleKeys: ReadonlySet<string> = new Set(MODULE_KEYS);

export function isModuleKey(value: string): value is ModuleKey {
  return moduleKeys.has(value);
}

/* ------------------------------------------------------------------ *
 * Module results (BUILD_SPEC 4.2 rule 7)
 * ------------------------------------------------------------------ */

export const MODULE_STATUSES = ["pass", "fail", "warn", "info", "not_done"] as const;

/** `not_done` is a module with missing data: it never shows as passed (6.2 rule 5). */
export const ModuleStatusSchema = z.enum(MODULE_STATUSES);
export type ModuleStatus = z.infer<typeof ModuleStatusSchema>;

export const PerSizeResultSchema = z.object({
  status: ModuleStatusSchema,
  summary: z.string().optional(),
});
export type PerSizeResult = z.infer<typeof PerSizeResultSchema>;

export const ModuleResultSchema = z.object({
  status: ModuleStatusSchema,
  summary: z.string(),
  /** Keyed by normalised size ("M", "7.0"); only sizes in `order_lots` appear. */
  perSize: z.record(SizeSchema, PerSizeResultSchema).optional(),
});
export type ModuleResult = z.infer<typeof ModuleResultSchema>;
