import { z } from "zod";
import {
  LIMITS,
  MESSAGES,
  counted,
  matchesSearch,
  normaliseForSearch,
  optionalLine,
  optionalText,
  requiredLine,
  searchText,
  usageOf,
  type DatabaseClient,
  type DatabaseError,
  type Snapshot,
  type Usage,
  type UsageColumns,
} from "@/lib/admin/reference";

/**
 * Manufacturers for /admin/manufacturers (BUILD_SPEC 3, 5 and 10), as brand,
 * company and factory (Kenneth, 27 October 2026: "one brand can have multiple
 * operating company while one company can have multiple Factory"; migration
 * 20261027163000):
 *
 *   manufacturer_brands     Top Glove
 *   manufacturer_companies  Terang Nusa Sdn. Bhd., an operating company of one brand
 *   manufacturers           TG-F40, one factory of a company, with its address:
 *                           what inspections and templates point at
 *
 * The form schemas, the page's items, table rows and search, the labels and
 * plain words for database errors, and the queries the page and its actions
 * run. Shared by server and browser code, so nothing here imports a
 * server-only module; the queries take the caller's client, so Row Level
 * Security checks each one again. manufacturers.name is a copy of the
 * company's name that triggers keep for older code: nothing here reads or
 * writes it.
 */

/* ------------------------------------------------------------------ *
 * Kinds
 * ------------------------------------------------------------------ */

export type ManufacturerKind = "brand" | "company" | "factory";

/** Each kind in a sentence. */
export const MANUFACTURER_KINDS = {
  brand: { one: "brand", many: "brands" },
  company: { one: "company", many: "companies" },
  factory: { one: "factory", many: "factories" },
} as const satisfies Record<ManufacturerKind, { one: string; many: string }>;

/* ------------------------------------------------------------------ *
 * Form input
 * ------------------------------------------------------------------ */

/**
 * The brand or company a row goes under, chosen in the panel: blank asks for
 * a choice, and anything but a uuid was not sent by the page.
 */
function parentId(choose: string) {
  return z.string().min(1, choose).pipe(z.guid({ error: MESSAGES.stale }));
}

/** A brand as the form sends it. Keys are the table's columns. */
export const BrandInputSchema = z.object({
  name: requiredLine(LIMITS.name, "name", "Enter the brand's name."),
});
export type BrandInput = z.output<typeof BrandInputSchema>;
export type BrandField = keyof BrandInput;
export const BRAND_FIELDS = Object.keys(BrandInputSchema.shape) as BrandField[];

/** A company as the form sends it: the brand it trades under, and its registered name. */
export const CompanyInputSchema = z.object({
  brand_id: parentId("Choose the brand."),
  name: requiredLine(LIMITS.name, "name", "Enter the company's name."),
});
export type CompanyInput = z.output<typeof CompanyInputSchema>;
export type CompanyField = keyof CompanyInput;
export const COMPANY_FIELDS = Object.keys(CompanyInputSchema.shape) as CompanyField[];

/**
 * A factory as the form sends it: its company, and its own name, address,
 * country and notes. A company's only plant may have no name (null).
 */
export const FactoryInputSchema = z.object({
  company_id: parentId("Choose the company."),
  factory_name: optionalLine(LIMITS.factory_name, "factory name"),
  address: optionalText(LIMITS.address, "address"),
  country: optionalLine(LIMITS.country, "country"),
  notes: optionalText(LIMITS.notes, "notes"),
});
export type FactoryInput = z.output<typeof FactoryInputSchema>;
export type FactoryField = keyof FactoryInput;
export const FACTORY_FIELDS = Object.keys(FactoryInputSchema.shape) as FactoryField[];

/* ------------------------------------------------------------------ *
 * Items: what the page shows
 * ------------------------------------------------------------------ */

/** One factory as the page shows it. Display fields only: items reach the browser. */
export type FactoryItem = {
  id: string;
  companyId: string;
  /** "TG-F40"; null for a company's only plant, which needs no name of its own. */
  factoryName: string | null;
  address: string | null;
  country: string | null;
  notes: string | null;
  /** The row's `updated_at`: the version an edit starts from. */
  updatedAt: string;
  usage: Usage;
};

