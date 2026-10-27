// The client and manufacturer a document names, matched with the lists by the
// app itself (docs/AI.md, "Reading order documents"; Kenneth, 27 October 2026:
// "the Steri AI should be able to read doc to use existing client and
// manufacturer or create new one"). Steri-AI matches first; these rules check
// again before New Client or New Manufacturer offers to add one, and the
// server checks once more when it adds: a name that reads the same, case,
// punctuation, spacing and legal suffixes such as Sdn. Bhd. aside, is the
// entry already listed, so the lists never get a near-duplicate. For a
// manufacturer, a listed brand or company is reused and only what is missing
// is added (migration 20261027163000: brand, company, factory).
// Pure, shared by the browser and the server.
import type { ManufacturerDetails } from "@/lib/schemas/document-fill";
import { manufacturerFullName, manufacturerOptions, type ManufacturerNames } from "./format";

/* ------------------------------------------------------------------ *
 * Names
 * ------------------------------------------------------------------ */

/** "(M)", the Malaysian mark in a company's name ("Kossan Rubber Industries (M) Bhd."), wherever it stands. */
const MALAYSIA_MARK = /\(\s*m\s*\)/giu;

/**
 * Legal forms a company's name may end with, as words, the longest first.
 * They come off the end one after another: "Top Glove Corporation Berhad" is
 * "top glove". "Company" or "Public" alone stay ("The Glove Company").
 */
const LEGAL_FORMS: readonly (readonly string[])[] = [
  ["public", "company", "limited"],
  ["public", "co", "ltd"],
  ["sendirian", "berhad"],
  ["company", "limited"],
  ["private", "limited"],
  ["company", "ltd"],
  ["co", "limited"],
  ["sdn", "bhd"],
  ["pte", "ltd"],
  ["pvt", "ltd"],
  ["pty", "ltd"],
  ["co", "ltd"],
  ["berhad"],
  ["bhd"],
  ["limited"],
  ["ltd"],
  ["co"],
  ["inc"],
  ["incorporated"],
  ["corp"],
  ["corporation"],
  ["llc"],
  ["plc"],
  ["pcl"],
  ["gmbh"],
  ["tbk"],
];

/** Legal forms written before the name: PT in Indonesia ("PT Mark Dynamics Indonesia Tbk"). */
const LEADING_FORMS: ReadonlySet<string> = new Set(["pt"]);

/** A word as names are compared: lower case, accents off. */
function plain(word: string): string {
  return word.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Which of a name's words name the company itself: from `from` up to `to`,
 * its legal form off the end ("and" with it: "Smith & Co") and off the front.
 * A name is never only its legal form: one word always stays.
 */
function ownWords(words: readonly string[]): { from: number; to: number } {
  let to = words.length;
  for (let stripped = true; stripped; ) {
    stripped = false;
    for (const form of LEGAL_FORMS) {
      if (to > form.length && form.every((word, index) => words[to - form.length + index] === word)) {
        to -= form.length;
        stripped = true;
        break;
      }
    }
    if (stripped && to > 1 && words[to - 1] === "and") to -= 1;
  }
  const from = to > 1 && LEADING_FORMS.has(words[0]) ? 1 : 0;
  return { from, to };
}

/** A name's words: letters and digits, lower case, accents off, "&" read as "and", "(M)" left out. */
function wordsOf(name: string): string[] {
  return plain(name.replace(MALAYSIA_MARK, " ").replace(/&/g, " and ")).match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * A name as the lists compare it: case, punctuation, spacing and legal
 * suffixes aside. "Top Glove Sdn. Bhd.", "TOP GLOVE SDN BHD" and "TopGlove"
 * are all "topglove".
 */
export function nameKey(name: string): string {
  const words = wordsOf(name);
  const { from, to } = ownWords(words);
  return words.slice(from, to).join("");
}

/** The same with the legal form kept, which tells "ABC Sdn. Bhd." from "ABC Pte. Ltd.". */
function fullKey(name: string): string {
  return wordsOf(name).join("");
}

/**
 * A company's name without its legal form, as written: "Terang Nusa Sdn.
 * Bhd." is "Terang Nusa", "PT Mark Dynamics Indonesia Tbk" is "Mark Dynamics
 * Indonesia". New Manufacturer offers it as the brand when a document prints
 * none.
 */
export function shortName(name: string): string {
  const text = name.replace(MALAYSIA_MARK, " ").replace(/\s+/g, " ").trim();
  const runs = [...text.matchAll(/[\p{L}\p{M}\p{N}]+/gu)];
  const { from, to } = ownWords(runs.map((run) => plain(run[0])));
  if (from === 0 && to === runs.length) return text;
  const start = runs[from].index;
  const end = to < runs.length ? runs[to].index : text.length;
  // What stood between the name and its legal form goes with the form: "Ansell Lanka (Pvt) Ltd" is "Ansell Lanka".
  return text.slice(start, end).replace(/[^\p{L}\p{M}\p{N})\]]+$/u, "") || text;
}

