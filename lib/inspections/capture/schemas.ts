// What crosses between the capture screen and its Server Actions, checked
// with zod on the way in (BUILD_SPEC 2 rule 3). Module data itself is
// checked by each module's own schema (changes.ts); these schemas check the
// envelope.
import { z } from "zod";
import { saveRequestSchema } from "@/lib/offline/protocol";
import { JsonValueSchema } from "@/lib/schemas/common";
import { ModuleKeySchema } from "@/lib/schemas/module-result";
import type { InspectionData } from "@/modules/_framework";

/** A module or custom module key as stored in `data.modules` / `data.custom`. */
const EntryKeySchema = z.string().min(1).max(64);

/**
 * The inspection's data with every module optional: a draft schema
 * (docs/OFFLINE.md, "The transport"). Completeness is the modules' business
 * and blocks submit, never saving. Checks a restored local copy and the
 * autosave payload. The Report page's options (`report`) are any JSON here,
 * as module entries are: the save checks them with their own schema when
 * they change (reportOptionsProblem, report.ts).
 */
export const CaptureDataSchema: z.ZodType<InspectionData> = z.strictObject({
  modules: z.record(EntryKeySchema, JsonValueSchema),
  custom: z.record(EntryKeySchema, JsonValueSchema),
  report: JsonValueSchema.optional(),
});

/** The autosave request: `{ inspectionId, data, baseUpdatedAt }` (lib/offline protocol). */
export const SaveInputSchema = saveRequestSchema(CaptureDataSchema);
export type SaveInput = z.infer<typeof SaveInputSchema>;

/** contentHash() of the data the inspector validated before submitting: 16 hex digits. */
export const DataHashSchema = z.string().regex(/^[0-9a-f]{16}$/);

export const SubmitInputSchema = z.object({
  inspectionId: z.uuid(),
  dataHash: DataHashSchema,
});
export type SubmitInput = z.infer<typeof SubmitInputSchema>;

/** The longest override reason the database accepts (ModuleOverrideSchema). */
export const OVERRIDE_REASON_MAX = 500;

export const SwitchOffInputSchema = z.object({
  inspectionId: z.uuid(),
  moduleKey: ModuleKeySchema,
  reason: z
    .string()
    .trim()
    .min(1, { error: "Say why this section is switched off." })
    .max(OVERRIDE_REASON_MAX, { error: `Keep the reason to ${OVERRIDE_REASON_MAX} characters.` }),
});
export type SwitchOffInput = z.infer<typeof SwitchOffInputSchema>;

export const SwitchOnInputSchema = z.object({
  inspectionId: z.uuid(),
  moduleKey: ModuleKeySchema,
});
export type SwitchOnInput = z.infer<typeof SwitchOnInputSchema>;

/**
 * General Information's Client Name or Manufacturer / Supplier changed
 * (changeInspectionParty): the client's id, or null for no client, as New
 * Inspection allows; a factory's id, never none.
 */
export const PartyChangeInputSchema = z.discriminatedUnion("party", [
  z.object({ inspectionId: z.uuid(), party: z.literal("client"), id: z.uuid().nullable() }),
  z.object({ inspectionId: z.uuid(), party: z.literal("manufacturer"), id: z.uuid() }),
]);
export type PartyChangeInput = z.infer<typeof PartyChangeInputSchema>;

/** The `?module=` search parameter: a module or custom module key. */
export const SectionParamSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

/** The first value of a search parameter that may repeat. */
export function readSectionParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  const parsed = SectionParamSchema.safeParse(first);
  return parsed.success ? parsed.data : null;
}
