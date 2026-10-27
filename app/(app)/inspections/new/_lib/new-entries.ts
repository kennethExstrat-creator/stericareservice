// New Client and New Manufacturer on /inspections/new (docs/AI.md, "Reading
// order documents"; Kenneth, 27 October 2026: "the Steri AI should be able to
// read doc to use existing client and manufacturer or create new one"): what
// the form sends to ../reference-actions.ts, what it answers, and the words
// both use. The fields follow the admin screens' rules (lib/admin/reference.ts,
// lib/admin/manufacturers.ts). Shared by the form and the actions, so the
// browser checks a name as the server will.
import { z } from "zod";
import { ClientInputSchema } from "@/lib/admin/reference";
import { BrandInputSchema, CompanyInputSchema, FactoryInputSchema } from "@/lib/admin/manufacturers";
import type { ManufacturerDirectory, ManufacturerPlan } from "@/lib/inspections/reference-match";
import type { Option } from "./types";

export const NewClientSchema = z.object({ name: ClientInputSchema.shape.name });
export type NewClientField = keyof z.output<typeof NewClientSchema>;
export type NewClientInput = Record<NewClientField, string>;

/** The brand and company are required, as on Admin > Manufacturers; a company's only factory may have no name. */
export const NewManufacturerSchema = z.object({
  brand: BrandInputSchema.shape.name,
  company: CompanyInputSchema.shape.name,
  factory: FactoryInputSchema.shape.factory_name,
  address: FactoryInputSchema.shape.address,
  country: FactoryInputSchema.shape.country,
});
export type NewManufacturerField = keyof z.output<typeof NewManufacturerSchema>;
export type NewManufacturerInput = Record<NewManufacturerField, string>;

/**
 * What an Add answers. "added": it is new in the list now; "listed": the list
 * had it already (added by someone else meanwhile, or the name reads like a
 * listed one), so it is chosen and nothing is added. `option` is what the
 * picker chooses; `note` goes under the summary's line.
 */
export type AddClientResult =
  | { status: "added" | "listed"; option: Option; note: string }
  | { status: "error"; message: string; fieldErrors?: Partial<Record<NewClientField, string>> };

/** The same for a manufacturer, with the brands, companies and factories as they are now. */
export type AddManufacturerResult =
  | { status: "added" | "listed"; option: Option; note: string; directory: ManufacturerDirectory }
  | { status: "error"; message: string; fieldErrors?: Partial<Record<NewManufacturerField, string>> };

export type ClientAdded = Extract<AddClientResult, { option: Option }>;
export type ManufacturerAdded = Extract<AddManufacturerResult, { option: Option }>;

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

export const CHECK_FIELDS = "Check the highlighted fields.";

export const NOTES = {
  clientAdded: "Added to the clients.",
  listed: "Already in the list: chosen, nothing added.",
} as const;

export const NOT_ADDED = {
  client: "The client could not be added. Try again.",
  manufacturer: "The manufacturer could not be added. Try again.",
} as const;

/** A server without the secret key adds through the user's own session, which only a role with the switch may (Row Level Security). */
export const NO_SWITCH = {
  client: "Your role cannot add clients on this server. Ask an admin to add it under Admin > Clients.",
  manufacturer: "Your role cannot add manufacturers on this server. Ask an admin to add it under Admin > Manufacturers.",
} as const;

/** Under the summary's line, for a client or factory the app found listed by the names a document prints. */
export function matchedNote(printed: string | null): string {
  return printed ? `Already in the list: the document says “${printed}”.` : "Already in the list, by the names the document prints.";
}

export const UNREACHABLE = "Could not reach the server. Check the connection, then try again.";

export const SEVERAL_CLIENTS = "More than one client in the list reads like this one. Choose it under Client, or enter the name in full.";

/** Before Add Client: a name that reads like a listed client's. */
export function clientListedHint(label: string): string {
  return `Already in the list as ${label}: Add Client chooses it.`;
}

/** What New Manufacturer says before Add, and why Add is refused when it cannot add. */
export type PlanWords = { text: string; warn: boolean; field?: NewManufacturerField };

/**
 * A plan in words. `verb` is "Adds" before the tap and "Added" after it:
 * "Adds the factory TG-F40 to Terang Nusa Sdn. Bhd. (Top Glove)."
 */
export function planWords(plan: ManufacturerPlan, label: (factoryId: string) => string, verb: "Adds" | "Added" = "Adds"): PlanWords {
  switch (plan.kind) {
    case "listed":
      return { text: `Already in the list as ${label(plan.factoryId)}: Add Manufacturer chooses it.`, warn: false };
    case "choose":
      return {
        text: `${plan.name} has ${plan.factories} factories in the list. Choose one under Manufacturer, or enter the factory to add it.`,
        warn: true,
        field: "factory",
      };
    case "unclear":
      return plan.field === "company"
        ? { text: "More than one company in the list reads like this one. Enter the company's full registered name.", warn: true, field: "company" }
        : { text: "More than one brand in the list reads like this one. Choose it from the suggestions.", warn: true, field: "brand" };
    case "add": {
      const factory = plan.factory ? `the factory ${plan.factory}` : "its factory";
      if (plan.company.id) {
        const to = `${plan.company.name} (${plan.brand.name})`;
        return { text: plan.factory ? `${verb} the factory ${plan.factory} to ${to}.` : `${verb} a factory to ${to}.`, warn: false };
      }
      if (plan.brand.id) return { text: `${verb} the company ${plan.company.name} to the brand ${plan.brand.name}, with ${factory}.`, warn: false };
      return { text: `${verb} the brand ${plan.brand.name}, its company ${plan.company.name} and ${factory}.`, warn: false };
    }
  }
}

/* ------------------------------------------------------------------ *
 * The pickers
 * ------------------------------------------------------------------ */

const BY_LABEL = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

/**
 * The picker's options with `more` the page did not offer, each in its place
 * by label; the options as they were when there is nothing new, so the
 * picker keeps its options (and its key) unless one is added.
 */
export function withOptions(options: readonly Option[], more: readonly Option[]): readonly Option[] {
  const missing = more.filter((option, index) => !options.some((known) => known.id === option.id) && more.findIndex((other) => other.id === option.id) === index);
  if (missing.length === 0) return options;
  const merged = [...options];
  for (const option of missing) {
    const at = merged.findIndex((known) => BY_LABEL.compare(known.label, option.label) > 0);
    merged.splice(at === -1 ? merged.length : at, 0, option);
  }
  return merged;
}
