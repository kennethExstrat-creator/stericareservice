// A module's settings as the editor draws and names them (BUILD_SPEC 10: "a
// config form per module, generated from its config schema"). The settings
// form and the problem list both read from here, so a setting has one name
// wherever the editor shows it.
import { CanonicalSizeSchema } from "@/lib/sizes";
import type { ModuleKey } from "@/lib/schemas/module-result";
import { describeSchema, type FormMarker, type FormNode, type KeyOption, type NamingHooks } from "@/lib/zod-form";
import { SpecSchema, type AnyModuleDefinition } from "@/modules/_framework";

/** Schemas the form recognises wherever they are used: a size offers the template's sizes, a spec its kinds. */
export const CONFIG_MARKERS: readonly FormMarker[] = [
  { name: "size", schema: CanonicalSizeSchema },
  { name: "spec", schema: SpecSchema },
];

/** A spec's kinds (SpecSchema), as the form offers them. */
export const SPEC_KINDS: Readonly<Record<string, string>> = {
  min: "Minimum (≥)",
  max: "Maximum (≤)",
  range: "Range (min – max)",
  tolerance: "Nominal ± tolerance",
  na: "NA (not judged)",
};

/** Settings of a stub: any JSON until the module is built. */
const STUB_NODE: FormNode = {
  kind: "json",
  reason: "Not built yet",
  description: "Free-form until the module is built; its own settings check them then.",
  meta: {},
};

/** The form a module's settings take: its config schema described, or free JSON for a stub. */
export function configNodeOf(definition: AnyModuleDefinition): FormNode {
  return definition.stub ? STUB_NODE : describeSchema(definition.configSchema, { markers: CONFIG_MARKERS });
}

/**
 * Settings whose key says nothing on its own ("n") and whose schema gives no
 * title. A title the module gives the setting (`.meta({ title })`) wins:
 * the form reads the title first.
 */
export const SETTING_NAMES: Readonly<Partial<Record<ModuleKey, Readonly<Record<string, string>>>>> = {
  weight: { n: "Gloves weighed" },
  force_at_break: { n: "Gloves tested" },
  labeling: { n: "Boxes to inspect" },
  dye_leak: { n: "Pouches to test" },
};

/**
 * How the editor names a module's settings: the schema's title, else the
 * names above, else the module's own words for the key (a field switched on,
 * a measure's decimals), else the key in words. Not the module's words for a
 * choice or a text: dimensions labels its statistic row "Median", which is no
 * name for the median-or-average select.
 */
export function settingNaming(
  key: ModuleKey,
  labels: Readonly<Record<string, string>>,
  sizes: readonly KeyOption[],
): Required<NamingHooks> {
  return {
    labelForKey: (name, _path, field) =>
      SETTING_NAMES[key]?.[name] ??
      (field && (field.kind === "enum" || field.kind === "string" || field.kind === "literal") ? undefined : labels[name]),
    markerOptions: (marker) => (marker === "size" ? sizes : undefined),
    variantLabel: (marker, value) => (marker === "spec" ? SPEC_KINDS[value] : undefined),
  };
}