export type CompanyItem = {
  id: string;
  brandId: string;
  name: string;
  updatedAt: string;
  /** By name, a factory without a name first. */
  factories: FactoryItem[];
};

export type BrandItem = {
  id: string;
  name: string;
  updatedAt: string;
  /** By name. */
  companies: CompanyItem[];
};

/** A brand's editable fields as the form shows them: text, "" for none. */
export function brandValues(brand: { name: string } | null): Record<BrandField, string> {
  return { name: brand?.name ?? "" };
}

/** A company's editable fields; a new one starts under `brandId` (the brand it was added from). */
export function companyValues(company: { brandId: string; name: string } | null, brandId = ""): Record<CompanyField, string> {
  return { brand_id: company?.brandId ?? brandId, name: company?.name ?? "" };
}

type FactoryText = Pick<FactoryItem, "companyId" | "factoryName" | "address" | "country" | "notes">;

/** A factory's editable fields; a new one starts under `companyId` (the company it was added from). */
export function factoryValues(factory: FactoryText | null, companyId = ""): Record<FactoryField, string> {
  return {
    company_id: factory?.companyId ?? companyId,
    factory_name: factory?.factoryName ?? "",
    address: factory?.address ?? "",
    country: factory?.country ?? "",
    notes: factory?.notes ?? "",
  };
}

export const brandSnapshot = (brand: { name: string; updatedAt: string }): Snapshot<BrandField> => ({
  version: brand.updatedAt,
  values: brandValues(brand),
});

export const companySnapshot = (company: { brandId: string; name: string; updatedAt: string }): Snapshot<CompanyField> => ({
  version: company.updatedAt,
  values: companyValues(company),
});

export const factorySnapshot = (factory: FactoryText & { updatedAt: string }): Snapshot<FactoryField> => ({
  version: factory.updatedAt,
  values: factoryValues(factory),
});

/* ------------------------------------------------------------------ *
 * Labels
 * ------------------------------------------------------------------ */

/** "Hartalega NGC's", "Supermax Holdings'". */
function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/** A factory in a sentence: its name, or "Hartalega NGC's factory" for a plant with none. */
export function factoryLabel(factoryName: string | null, companyName: string): string {
  return factoryName ?? `${possessive(companyName)} factory`;
}

/** A factory in a control's name, which is Title Case (docs/DESIGN.md, Capitalisation): "Hartalega NGC's Factory". */
export function factoryTitle(factoryName: string | null, companyName: string): string {
  return factoryName ?? `${possessive(companyName)} Factory`;
}

/* ------------------------------------------------------------------ *
 * Deleting: what keeps a row
 * ------------------------------------------------------------------ */

/** Why a brand cannot be deleted (the database restricts it too), or null when it can. */
export function brandDeleteBlocker(companies: number): string | null {
  return companies > 0 ? `Has ${counted(companies, "company", "companies")}, so it cannot be deleted.` : null;
}

/** Why a company cannot be deleted, or null when it can. */
export function companyDeleteBlocker(factories: number): string | null {
  return factories > 0 ? `Has ${counted(factories, "factory", "factories")}, so it cannot be deleted.` : null;
}

/** What the delete section says when nothing keeps the row. A factory says what a client says (its usage). */
export const DELETABLE = {
  brand: "Has no companies, so it can be deleted.",
  company: "Has no factories, so it can be deleted.",
} as const;

/* ------------------------------------------------------------------ *
 * Database errors in plain words (codes: docs/DATABASE.md)
 * ------------------------------------------------------------------ */

/** What a refused save says, and the field it belongs under (none: above the buttons). */
export type SaveProblem<Field extends string> = { message: string; field?: Field };

export const NO_PERMISSION = {
  change: "You do not have permission to change manufacturers. Reload the page to check your access.",
  delete: "You do not have permission to delete manufacturers. Reload the page to check your access.",
} as const;

function otherSaveProblem(kind: ManufacturerKind, error: DatabaseError): { message: string } {
  return { message: error.code === "42501" ? NO_PERMISSION.change : `The ${kind} could not be saved. Try again.` };
}

