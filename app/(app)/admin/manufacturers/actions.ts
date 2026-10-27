"use server";

import { refresh } from "next/cache";
import {
  BRAND_FIELDS,
  BrandInputSchema,
  COMPANY_FIELDS,
  CompanyInputSchema,
  FACTORY_FIELDS,
  FactoryInputSchema,
  NO_PERMISSION,
  brandDeleteBlocker,
  changedMeanwhile,
  companyDeleteBlocker,
  deletedMeanwhile,
  describeBrandSaveError,
  describeCompanySaveError,
  describeFactorySaveError,
  describeManufacturerDeleteError,
  factoryLabel,
  readBrand,
  readBrandSnapshot,
  readCompany,
  readCompanySnapshot,
  readFactory,
  readFactorySnapshot,
  type BrandField,
  type CompanyField,
  type FactoryField,
  type ManufacturerKind,
  type SaveProblem,
} from "@/lib/admin/manufacturers";
import {
  EditTargetSchema,
  MESSAGES,
  RecordTargetSchema,
  deleteBlocker,
  failed,
  fieldErrors,
  guarded,
  readForm,
  succeeded,
  type ActionResult,
  type DatabaseError,
  type Snapshot,
} from "@/lib/admin/reference";
import { authorizeAction } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/*
 * Brand, company and factory actions for /admin/manufacturers (BUILD_SPEC 3
 * and 10). Server Actions are public HTTP endpoints: each one checks the
 * role's Manufacturers switch, validates its input with zod and re-reads
 * what it needs. Writes go through the signed-in user's own client, so Row
 * Level Security checks them again, and the database's foreign keys stop a
 * delete that a check here missed: a brand with companies, a company with
 * factories, a factory that templates or inspections use.
 */

export type SaveBrandResult = ActionResult<BrandField>;
export type SaveCompanyResult = ActionResult<CompanyField>;
export type SaveFactoryResult = ActionResult<FactoryField>;

/* ------------------------------------------------------------------ *
 * Brands
 * ------------------------------------------------------------------ */

/** Adds a brand (no id) or saves changes to one (id and the version the form started from). */
export async function saveBrand(_previous: SaveBrandResult, formData: FormData): Promise<SaveBrandResult> {
  return guarded("saveBrand", async (): Promise<SaveBrandResult> => {
    const auth = await authorizeAction({ permission: "manufacturers" });
    if (!auth.ok) return failed(auth.error);

    const target = EditTargetSchema.safeParse(readForm(formData, ["id", "version"]));
    if (!target.success) return failed(MESSAGES.stale);
    const input = BrandInputSchema.safeParse(readForm(formData, BRAND_FIELDS));
    if (!input.success) return failed(MESSAGES.checkFields, fieldErrors(input.error));

    const supabase = await createClient();
    const { id, version } = target.data;

    if (!id) {
      const { data, error } = await supabase.from("manufacturer_brands").insert(input.data).select("id").single();
      if (error) return refused("brand", describeBrandSaveError(error), error);
      refresh();
      return succeeded(`${input.data.name} added.`, { id: data.id });
    }

    // Only the version the form was opened on: a newer save by someone else matches nothing.
    const { data, error } = await supabase
      .from("manufacturer_brands")
      .update(input.data)
      .eq("id", id)
      .eq("updated_at", version)
      .select("id")
      .maybeSingle();
    if (error) return refused("brand", describeBrandSaveError(error), error);
    if (!data) return notSaved("brand", version, await readBrandSnapshot(supabase, id));
    refresh();
    return succeeded(`${input.data.name} saved.`, { id: data.id });
  });
}

