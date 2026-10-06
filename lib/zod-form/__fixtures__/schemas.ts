// Config schemas shaped like the report modules' (docs/DATA_DICTIONARY.md,
// "Config key" tables), for the form generator's tests. They use the same
// building blocks the modules do: SpecSchema, CanonicalSizeSchema, the AQL
// schemas, strict objects, nullable values with a description.
import { z } from "zod";
import { AqlSchema, InspectionLevelSchema } from "@/lib/aql";
import { CanonicalSizeSchema } from "@/lib/sizes";
import { SpecSchema } from "@/modules/_framework";

export const MEASURES = ["length", "width", "fingerThickness", "palmThickness", "cuffThickness"] as const;

export const SamplingLikeSchema = z.strictObject({
  columns: z
    .strictObject({ cases: z.boolean(), innerUnits: z.boolean(), gloves: z.boolean() })
    .describe("Columns shown on this template."),
  inspectionLevel: InspectionLevelSchema.nullable().describe("ISO 2859-1 inspection level. None: n as entered."),
});

export const WatertightLikeSchema = z.strictObject({
  aql: AqlSchema.nullable().describe("AQL of the watertight test. Empty: the client's AQL, else 1.5."),
  locations: z
    .array(
      z.strictObject({
        code: z.string().regex(/^[a-z][a-z0-9_]*$/, { error: "Lower case letters, digits and _." }),
        label: z.string().min(1).max(200).describe("The location in this template's wording"),
      }),
    )
    .refine((locations) => new Set(locations.map((entry) => entry.code)).size === locations.length, {
      error: "Each hole location code may be listed once.",
    })
    .describe("Hole locations in the template's order and wording"),
  handSplit: z.boolean().describe("Record right and left hands apart."),
});

export const DispensingLikeSchema = z.strictObject({
  minLayeringPct: z.number().min(0).max(100).describe("Minimum average layering, in %"),
  stickinessCodes: z
    .array(
      z.strictObject({
        code: z.string().regex(/^[A-Z][A-Z0-9]*$/),
        label: z.string().min(1),
        pass: z.boolean(),
      }),
    )
    .min(1),
  boxesPerSize: z.strictObject({
    default: z.number().int().min(1).max(500).describe("Box rows for every size"),
    bySize: z.record(CanonicalSizeSchema, z.number().int().min(1).max(500)).optional().describe("Box rows for one size"),
  }),
});

export const DimensionsLikeSchema = z.strictObject({
  measures: z.array(z.enum(MEASURES)).describe("The measures on, in column order."),
  statistic: z.enum(["median", "average"]),
  specs: z
    .array(
      z.strictObject({
        size: CanonicalSizeSchema.describe("The size this row is for."),
        specs: z.partialRecord(z.enum(MEASURES), SpecSchema),
      }),
    )
    .describe("One row per size."),
  decimals: z.record(z.enum(MEASURES), z.number().int().min(0).max(4)),
  rows: z.number().int().positive().nullable().meta({ title: "Gloves per size" }),
  width: z.number().meta({ unit: "mm" }).optional(),
});

export const SIZE_MARKER = { name: "size", schema: CanonicalSizeSchema } as const;
export const SPEC_MARKER = { name: "spec", schema: SpecSchema } as const;
export const MARKERS = [SIZE_MARKER, SPEC_MARKER] as const;
