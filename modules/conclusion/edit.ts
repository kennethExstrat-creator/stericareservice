// Edits the capture screen makes, as pure functions returning the whole new
// data from the data they are given, never changing it. Capture applies them
// to the latest data through useDataUpdater (docs/CAPTURE_KIT.md), so edits
// made in one event build on each other. The date is automatic: it becomes
// today when the result is chosen or the signature drawn, and stays as set
// after that.
import type { InspectionResult } from "@/lib/schemas";
import type { RichTextDoc } from "@/lib/schemas/rich-text";
import { DateCellSchema } from "@/modules/_framework";
import type { ConclusionData } from "./schema";
import type { Signature } from "./signature";

/** A date in the device's own calendar, `YYYY-MM-DD` (not UTC: near midnight they differ by a day). */
export function isoDateOf(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function withFinalResult(data: ConclusionData, finalResult: InspectionResult, today: string): ConclusionData {
  return { ...data, finalResult, date: data.date ?? today };
}

/**
 * A new signature dates the conclusion if nothing has; clearing it keeps the
 * date. The same signature (a stroke the pad had no room for) changes nothing.
 */
export function withSignature(data: ConclusionData, signature: Signature | null, today: string): ConclusionData {
  if (signature === data.signature) return data;
  return { ...data, signature, date: signature === null ? data.date : (data.date ?? today) };
}

/** Text as typed; blank is no remark. */
export function withRemark(data: ConclusionData, remark: string): ConclusionData {
  return { ...data, remark: remark.trim() === "" ? null : remark };
}

/** The summary as the editor hands it over: already canonical, blank as null (lib/rich-text toRichTextDoc). */
export function withInspectionSummary(data: ConclusionData, inspectionSummary: RichTextDoc | null): ConclusionData {
  return { ...data, inspectionSummary };
}

/** A value from the date picker; blank clears it, anything that is not a date is ignored. */
export function withDate(data: ConclusionData, value: string): ConclusionData {
  if (value === "") return { ...data, date: null };
  const parsed = DateCellSchema.safeParse(value);
  return parsed.success && parsed.data !== null ? { ...data, date: parsed.data } : data;
}