export type NameMatch<T> = { kind: "one"; entry: T } | { kind: "several"; entries: T[] } | { kind: "none" };

/**
 * The entry a name stands for: the one whose name reads the same in full
 * (case, punctuation and spacing aside), else the one that does once legal
 * suffixes are aside too. "several" when that is more than one ("ABC" with
 * ABC Sdn. Bhd. and ABC Pte. Ltd. listed): the name alone cannot say which.
 */
export function findByName<T>(name: string, entries: readonly T[], nameOf: (entry: T) => string | null): NameMatch<T> {
  const key = nameKey(name);
  if (key === "") return { kind: "none" };
  const full = fullKey(name);
  const named = entries.flatMap((entry) => {
    const entryName = nameOf(entry);
    return entryName ? [{ entry, entryName }] : [];
  });
  for (const same of [(entryName: string) => fullKey(entryName) === full, (entryName: string) => nameKey(entryName) === key]) {
    const found = named.filter(({ entryName }) => same(entryName)).map(({ entry }) => entry);
    if (found.length === 1) return { kind: "one", entry: found[0] };
    if (found.length > 1) return { kind: "several", entries: found };
  }
  return { kind: "none" };
}

/* ------------------------------------------------------------------ *
 * The manufacturers: brands, companies, factories
 * ------------------------------------------------------------------ */

export type DirectoryBrand = { id: string; name: string };
export type DirectoryCompany = { id: string; brandId: string; name: string };
/** A factory: a manufacturers row, what inspections point at. */
export type DirectoryFactory = { id: string; companyId: string; factoryName: string | null; country: string | null };

/** The manufacturers as the lists hold them: brands, their companies, and the companies' factories. */
export type ManufacturerDirectory = {
  brands: readonly DirectoryBrand[];
  companies: readonly DirectoryCompany[];
  factories: readonly DirectoryFactory[];
};

/**
 * Every brand with its companies and their factories, in one query so they
 * come from one moment. manufacturers.name only repeats the company's name
 * (lib/inspections/format.ts): never read.
 */
export const DIRECTORY_SELECT = "id, name, companies:manufacturer_companies(id, name, factories:manufacturers(id, factory_name, country))";

/** A brand row as DIRECTORY_SELECT reads it. */
export type DirectoryRow = {
  id: string;
  name: string;
  companies: { id: string; name: string; factories: { id: string; factory_name: string | null; country: string | null }[] }[];
};

export function directoryFromRows(rows: readonly DirectoryRow[]): ManufacturerDirectory {
  const brands: DirectoryBrand[] = [];
  const companies: DirectoryCompany[] = [];
  const factories: DirectoryFactory[] = [];
  for (const brand of rows) {
    brands.push({ id: brand.id, name: brand.name });
    for (const company of brand.companies) {
      companies.push({ id: company.id, brandId: brand.id, name: company.name });
      for (const factory of company.factories) {
        factories.push({ id: factory.id, companyId: company.id, factoryName: factory.factory_name, country: factory.country });
      }
    }
  }
  return { brands, companies, factories };
}

/** Each factory with its company and brand, as the selects embed them, for the names lib/inspections/format.ts gives it. */
function namedFactories(directory: ManufacturerDirectory): (ManufacturerNames & { id: string })[] {
  const brands = new Map(directory.brands.map((brand) => [brand.id, brand]));
  const companies = new Map(directory.companies.map((company) => [company.id, company]));
  return directory.factories.map((factory) => {
    const company = companies.get(factory.companyId);
    const brand = company ? brands.get(company.brandId) : undefined;
    return {
      id: factory.id,
      factory_name: factory.factoryName,
      company: company ? { name: company.name, brand: brand ? { name: brand.name } : null } : null,
    };
  });
}

/** The manufacturer picker's options: each factory by its label ("Top Glove · TG-F40"), as everywhere else. */
export function directoryOptions(directory: ManufacturerDirectory): { id: string; label: string }[] {
  return manufacturerOptions(namedFactories(directory));
}

/** Each factory by every name a document may print for it, for Steri-AI: "Top Glove · Terang Nusa Sdn. Bhd. · TG-F40". */
export function directoryFullNames(directory: ManufacturerDirectory): { id: string; name: string }[] {
  return namedFactories(directory).map((factory) => ({ id: factory.id, name: manufacturerFullName(factory) }));
}