/** A failed insert or update of a brand. Names are unique ignoring case. */
export function describeBrandSaveError(error: DatabaseError): SaveProblem<BrandField> {
  if (error.code === "23505") return { field: "name", message: "There is already a brand with this name." };
  return otherSaveProblem("brand", error);
}

/** A failed insert or update of a company: a name taken by any brand's company, or a brand deleted meanwhile. */
export function describeCompanySaveError(error: DatabaseError): SaveProblem<CompanyField> {
  switch (error.code) {
    case "23505":
      return { field: "name", message: "There is already a company with this name." };
    case "23503":
      return { field: "brand_id", message: "That brand is no longer on the list. Reload the page." };
    default:
      return otherSaveProblem("company", error);
  }
}

/**
 * A failed insert or update of a factory: a name its company already has
 * (one factory per company may have none), or a company deleted meanwhile.
 */
export function describeFactorySaveError(
  error: DatabaseError,
  input: { factory_name: string | null },
): SaveProblem<FactoryField> {
  switch (error.code) {
    case "23505":
      return {
        field: "factory_name",
        message: input.factory_name
          ? "This company already has a factory with this name."
          : "This company already has a factory without a name.",
      };
    case "23503":
      return { field: "company_id", message: "That company is no longer on the list. Reload the page." };
    default:
      return otherSaveProblem("factory", error);
  }
}

/** A refused delete. 23001 and 23503: something still refers to the row, as the database restricts. */
export function describeManufacturerDeleteError(kind: ManufacturerKind, error: DatabaseError): string {
  switch (error.code) {
    case "23503":
    case "23001":
      return {
        brand: "This brand has companies, so it cannot be deleted.",
        company: "This company has factories, so it cannot be deleted.",
        factory: "Templates or inspections use this factory, so it cannot be deleted.",
      }[kind];
    case "42501":
      return NO_PERMISSION.delete;
    default:
      return `The ${kind} could not be deleted. Try again.`;
  }
}

/** A save that matched no row because someone else had changed it first. */
export function changedMeanwhile(kind: ManufacturerKind): string {
  return `Someone else changed this ${kind} while you were editing. Close the panel to see their changes, or save again to replace them with yours.`;
}

/** A save that matched no row because the row had gone. */
export function deletedMeanwhile(kind: ManufacturerKind): string {
  return `This ${kind} has been deleted, so your changes were not saved.`;
}

/* ------------------------------------------------------------------ *
 * The tree: brands, their companies, their factories
 * ------------------------------------------------------------------ */

const byName = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

const byBrand = (a: BrandItem, b: BrandItem) => byName.compare(a.name, b.name) || a.id.localeCompare(b.id);
const byCompany = (a: CompanyItem, b: CompanyItem) => byName.compare(a.name, b.name) || a.id.localeCompare(b.id);
/** A factory without a name first, then by name: "Plant 2" before "Plant 10". */
const byFactory = (a: FactoryItem, b: FactoryItem) =>
  Number(a.factoryName !== null) - Number(b.factoryName !== null) ||
  byName.compare(a.factoryName ?? "", b.factoryName ?? "") ||
  a.id.localeCompare(b.id);

type FactoryRow = {
  id: string;
  factory_name: string | null;
  address: string | null;
  country: string | null;
  notes: string | null;
  updated_at: string;
} & UsageColumns;
type CompanyRow = { id: string; name: string; updated_at: string; factories: FactoryRow[] };
type BrandRow = { id: string; name: string; updated_at: string; companies: CompanyRow[] };

/** One query, so brands, companies and factories come from the same moment. */
const TREE =
  "id, name, updated_at, companies:manufacturer_companies(id, name, updated_at, factories:manufacturers(id, factory_name, address, country, notes, updated_at, templates(count), inspections(count)))";

/** The rows of TREE as the page shows them, each level by name. */
export function manufacturerTree(rows: readonly BrandRow[]): BrandItem[] {
  return rows
    .map((brand) => ({
      id: brand.id,
      name: brand.name,
      updatedAt: brand.updated_at,
      companies: brand.companies
        .map((company) => ({
          id: company.id,
          brandId: brand.id,
          name: company.name,
          updatedAt: company.updated_at,
          factories: company.factories
            .map((factory) => ({
              id: factory.id,
              companyId: company.id,
              factoryName: factory.factory_name,
              address: factory.address,
              country: factory.country,
              notes: factory.notes,
              updatedAt: factory.updated_at,
              usage: usageOf(factory),
            }))
            .sort(byFactory),
        }))
        .sort(byCompany),
    }))
    .sort(byBrand);
}

