// Cell schemas and readers (BUILD_SPEC 6.2 rules 1 to 3). Stored data holds
// numbers as numbers: a schema built from these cells rejects "2 42", "1/80"
// or a date where a count belongs, so text never reaches the database. Raw
// text is read with lib/stats' strict parser, the same one NumericCell uses.
import { z } from "zod";
import { IsoDateSchema } from "@/lib/schemas/common";
import { readDecimal, type Limits, type ParseDecimalResult } from "@/lib/stats";

/** A measurement: any finite number, null until entered. Ranges are checked by calc, not here. */
export const DecimalCellSchema = z.number().nullable().default(null);

/** A count: a whole number from 0, null until entered (never a date, rule 6.2.3). */
export const CountCellSchema = z.number().int().min(0).nullable().default(null);

/** A carton or box number: a whole number from 1. */
export const CartonNumberCellSchema = z.number().int().min(1).nullable().default(null);

export const TextCellSchema = z.string().max(2000).nullable().default(null);

/** A calendar date from a date picker, `YYYY-MM-DD` (rule 6.2.3). */
export const DateCellSchema = IsoDateSchema.nullable().default(null);

export const YesNoCellSchema = z.boolean().nullable().default(null);

/** A number typed or pasted into a cell: lib/stats' parser plus the limits. */
export const readDecimalCell: (raw: string, limits?: Limits) => ParseDecimalResult = readDecimal;

/** A count typed or pasted into a cell: a whole number from 0 (or `limits.min`). */
export function readCountCell(raw: string, limits: Limits = {}): ParseDecimalResult {
  const parsed = readDecimal(raw, { min: 0, ...limits });
  if (!parsed.ok || parsed.value === null) return parsed;
  if (!Number.isInteger(parsed.value)) return { ok: false, error: "Whole numbers only, e.g. 3." };
  return parsed;
}

/** True when a cell holds nothing: null, undefined, blank text or an empty list. */
export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
