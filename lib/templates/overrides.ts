// Switching a module off for one inspection (BUILD_SPEC 4.4). An admin sets
// `inspections.module_overrides` with a reason; the inspection then runs on
// a copy of the resolved template where that module is excluded and carries
// the override, so capture, validation and the export all drop it and the
// export lists it under `excludedModules` with the reason.
import { ALWAYS_ON_MODULE_KEYS, isModuleKey, type ModuleKey } from "@/lib/schemas/module-result";
import {
  ModuleOverrideSchema,
  type ModuleOverrides,
  type ResolvedModule,
  type ResolvedTemplate,
} from "@/lib/schemas/template";

const ALWAYS_ON: ReadonlySet<ModuleKey> = new Set(ALWAYS_ON_MODULE_KEYS);

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
  return null;
}

/** The inspection's copy of the template. Overrides that cannot apply are ignored. */
export function applyModuleOverrides(
  template: ResolvedTemplate,
  overrides: ModuleOverrides | null | undefined,
): ResolvedTemplate {
  if (!overrides || Object.keys(overrides).length === 0) return template;
  return {
    ...template,
    modules: template.modules.map((module) => {
      const override = overrides[module.key];
      if (!override || !module.include || ALWAYS_ON.has(module.key)) return module;
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
