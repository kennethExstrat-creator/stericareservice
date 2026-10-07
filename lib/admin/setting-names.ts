import type { ModuleKey } from "@/lib/schemas/module-result";

/**
 * Settings whose key says nothing on its own ("n") and whose schema gives no
 * title, named once for the template editor's settings form and problem list
 * (edit/_lib/settings.ts) and the version page's coverage checklist
 * (lib/admin/templates.ts). A title the module gives the setting
 * (`.meta({ title })`) wins: the form reads the title first.
 */
export const SETTING_NAMES: Readonly<Partial<Record<ModuleKey, Readonly<Record<string, string>>>>> = {
  weight: { n: "Gloves Weighed" },
  force_at_break: { n: "Gloves Tested" },
  labeling: { n: "Boxes to Inspect" },
  dye_leak: { n: "Pouches to Test" },
};