/* ------------------------------------------------------------------ *
 * A new manufacturer: what is listed already, and what Add adds
 * ------------------------------------------------------------------ */

/** What New Manufacturer names, cleaned: the brand, the company and the factory (null: none named). */
export type ManufacturerNaming = { brand: string; company: string; factory: string | null };

/** A brand or company Add uses: a listed one (its id), or a new one (id null) by this name. */
export type PlannedEntry = { id: string | null; name: string };

export type ManufacturerPlan =
  /** That factory is in the list already: it is chosen, nothing is added. */
  | { kind: "listed"; factoryId: string }
  /** No factory named, and the company (or the brand, when only the brand is named) has several: the inspector chooses, or names one to add it. */
  | { kind: "choose"; name: string; factories: number }
  /** More than one listed company (or brand) reads like this name: its full name tells them apart. */
  | { kind: "unclear"; field: "brand" | "company" }
  /** What Add adds: a listed brand or company is reused (its id), only what is missing is added. */
  | { kind: "add"; brand: PlannedEntry; company: PlannedEntry; factory: string | null };

/**
 * What Add does with these names. A company that reads the same as a listed
 * one is that company, under its own brand whatever brand was named, and a
 * factory it has by that name is that factory; named without a factory, a
 * company's only factory is that one, and one with several needs a choice.
 * A new company goes under the listed brand that reads the same, and a
 * factory that brand already has by that name is that factory. Anything
 * else is new.
 */
export function planManufacturer(naming: ManufacturerNaming, directory: ManufacturerDirectory): ManufacturerPlan {
  const factoriesOf = (companyIds: ReadonlySet<string>) => directory.factories.filter((factory) => companyIds.has(factory.companyId));
  const byFactoryName = (factories: readonly DirectoryFactory[], name: string) => findByName(name, factories, (factory) => factory.factoryName);

  const company = findByName(naming.company, directory.companies, (entry) => entry.name);
  if (company.kind === "several") return { kind: "unclear", field: "company" };
  if (company.kind === "one") {
    const listed = company.entry;
    const factories = factoriesOf(new Set([listed.id]));
    if (naming.factory) {
      const factory = byFactoryName(factories, naming.factory);
      if (factory.kind === "one") return { kind: "listed", factoryId: factory.entry.id };
      if (factory.kind === "several") return { kind: "choose", name: listed.name, factories: factories.length };
    } else if (factories.length === 1) {
      return { kind: "listed", factoryId: factories[0].id };
    } else if (factories.length > 1) {
      return { kind: "choose", name: listed.name, factories: factories.length };
    }
    const brand = directory.brands.find((entry) => entry.id === listed.brandId);
    return {
      kind: "add",
      brand: { id: listed.brandId, name: brand?.name ?? naming.brand },
      company: { id: listed.id, name: listed.name },
      factory: naming.factory,
    };
  }

  const brand = findByName(naming.brand, directory.brands, (entry) => entry.name);
  if (brand.kind === "several") return { kind: "unclear", field: "brand" };
  if (brand.kind === "one") {
    const listed = brand.entry;
    const factories = factoriesOf(new Set(directory.companies.filter((entry) => entry.brandId === listed.id).map((entry) => entry.id)));
    if (naming.factory) {
      // The brand's factory of that name, under a company the document names otherwise.
      const factory = byFactoryName(factories, naming.factory);
      if (factory.kind === "one") return { kind: "listed", factoryId: factory.entry.id };
    } else if (factories.length > 0 && nameKey(naming.company) === nameKey(listed.name)) {
      // Only the brand is named: one of its factories.
      return factories.length === 1
        ? { kind: "listed", factoryId: factories[0].id }
        : { kind: "choose", name: listed.name, factories: factories.length };
    }
    return { kind: "add", brand: { id: listed.id, name: listed.name }, company: { id: null, name: naming.company }, factory: naming.factory };
  }

  return { kind: "add", brand: { id: null, name: naming.brand }, company: { id: null, name: naming.company }, factory: naming.factory };
}

/** New Manufacturer's fields as text, "" for none. */
export type ManufacturerFields = { brand: string; company: string; factory: string; address: string; country: string };

/**
 * New Manufacturer's fields as a document fills them. The company is the
 * registered name printed, else the brand or the name as printed (as the
 * brands migration made each old manufacturer a company of its own name);
 * the brand is the one printed, else the company's short name.
 */
export function manufacturerDraft(details: ManufacturerDetails | null, printed: string | null): ManufacturerFields {
  const company = details?.company ?? details?.brand ?? printed ?? "";
  return {
    brand: details?.brand ?? (company === "" ? "" : shortName(company)),
    company,
    factory: details?.factory ?? "",
    address: details?.address ?? "",
    country: details?.country ?? "",
  };
}