/** Deletes a brand that has no companies. */
export async function deleteBrand(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("deleteBrand", async (): Promise<ActionResult> => {
    const auth = await authorizeAction({ permission: "manufacturers" });
    if (!auth.ok) return failed(auth.error);

    const target = RecordTargetSchema.safeParse(readForm(formData, ["id"]));
    if (!target.success) return failed(MESSAGES.stale);

    const supabase = await createClient();
    const current = await readBrand(supabase, target.data.id);
    if (!current) {
      refresh();
      return succeeded("This brand was already deleted.");
    }
    // The page showed it with none: show its companies as they are now.
    const blocker = brandDeleteBlocker(current.companies);
    if (blocker) {
      refresh();
      return failed(blocker);
    }

    const { data, error } = await supabase.from("manufacturer_brands").delete().eq("id", current.id).select("id");
    if (error) return deleteRefused("brand", error);
    if (data.length === 0) return failed(`${current.name} could not be deleted. Reload the page and try again.`);
    refresh();
    return succeeded(`${current.name} deleted.`);
  });
}

/* ------------------------------------------------------------------ *
 * Companies
 * ------------------------------------------------------------------ */

/** Adds a company under a brand, or saves changes to one, its brand included. */
export async function saveCompany(_previous: SaveCompanyResult, formData: FormData): Promise<SaveCompanyResult> {
  return guarded("saveCompany", async (): Promise<SaveCompanyResult> => {
    const auth = await authorizeAction({ permission: "manufacturers" });
    if (!auth.ok) return failed(auth.error);

    const target = EditTargetSchema.safeParse(readForm(formData, ["id", "version"]));
    if (!target.success) return failed(MESSAGES.stale);
    const input = CompanyInputSchema.safeParse(readForm(formData, COMPANY_FIELDS));
    if (!input.success) return failed(MESSAGES.checkFields, fieldErrors(input.error));

    const supabase = await createClient();
    const { id, version } = target.data;

    if (!id) {
      const { data, error } = await supabase.from("manufacturer_companies").insert(input.data).select("id").single();
      if (error) return refused("company", describeCompanySaveError(error), error);
      refresh();
      return succeeded(`${input.data.name} added.`, { id: data.id });
    }

    const { data, error } = await supabase
      .from("manufacturer_companies")
      .update(input.data)
      .eq("id", id)
      .eq("updated_at", version)
      .select("id")
      .maybeSingle();
    if (error) return refused("company", describeCompanySaveError(error), error);
    if (!data) return notSaved("company", version, await readCompanySnapshot(supabase, id));
    refresh();
    return succeeded(`${input.data.name} saved.`, { id: data.id });
  });
}

/** Deletes a company that has no factories. */
export async function deleteCompany(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("deleteCompany", async (): Promise<ActionResult> => {
    const auth = await authorizeAction({ permission: "manufacturers" });
    if (!auth.ok) return failed(auth.error);

    const target = RecordTargetSchema.safeParse(readForm(formData, ["id"]));
    if (!target.success) return failed(MESSAGES.stale);

    const supabase = await createClient();
    const current = await readCompany(supabase, target.data.id);
    if (!current) {
      refresh();
      return succeeded("This company was already deleted.");
    }
    const blocker = companyDeleteBlocker(current.factories);
    if (blocker) {
      refresh();
      return failed(blocker);
    }

    const { data, error } = await supabase.from("manufacturer_companies").delete().eq("id", current.id).select("id");
    if (error) return deleteRefused("company", error);
    if (data.length === 0) return failed(`${current.name} could not be deleted. Reload the page and try again.`);
    refresh();
    return succeeded(`${current.name} deleted.`);
  });
}

/* ------------------------------------------------------------------ *
 * Factories
 * ------------------------------------------------------------------ */