/** Every brand with its companies and their factories, and each factory's usage. */
export async function loadManufacturerTree(supabase: DatabaseClient): Promise<BrandItem[]> {
  const { data, error } = await supabase.from("manufacturer_brands").select(TREE);
  if (error) throw new Error(`Could not load the manufacturers: ${error.message}`);
  return manufacturerTree(data);
}

export function factoryCount(brands: readonly BrandItem[]): number {
  return brands.reduce((sum, brand) => sum + brand.companies.reduce((inBrand, company) => inBrand + company.factories.length, 0), 0);
}

/** Every company and factory by id, with what it sits under. */
export function indexManufacturers(brands: readonly BrandItem[]) {
  const brandsById = new Map<string, BrandItem>();
  const companies = new Map<string, { company: CompanyItem; brand: BrandItem }>();
  const factories = new Map<string, { factory: FactoryItem; company: CompanyItem; brand: BrandItem }>();
  for (const brand of brands) {
    brandsById.set(brand.id, brand);
    for (const company of brand.companies) {
      companies.set(company.id, { company, brand });
      for (const factory of company.factories) factories.set(factory.id, { factory, company, brand });
    }
  }
  return { brands: brandsById, companies, factories };
}

/* ------------------------------------------------------------------ *
 * Table rows
 * ------------------------------------------------------------------ */

/**
 * One row of the page's table: one per factory. The brand's cell sits in
 * its first row and spans all of them (`brandSpan`; 0 in the rows below),
 * as does the company's (`companySpan`). A company with no factory yet still
 * gets a row, whose factory cell offers Add Factory (`factory` null), and a
 * brand with no company one whose company cell offers Add Company (`company`
 * null).
 */
export type ManufacturerRow = {
  key: string;
  brand: BrandItem;
  brandSpan: number;
  company: CompanyItem | null;
  companySpan: number;
  factory: FactoryItem | null;
};

