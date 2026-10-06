// Edits the capture screen makes, as pure functions returning the whole new
// data for onChange. The date is automatic: it becomes today when the result
// is chosen or the signature drawn, and stays as set after that.
import type { InspectionResult } from "@/lib/schemas";
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

/** A new signature dates the conclusion if nothing has; clearing it keeps the date. */
export function withSignature(data: ConclusionData, signature: Signature | null, today: string): ConclusionData {
  return { ...data, signature, date: signature === null ? data.date : (data.date ?? today) };
}

/** Text as typed; blank is no remark. */
export function withRemark(data: ConclusionData, remark: string): ConclusionData {
  return { ...data, remark: remark.trim() === "" ? null : remark };
}

/** A value from the date picker; blank clears it, anything that is not a date is ignored. */
export function withDate(data: ConclusionData, value: string): ConclusionData {
  if (value === "") return { ...data, date: null };
  const parsed = DateCellSchema.safeParse(value);
  return parsed.success && parsed.data !== null ? { ...data, date: parsed.data } : data;
}
