import type { InspectionStatus } from "@/lib/schemas/common";

/** Workflow status labels (BUILD_SPEC 5: draft, submitted, approved, reopened). */
export const INSPECTION_STATUS_LABEL: Readonly<Record<InspectionStatus, string>> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  reopened: "Reopened",
};

// British order, short month: 6 Oct 2026. Dates are calendar dates (the
// inspection day in Malaysia), so they are formatted in UTC and never shift.
const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** `2026-10-06` as `6 Oct 2026`. Anything that is not a calendar date is shown as it is. */
export function formatInspectionDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const [, year, month, day] = match;
  return DATE_FORMAT.format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
}

/** A factory row as the selects embed it: its own name, its company and the company's brand. */
export type ManufacturerNames = { factory_name: string | null; company: { name: string; brand: { name: string } | null } | null };

/**
 * What a select embeds of a factory (a manufacturers row) for ManufacturerNames,
 * after its own columns: `manufacturer:manufacturers(id, ${MANUFACTURER_NAMES_SELECT})`.
 * manufacturers.name only repeats the company's name for code written before
 * the brands (migration 20261027163000): never read it.
 */
export const MANUFACTURER_NAMES_SELECT = "factory_name, company:manufacturer_companies(name, brand:manufacturer_brands(name))";

/** A letter (its accents too) or digit: the brand must end where a word does (startsWithWords). */
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}]/u;

/** `text` starts with `words` as whole words, ignoring case: "Hartalega NGC" with "Hartalega", not "Hartalegas". */
function startsWithWords(text: string, words: string): boolean {
  if (words === "" || text.slice(0, words.length).toLowerCase() !== words.toLowerCase()) return false;
  const next = text.charAt(words.length);
  return next === "" || !WORD_CHARACTER.test(next) || !WORD_CHARACTER.test(words.charAt(words.length - 1));
}

/**
 * A manufacturer as the app names it everywhere (Kenneth's report design:
 * "Manufacturer / Supplier: Top Glove F-35"): the brand, then the factory,
 * "Top Glove · TG-F40". A factory without a name goes by its company. The
 * brand is left out when that part already starts with it ("Hartalega NGC",
 * not "Hartalega · Hartalega NGC").
 */
export function manufacturerLabel(manufacturer: ManufacturerNames): string {
  const brand = manufacturer.company?.brand?.name.trim() ?? "";
  const place = manufacturer.factory_name?.trim() || manufacturer.company?.name.trim() || "";
  if (brand === "") return place;
  if (place === "") return brand;
  return startsWithWords(place, brand) ? place : `${brand} · ${place}`;
}

/**
 * The manufacturer without its factory: its brand, or its company when it
 * has none. For the capture screen's header line, which names no factory
 * (Kenneth, 7 October 2026: the header was crowded).
 */
export function manufacturerBrand(manufacturer: ManufacturerNames): string | null {
  return manufacturer.company?.brand?.name.trim() || manufacturer.company?.name.trim() || null;
}

/**
 * Every name a document may print for the factory, for Steri-AI to match it
 * by: brand, company and factory, each once ("Top Glove · Terang Nusa Sdn.
 * Bhd. · TG-F40", "Hartalega · Hartalega NGC").
 */
export function manufacturerFullName(manufacturer: ManufacturerNames): string {
  const parts: string[] = [];
  for (const name of [manufacturer.company?.brand?.name, manufacturer.company?.name, manufacturer.factory_name]) {
    const part = name?.trim() ?? "";
    if (part !== "" && !parts.some((kept) => kept.toLowerCase() === part.toLowerCase())) parts.push(part);
  }
  return parts.join(" · ");
}

// As people read a list: case aside, numbers by value ("TG-F9" before "TG-F40").
const BY_LABEL = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

/**
 * The pickers' manufacturers: each factory by its label, in the labels'
 * order. Factories whose labels would read the same (one brand's companies
 * with a factory of the same name) go by their full names instead, so a
 * picker never offers two alike.
 */
export function manufacturerOptions(manufacturers: readonly (ManufacturerNames & { id: string })[]): { id: string; label: string }[] {
  const named = manufacturers.map((manufacturer) => ({
    id: manufacturer.id,
    label: manufacturerLabel(manufacturer),
    fullName: manufacturerFullName(manufacturer),
  }));
  const uses = new Map<string, number>();
  for (const { label } of named) uses.set(label.toLowerCase(), (uses.get(label.toLowerCase()) ?? 0) + 1);
  return named
    .map(({ id, label, fullName }) => ({ id, label: (uses.get(label.toLowerCase()) ?? 0) > 1 ? fullName : label, fullName }))
    .sort((a, b) => BY_LABEL.compare(a.label, b.label) || BY_LABEL.compare(a.fullName, b.fullName) || a.id.localeCompare(b.id))
    .map(({ id, label }) => ({ id, label }));
}

/** A person by name, falling back to their email address. */
export function personLabel(person: { full_name: string | null; email: string | null } | null): string | null {
  if (!person) return null;
  return person.full_name?.trim() || person.email?.trim() || null;
}
