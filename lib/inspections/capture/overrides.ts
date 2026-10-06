// Switching a module off for one inspection (BUILD_SPEC 4.4): an admin's
// decision, with a reason that is logged and exported. lib/templates decides
// which modules may be switched off (moduleOverrideProblem); this file words
// the refusals for the screen and builds the new `module_overrides` value.
// The module's data stays saved while it is off, so it returns when the
// module is switched back on.
import { ALWAYS_ON_MODULE_KEYS, type ModuleKey } from "@/lib/schemas/module-result";
import type { ModuleOverride, ModuleOverrides, ResolvedTemplate } from "@/lib/schemas/template";
import { moduleOverrideProblem } from "@/lib/templates";

const NEEDED_BY_OTHERS: Partial<Record<ModuleKey, string>> = {
  order_lots: "it gives the ordered sizes every per-size section shows",
  sampling_plan: "it gives the sample sizes the test sections use",
};

/**
 * Why `key` cannot be switched off for this inspection, in words for the
 * admin, or null when it can.
 *
 * @param template as stored in `templates.resolved` (no overrides applied)
 */
export function switchOffProblem(template: ResolvedTemplate, overrides: ModuleOverrides, key: ModuleKey): string | null {
  const resolved = template.modules.find((entry) => entry.key === key);
  const title = resolved?.title ?? key;
  if (overrides[key]) return `${title} is already switched off for this inspection.`;
  const problem = moduleOverrideProblem(template, key);
  if (problem === null) return null;
  if ((ALWAYS_ON_MODULE_KEYS as readonly ModuleKey[]).includes(key)) {
    return `${title} is always on. Its fields are switched on and off in the template.`;
  }
  if (!resolved) return "This section is not part of the inspection's template.";
  if (!resolved.include) return `${title} is already off in the template.`;
  const needed = NEEDED_BY_OTHERS[key];
  if (needed) return `${title} cannot be switched off: ${needed}.`;
  // A custom field shows one of its values (Field.mapsTo): the library's sentence names them.
  return `${title} cannot be switched off. ${problem.replace(`of ${key},`, "of it,")}`;
}

/** Why `key` cannot be switched back on, or null when it can. */
export function switchOnProblem(template: ResolvedTemplate, overrides: ModuleOverrides, key: ModuleKey): string | null {
  if (overrides[key]) return null;
  const title = template.modules.find((entry) => entry.key === key)?.title ?? key;
  return `${title} is not switched off for this inspection.`;
}

export function withOverride(overrides: ModuleOverrides, key: ModuleKey, override: ModuleOverride): ModuleOverrides {
  return { ...overrides, [key]: override };
}

export function withoutOverride(overrides: ModuleOverrides, key: ModuleKey): ModuleOverrides {
  const next: ModuleOverrides = { ...overrides };
  delete next[key];
  return next;
}

/** Whether the module can be offered a "Switch off" button at all. */
export function canBeSwitchedOff(template: ResolvedTemplate, overrides: ModuleOverrides, key: ModuleKey): boolean {
  return switchOffProblem(template, overrides, key) === null;
}
