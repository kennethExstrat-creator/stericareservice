// Switching a module off for one inspection (BUILD_SPEC 4.4). An admin sets
// `inspections.module_overrides` with a reason; the inspection then runs on
// a copy of the resolved template where that module is excluded and carries
// the override, so capture, validation and the export all drop it and the
// export lists it under `excludedModules` with the reason.
//
// Some modules cannot be switched off this way: header and conclusion are
// always on; order_lots and sampling_plan give the sizes and sample sizes
// other modules cannot do without; and a module whose value a custom field
// shows (Field.mapsTo) would leave that field showing a switched-off value.
import { ALWAYS_ON_MODULE_KEYS, isModuleKey, type ModuleKey } from "@/lib/schemas/module-result";
import {
  ModuleOverrideSchema,
  type ModuleOverrides,
  type ResolvedModule,
  type ResolvedTemplate,
} from "@/lib/schemas/template";
import { parseCanonicalPath } from "@/modules/_framework/paths";

const ALWAYS_ON: ReadonlySet<ModuleKey> = new Set(ALWAYS_ON_MODULE_KEYS);

/** Modules whose values other modules need, and what those values are. */
const NEEDED_BY_OTHERS: Readonly<Partial<Record<ModuleKey, string>>> = {
  order_lots: "the ordered sizes, which every per-size module shows (BUILD_SPEC 6.2 rule 4)",
  sampling_plan: "the sample sizes (n) the test modules use",
};

/** Valid entries of a stored `module_overrides` value; anything malformed is left out. */
export function parseModuleOverrides(value: unknown): ModuleOverrides {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const overrides: ModuleOverrides = {};
  for (const [key, entry] of Object.entries(value)) {
    const parsed = ModuleOverrideSchema.safeParse(entry);
    if (parsed.success && isModuleKey(key)) overrides[key] = parsed.data;
  }
  return overrides;
}

/** Why a module cannot be switched off for an inspection, or null when it can. */
export function moduleOverrideProblem(template: ResolvedTemplate, key: string): string | null {
  if (!isModuleKey(key)) return `${key} is not a module.`;
  if (ALWAYS_ON.has(key)) return `${key} is always on; switch its fields off in the template instead.`;
  const found = template.modules.find((candidate) => candidate.key === key);
  if (!found) return `${key} is not part of template ${template.code}.`;
  if (!found.include && !found.override) return `${key} is already off in template ${template.code}.`;
  const needed = NEEDED_BY_OTHERS[key];
  if (needed) return `${key} gives ${needed}, so it cannot be switched off for one inspection.`;
  const shownIn = fieldsMappedTo(template, key);
  if (shownIn.length > 0) {
    return `${shownIn.join(", ")} ${shownIn.length === 1 ? "shows a value" : "show values"} of ${key}, so it cannot be switched off for one inspection.`;
  }
  return null;
}

/** The inspection's copy of the template. Overrides that cannot apply (moduleOverrideProblem) are ignored. */
export function applyModuleOverrides(
  template: ResolvedTemplate,
  overrides: ModuleOverrides | null | undefined,
): ResolvedTemplate {
  if (!overrides || Object.keys(overrides).length === 0) return template;
  return {
    ...template,
    modules: template.modules.map((module) => {
      const override = overrides[module.key];
      if (!override || moduleOverrideProblem(template, module.key) !== null) return module;
      return { ...module, include: false, override };
    }),
  };
}

export function includedModules(template: ResolvedTemplate): ResolvedModule[] {
  return template.modules.filter((module) => module.include);
}

/** Modules switched off for this inspection, with the reason: the export's `excludedModules`. */
export function excludedForInspection(template: ResolvedTemplate): { key: ModuleKey; title: string; reason: string }[] {
  return template.modules.flatMap((module) =>
    module.override ? [{ key: module.key, title: module.title, reason: module.override.reason }] : [],
  );
}

/** Custom fields that show a value of `key` (Field.mapsTo), as "Section: Field". */
function fieldsMappedTo(template: ResolvedTemplate, key: ModuleKey): string[] {
  return template.customModules.flatMap((custom) =>
    custom.fields
      .filter((field) => field.mapsTo !== undefined && parseCanonicalPath(field.mapsTo)?.moduleKey === key)
      .map((field) => `${custom.title}: ${field.label}`),
  );
}
