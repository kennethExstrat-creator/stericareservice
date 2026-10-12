// Step names (Kenneth, 12 October 2026: "this menu is crowded, simplify the
// section name"). A template's title is its client's form wording: it stays
// whole on the step's card and wherever the client reads it (BUILD_SPEC 6.2
// rule 11). Wherever else the capture screen names a step it uses the step's
// short name (docs/DESIGN.md, Step Names). Code, not template data: every
// template version has them, with nothing published.
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { CustomModule } from "@/lib/schemas/template";

/** One line of a sidebar step: 144 px of 14 px Outfit semibold ("Packing Configuration", 21 characters, is 141 px). */
export const SHORT_TITLE_MAX = 21;

/** Each module's short name, the same in every template: one to three words, Title Case. */
export const MODULE_SHORT_TITLES: Readonly<Record<ModuleKey, string>> = {
  header: "Manufacturer",
  glove_info: "Glove Information",
  order_lots: "Order",
  packing_config: "Packing Configuration",
  sampling_plan: "Sampling Plan",
  carton_sampling: "Carton Numbers",
  dimensions: "Dimension",
  force_at_break: "Force at Break",
  tensile: "Physical Properties",
  weight: "Weight",
  watertight: "Watertight Test",
  visual: "Visual Inspection",
  dispensing_packing: "Packing Check",
  dispensing_safedon: "Dispensing",
  labeling: "Labeling",
  conclusion: "Conclusion",
  dye_leak: "Dye Leak Test",
  documents: "Documents",
  loading: "Loading",
};

/** A template that names a step its own way keeps it, matched by that title, case and spacing aside (STD_SG). */
export const WORDING_SHORT_TITLES: Readonly<Partial<Record<ModuleKey, Readonly<Record<string, string>>>>> = {
  header: { "Purchase Order / Shipment Information": "Shipment" },
  order_lots: { "PO Info": "PO Info" },
  packing_config: { "Packing Mode": "Packing Mode" },
};

/** Seed custom modules with a page of their own and a long title. */
export const CUSTOM_SHORT_TITLES: Readonly<Record<string, string>> = {
  safedon_dispensing_notes: "Dispensing Notes",
};

const normal = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

/** A module's short name, given the title the inspection shows (a count in it never matters). */
export function shortTitleFor(key: ModuleKey, title: string): string {
  const own = Object.entries(WORDING_SHORT_TITLES[key] ?? {}).find(([wording]) => normal(wording) === normal(title));
  return own?.[1] ?? MODULE_SHORT_TITLES[key] ?? withoutNote(title);
}

/** A custom module's short name: listed, else its title without a trailing note in brackets. */
export function customShortTitle(custom: Pick<CustomModule, "key" | "title">): string {
  return Object.hasOwn(CUSTOM_SHORT_TITLES, custom.key) ? CUSTOM_SHORT_TITLES[custom.key] : withoutNote(custom.title);
}

/** "Site Notes (Optional)" as "Site Notes"; "Weight (g)", and a title that is only brackets, stay. Moved from capture/issues.ts shortTitle. */
export function withoutNote(title: string): string {
  const match = /^(.{8,}?)\s*\([^()]*\)$/.exec(title.trim());
  return match ? match[1] : title.trim();
}
