// Conclusion (BUILD_SPEC 6.1 conclusion): the inspector's final result,
// remark, inspection summary (formatted text), date and drawn signature, or
// the choice to sign the report by hand after it is exported. The suggested
// result is computed, never stored (6.2 rule 2); the inspector comes from
// the inspection (rule 11). Every value may be missing while the inspection
// is a draft.
import { z } from "zod";
import { InspectionResultSchema } from "@/lib/schemas";
import { RichTextDocSchema } from "@/lib/schemas/rich-text";
import { DateCellSchema, TextCellSchema } from "@/modules/_framework";
import { SignatureSchema } from "./signature";

export const ConclusionDataSchema = z.strictObject({
  /** pass, fail or hold, chosen by the inspector: `inspections.result`. */
  finalResult: InspectionResultSchema.nullable().default(null),
  /** `inspections.remarks`. */
  remark: TextCellSchema,
  /**
   * The inspector's summary with formatting (Kenneth, 12 October 2026): the
   * allow-listed document of lib/schemas/rich-text.ts, never HTML. Optional,
   * mirrored nowhere; data saved before it existed reads as null.
   */
  inspectionSummary: RichTextDocSchema.nullable().default(null),
  /** The report date, `YYYY-MM-DD` from a picker; set to today when the result is chosen or signed. */
  date: DateCellSchema,
  /** Strokes drawn on the pad (signature.ts); null until signed. */
  signature: SignatureSchema.nullable().default(null),
  /**
   * To Sign After Exported (Kenneth, 13 October 2026): the report is signed
   * by hand once it is exported, so the screen shows a note in place of the
   * pad and the export sends no drawn signature. Strokes drawn before stay
   * in `signature`, to come back when it is switched off. Data saved before
   * it existed reads as false.
   */
  signAfterExport: z.boolean().default(false),
});
export type ConclusionData = z.infer<typeof ConclusionDataSchema>;

export function emptyConclusion(): ConclusionData {
  return ConclusionDataSchema.parse({});
}