export function manufacturerRows(brands: readonly BrandItem[]): ManufacturerRow[] {
  const rows: ManufacturerRow[] = [];
  for (const brand of brands) {
    const height = brand.companies.reduce((sum, company) => sum + Math.max(company.factories.length, 1), 0);
    if (height === 0) {
      rows.push({ key: `brand:${brand.id}`, brand, brandSpan: 1, company: null, companySpan: 0, factory: null });
      continue;
    }
    brand.companies.forEach((company, companyIndex) => {
      const brandSpan = (first: boolean) => (companyIndex === 0 && first ? height : 0);
      if (company.factories.length === 0) {
        rows.push({ key: `company:${company.id}`, brand, brandSpan: brandSpan(true), company, companySpan: 1, factory: null });
        return;
      }
      company.factories.forEach((factory, factoryIndex) => {
        const first = factoryIndex === 0;
        rows.push({
          key: factory.id,
          brand,
          brandSpan: brandSpan(first),
          company,
          companySpan: first ? company.factories.length : 0,
          factory,
        });
      });
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

/**
 * The part of the tree a search keeps: every word of the query in a brand's
 * name keeps the brand with all it has; in its name and a company's, that
 * company with all its factories; in theirs and a factory's name, address,
 * country or notes, that factory. "top glove klang" finds TG-F40.
 */
export function searchManufacturers(brands: readonly BrandItem[], query: string): BrandItem[] {
  if (normaliseForSearch(query) === "") return [...brands];
  const kept: BrandItem[] = [];
  for (const brand of brands) {
    if (matchesSearch(searchText(brand.name), query)) {
      kept.push(brand);
      continue;
    }
    const companies: CompanyItem[] = [];
    for (const company of brand.companies) {
      if (matchesSearch(searchText(brand.name, company.name), query)) {
        companies.push(company);
        continue;
      }
      const factories = company.factories.filter((factory) =>
        matchesSearch(
          searchText(brand.name, company.name, factory.factoryName, factory.address, factory.country, factory.notes),
          query,
        ),
      );
      if (factories.length > 0) companies.push({ ...company, factories });
    }
    if (companies.length > 0) kept.push({ ...brand, companies });
  }
  return kept;
}

/* ------------------------------------------------------------------ *
 * Countries
 * ------------------------------------------------------------------ */

/** Offered in the country field next to the countries already on the list. */
const COMMON_COUNTRIES = ["China", "India", "Indonesia", "Malaysia", "Sri Lanka", "Thailand", "Vietnam"];

/** Every country a factory already has, then the common ones, without repeats, by name. */
export function countrySuggestions(brands: readonly BrandItem[]): string[] {
  const used = brands.flatMap((brand) => brand.companies.flatMap((company) => company.factories.map((factory) => factory.country)));
  const seen = new Map<string, string>();
  for (const country of [...used, ...COMMON_COUNTRIES]) {
    if (country && !seen.has(country.toLowerCase())) seen.set(country.toLowerCase(), country);
  }
  return [...seen.values()].sort(byName.compare);
}

/* ------------------------------------------------------------------ *
 * Queries for the actions
 * ------------------------------------------------------------------ */

/** A brand by id with how many companies it has, or null when it does not exist. */
export async function readBrand(
  supabase: DatabaseClient,
  id: string,
): Promise<{ id: string; name: string; companies: number } | null> {
  const { data, error } = await supabase
    .from("manufacturer_brands")
    .select("id, name, manufacturer_companies(count)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read brand ${id}: ${error.message}`);
  return data ? { id: data.id, name: data.name, companies: data.manufacturer_companies[0]?.count ?? 0 } : null;
}

/** A company by id with how many factories it has, or null when it does not exist. */
export async function readCompany(
  supabase: DatabaseClient,
  id: string,
): Promise<{ id: string; name: string; factories: number } | null> {
  const { data, error } = await supabase
    .from("manufacturer_companies")
    .select("id, name, manufacturers(count)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read company ${id}: ${error.message}`);
  return data ? { id: data.id, name: data.name, factories: data.manufacturers[0]?.count ?? 0 } : null;
}

/** A factory by id with its company's name and its usage, or null when it does not exist. */
export async function readFactory(
  supabase: DatabaseClient,
  id: string,
): Promise<{ id: string; factoryName: string | null; companyName: string; usage: Usage } | null> {
  const { data, error } = await supabase
    .from("manufacturers")
    .select("id, factory_name, company:manufacturer_companies(name), templates(count), inspections(count)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read factory ${id}: ${error.message}`);
  if (!data) return null;
  return { id: data.id, factoryName: data.factory_name, companyName: data.company?.name ?? "", usage: usageOf(data) };
}

/** A brand's editable fields at its current version, or null when it does not exist. */
export async function readBrandSnapshot(supabase: DatabaseClient, id: string): Promise<Snapshot<BrandField> | null> {
  const { data, error } = await supabase.from("manufacturer_brands").select("name, updated_at").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not read brand ${id}: ${error.message}`);
  return data ? brandSnapshot({ name: data.name, updatedAt: data.updated_at }) : null;
}

/** A company's editable fields at its current version, or null when it does not exist. */
export async function readCompanySnapshot(supabase: DatabaseClient, id: string): Promise<Snapshot<CompanyField> | null> {
  const { data, error } = await supabase
    .from("manufacturer_companies")
    .select("brand_id, name, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read company ${id}: ${error.message}`);
  return data ? companySnapshot({ brandId: data.brand_id, name: data.name, updatedAt: data.updated_at }) : null;
}

/** A factory's editable fields at its current version, or null when it does not exist. */
export async function readFactorySnapshot(supabase: DatabaseClient, id: string): Promise<Snapshot<FactoryField> | null> {
  const { data, error } = await supabase
    .from("manufacturers")
    .select("company_id, factory_name, address, country, notes, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read factory ${id}: ${error.message}`);
  if (!data) return null;
  return factorySnapshot({
    companyId: data.company_id,
    factoryName: data.factory_name,
    address: data.address,
    country: data.country,
    notes: data.notes,
    updatedAt: data.updated_at,
  });
}