/** Adds a factory under a company, or saves changes to one, its company included. */
export async function saveFactory(_previous: SaveFactoryResult, formData: FormData): Promise<SaveFactoryResult> {
  return guarded("saveFactory", async (): Promise<SaveFactoryResult> => {
    const auth = await authorizeAction({ permission: "manufacturers" });
    if (!auth.ok) return failed(auth.error);

    const target = EditTargetSchema.safeParse(readForm(formData, ["id", "version"]));
    if (!target.success) return failed(MESSAGES.stale);
    const input = FactoryInputSchema.safeParse(readForm(formData, FACTORY_FIELDS));
    if (!input.success) return failed(MESSAGES.checkFields, fieldErrors(input.error));

    const supabase = await createClient();
    const { id, version } = target.data;
    // manufacturers.name is left out: a trigger copies the company's name into it.
    const returning = "id, company:manufacturer_companies(name)";

    if (!id) {
      const { data, error } = await supabase.from("manufacturers").insert(input.data).select(returning).single();
      if (error) return refused("factory", describeFactorySaveError(error, input.data), error);
      refresh();
      return succeeded(`${factoryLabel(input.data.factory_name, data.company?.name ?? "")} added.`, { id: data.id });
    }

    const { data, error } = await supabase
      .from("manufacturers")
      .update(input.data)
      .eq("id", id)
      .eq("updated_at", version)
      .select(returning)
      .maybeSingle();
    if (error) return refused("factory", describeFactorySaveError(error, input.data), error);
    if (!data) return notSaved("factory", version, await readFactorySnapshot(supabase, id));
    refresh();
    return succeeded(`${factoryLabel(input.data.factory_name, data.company?.name ?? "")} saved.`, { id: data.id });
  });
}

/** Deletes a factory that no template or inspection uses. */
export async function deleteFactory(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("deleteFactory", async (): Promise<ActionResult> => {
    const auth = await authorizeAction({ permission: "manufacturers" });
    if (!auth.ok) return failed(auth.error);

    const target = RecordTargetSchema.safeParse(readForm(formData, ["id"]));
    if (!target.success) return failed(MESSAGES.stale);

    const supabase = await createClient();
    const current = await readFactory(supabase, target.data.id);
    if (!current) {
      refresh();
      return succeeded("This factory was already deleted.");
    }
    const blocker = deleteBlocker(current.usage);
    if (blocker) {
      refresh();
      return failed(blocker);
    }

    const label = factoryLabel(current.factoryName, current.companyName);
    const { data, error } = await supabase.from("manufacturers").delete().eq("id", current.id).select("id");
    if (error) return deleteRefused("factory", error);
    if (data.length === 0) return failed(`${label} could not be deleted. Reload the page and try again.`);
    refresh();
    return succeeded(`${label} deleted.`);
  });
}

/* ------------------------------------------------------------------ *
 * Refusals
 * ------------------------------------------------------------------ */

/**
 * A save the database refused, in plain words under the field it concerns.
 * A brand or company that has gone shows its gone: the page refreshes.
 */
function refused<Field extends string>(
  kind: ManufacturerKind,
  problem: SaveProblem<Field>,
  error: DatabaseError,
): ActionResult<Field> {
  if (!problem.field) console.error(`[admin/manufacturers] ${kind} save refused`, error.code, error.message);
  if (error.code === "23503") refresh();
  if (!problem.field) return failed(problem.message);
  const errors: Partial<Record<Field, string>> = {};
  errors[problem.field] = problem.message;
  return failed<Field>(problem.message, errors);
}

/**
 * The update matched nothing. Someone else saved first, or deleted the row:
 * with their version (`latest`), the panel's next save replaces it, as the
 * message offers. The row unchanged since the form opened means the update
 * was not allowed at all (Row Level Security hides it from an update).
 */
function notSaved<Field extends string>(
  kind: ManufacturerKind,
  version: string,
  latest: Snapshot<Field> | null,
): ActionResult<Field> {
  refresh();
  if (!latest) return failed(deletedMeanwhile(kind));
  if (latest.version === version) return failed(NO_PERMISSION.change);
  return { ...failed(changedMeanwhile(kind)), latest };
}

function deleteRefused(kind: ManufacturerKind, error: DatabaseError): ActionResult {
  console.error(`[admin/manufacturers] ${kind} delete refused`, error.code, error.message);
  refresh();
  return failed(describeManufacturerDeleteError(kind, error));
}
