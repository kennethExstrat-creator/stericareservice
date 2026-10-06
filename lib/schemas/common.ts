import { z } from "zod";

/* ------------------------------------------------------------------ *
 * Primitives shared by the module, template, export and AI schemas
 * ------------------------------------------------------------------ */

/** A normalised glove size: "7.0" for surgical sizes, "XS" to "XL" for examination gloves. */
export const SizeSchema = z.string().min(1).max(16);
export type Size = z.infer<typeof SizeSchema>;

/** Calendar date, `YYYY-MM-DD`. */
export const IsoDateSchema = z.iso.date();

/** Timestamp with a `Z` or `+hh:mm` offset, as Postgres `timestamptz` serialises it. */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

/** Absolute http(s) URL. Signed storage URLs and webhook targets use this. */
export const HttpUrlSchema = z.url({ protocol: /^https?$/ });

export const InspectionStatusSchema = z.enum(["draft", "submitted", "approved", "reopened"]);
export type InspectionStatus = z.infer<typeof InspectionStatusSchema>;

/** Overall result of an inspection: the inspector's final result, the app's suggestion, the AI's suggestion. */
export const InspectionResultSchema = z.enum(["pass", "fail", "hold"]);
export type InspectionResult = z.infer<typeof InspectionResultSchema>;

export const ProductTypeSchema = z.enum(["examination", "surgical"]);
export type ProductType = z.infer<typeof ProductTypeSchema>;

export const StandardSchema = z.enum(["EN455", "ASTM_D6319", "ASTM_D3578", "ASTM_D3577", "custom"]);
export type Standard = z.infer<typeof StandardSchema>;

/** Field types a template can use in custom modules (BUILD_SPEC 4.3). */
export const FieldTypeSchema = z.enum([
  "counter",
  "number",
  "text",
  "textarea",
  "select",
  "yes_no",
  "date",
  "photo",
]);
export type FieldType = z.infer<typeof FieldTypeSchema>;

/** Canonical units (BUILD_SPEC 4.2 rule 5). */
export const UnitSchema = z.enum(["mm", "g", "N", "MPa", "%", "pcs"]);
export type Unit = z.infer<typeof UnitSchema>;

/**
 * Any JSON value. Rejects undefined, NaN, Infinity, BigInt and Date, which
 * JSON.stringify would drop, turn into null or throw on.
 */
export const JsonValueSchema = z.json();
export type JsonValue = z.infer<typeof JsonValueSchema>;

/** A client, manufacturer or person by id and display name. */
export const EntityRefSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
});
export type EntityRef = z.infer<typeof EntityRefSchema>;
