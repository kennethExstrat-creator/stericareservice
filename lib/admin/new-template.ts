import { z } from "zod";
import { ProductTypeSchema, StandardSchema, type ProductType } from "@/lib/schemas/common";
import {
  TEMPLATE_CODE_PATTERN,
  type TemplateDefinition,
  type TemplateSize,
  type TemplateUnit,
} from "@/lib/schemas/template";
import { LETTER_SIZES, NUMERIC_SIZES } from "@/lib/sizes";

/*
 * A new template from a base (BUILD_SPEC 4.5 step 2: "create a template that
 * extends the closest existing one", and the Phase 3 done-when: an admin
 * builds a new template without code changes). The form on /admin/templates
 * asks for a code, a name, the base and where the template applies; the
 * Server Action writes version 1 as a draft whose definition lists only
 * what it must, and the editor takes it from there.
 *
 * Shared by the form and the Server Action, so nothing here is server only.
 */

/** "No base": a template of its own, header and conclusion to start with. */
export const NO_BASE = "none";

/** "Any client", "Any manufacturer": the template is not scoped to one. */
export const ANY = "any";

export const NEW_TEMPLATE_FIELDS = ["code", "name", "base", "productType", "standard", "clientId", "manufacturerId"] as const;
export type NewTemplateField = (typeof NEW_TEMPLATE_FIELDS)[number];

/** Longest code and name the form takes: far above any real template. */
export const NEW_TEMPLATE_LIMITS = { code: 40, name: 120 } as const;

/** What an admin types, as a code: capitals, spaces and hyphens as underscores. "safedon eg" gives SAFEDON_EG. */
export function normaliseTemplateCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

/** What is wrong with a code, in words more precise than the rule. */
function codeProblem(code: string): string | null {
  if (TEMPLATE_CODE_PATTERN.test(code)) return null;
  if (!/^[A-Z]/.test(code)) return "Start the code with a letter, e.g. CLIENT_EG.";
  const others = [...new Set(code.replace(/[A-Z0-9_]/g, ""))].map((character) => `“${character}”`);
  return `Use only capital letters, digits and underscores: remove ${others.join(" ")}.`;
}

/** One client or manufacturer: its id, or ANY for none. */
const ScopeRefSchema = z
  .string()
  .refine((value) => value === ANY || z.uuid().safeParse(value).success, { error: "Choose from the list." })
  .transform((value) => (value === ANY ? null : value));

export const NewTemplateInputSchema = z.object({
  code: z
    .string()
    .overwrite(normaliseTemplateCode)
    .min(1, "Enter a code, e.g. CLIENT_EG.")
    .max(NEW_TEMPLATE_LIMITS.code, `Keep the code to ${NEW_TEMPLATE_LIMITS.code} characters or fewer.`)
    .superRefine((code, context) => {
      const problem = code === "" ? null : codeProblem(code);
      if (problem) context.addIssue({ code: "custom", message: problem });
    }),
  name: z
    .string()
    .overwrite((value) => value.replace(/\s+/g, " ").trim())
    .min(1, "Enter a name, e.g. Client A nitrile gloves.")
    .max(NEW_TEMPLATE_LIMITS.name, `Keep the name to ${NEW_TEMPLATE_LIMITS.name} characters or fewer.`),
  /** The base's code, or NO_BASE. */
  base: z
    .string()
    .refine((value) => value === NO_BASE || TEMPLATE_CODE_PATTERN.test(value), {
      error: "Choose the template to build on, or None.",
    })
    .transform((value) => (value === NO_BASE ? null : value)),
  productType: z.enum(ProductTypeSchema.options, { error: "Choose the product type." }),
  standard: z.enum(StandardSchema.options, { error: "Choose the standard." }),
  clientId: ScopeRefSchema,
  manufacturerId: ScopeRefSchema,
});
export type NewTemplateInput = z.output<typeof NewTemplateInputSchema>;

/** Sizes and unit for a template without a base, by product type: the editor's Details change them. */
export function defaultSizing(productType: ProductType): { unit: TemplateUnit; sizes: TemplateSize[] } {
  return productType === "surgical"
    ? { unit: "pairs", sizes: NUMERIC_SIZES.map((value) => ({ value })) }
    : { unit: "pcs", sizes: LETTER_SIZES.filter((value) => value !== "XXL").map((value) => ({ value })) };
}

/**
 * Version 1 of the new template: only what it must list (BUILD_SPEC 4.2
 * rule 9). With a base: its code, name, base and scope, and the base's unit
 * and sizes (a template's own, not inherited), every module as the base has
 * it until the editor changes one. Without: header and conclusion only, and
 * sizes by product type.
 */
export function newTemplateDefinition(input: NewTemplateInput, base: TemplateDefinition | null): TemplateDefinition {
  const sizing = base
    ? { unit: base.unit, sizes: base.sizes.map((size) => ({ ...size })) }
    : defaultSizing(input.productType);
  return {
    code: input.code,
    name: input.name,
    ...(base ? { extends: base.code } : {}),
    scope: {
      productType: input.productType,
      standard: input.standard,
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.manufacturerId ? { manufacturerId: input.manufacturerId } : {}),
    },
    ...sizing,
    modules: [],
  };
}

/** What the form sends, by field name. */
export function readNewTemplateForm(formData: FormData): Record<NewTemplateField, string> {
  const values = {} as Record<NewTemplateField, string>;
  for (const field of NEW_TEMPLATE_FIELDS) {
    const value = formData.get(field);
    values[field] = typeof value === "string" ? value : "";
  }
  return values;
}

/** A base the form offers: the active version of a template. */
export type BaseOption = {
  code: string;
  name: string | null;
  version: number;
  productType: ProductType;
  standard: z.infer<typeof StandardSchema>;
  /** Its own sizes, as the new template will start with them: "XS, S, M, L, XL". */
  sizes: string;
  unit: TemplateUnit;
};

export type NewTemplateResult =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Partial<Record<NewTemplateField, string>> };

export const NEW_TEMPLATE_IDLE: NewTemplateResult = { status: "idle" };
