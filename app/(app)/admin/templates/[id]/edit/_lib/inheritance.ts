// What a template inherits (BUILD_SPEC 4.2 rule 9): for every module its
// bases mention, whether it is on, its heading, labels and config as the
// bases leave them; the order they leave the modules in; their custom
// modules. The editor shows a template against this, and writes only what
// differs from it. Mirrors lib/templates/resolve.ts, which stays the judge:
// these values only explain the template to the admin.
import { ALWAYS_ON_MODULE_KEYS, type ModuleKey } from "@/lib/schemas/module-result";
import {
  TemplateDefinitionSchema,
  type CustomModule,
  type TemplateDefinition,
  type TemplateReport,
} from "@/lib/schemas/template";
import {
  applyListedOrder,
  isJsonObject,
  MAX_EXTENDS_DEPTH,
  mergeConfig,
  pinEnds,
  type JsonObject,
  type TemplateLookup,
} from "@/lib/templates";
import type { ModuleRegistry } from "@/modules/_framework";

export type InheritedModule = {
  key: ModuleKey;
  include: boolean;
  title?: string;
  labels: Readonly<Record<string, string>>;
  /** The bases' config for the module, merged root first, before the module's defaults. */
  config: JsonObject;
};

export type BaseRef = { code: string; version: number };

export type Inheritance = {
  /** The bases, nearest first. */
  bases: BaseRef[];
  /** Module order the bases leave (lib/templates/module-order.ts). */
  order: ModuleKey[];
  modules: ReadonlyMap<ModuleKey, InheritedModule>;
  customModules: CustomModule[];
  report: TemplateReport | null;
  /** Why the chain stopped short: a base that is missing or does not read. */
  problems: string[];
};

export const NO_INHERITANCE: Inheritance = {
  bases: [],
  order: [],
  modules: new Map(),
  customModules: [],
  report: null,
  problems: [],
};

/** The bases of a definition, nearest first, as `getBase` finds them. */
export function baseChain(
  extendsCode: string | undefined,
  ownCode: string | undefined,
  getBase: TemplateLookup,
): { entries: { code: string; version: number; definition: TemplateDefinition }[]; problems: string[] } {
  const entries: { code: string; version: number; definition: TemplateDefinition }[] = [];
  const seen = new Set<string>(ownCode ? [ownCode] : []);
  let code = extendsCode;
  while (code !== undefined) {
    if (seen.has(code)) return { entries, problems: [`Templates extend each other in a loop at ${code}.`] };
    if (entries.length >= MAX_EXTENDS_DEPTH) {
      return { entries, problems: [`More than ${MAX_EXTENDS_DEPTH} templates in the extends chain.`] };
    }
    seen.add(code);
    const base = getBase(code);
    if (!base) return { entries, problems: [`Base template ${code} has no active version.`] };
    const parsed = TemplateDefinitionSchema.safeParse(base.definition);
    if (!parsed.success) return { entries, problems: [`Base template ${code} version ${base.version} does not read as a template.`] };
    entries.push({ code, version: base.version, definition: parsed.data });
    code = parsed.data.extends;
  }
  return { entries, problems: [] };
}

/** Everything a definition inherits from its bases. A template without `extends` inherits nothing. */
export function inheritanceOf(
  definition: { code?: unknown; extends?: unknown },
  getBase: TemplateLookup,
): Inheritance {
  const extendsCode = typeof definition.extends === "string" ? definition.extends : undefined;
  if (extendsCode === undefined) return NO_INHERITANCE;
  const ownCode = typeof definition.code === "string" ? definition.code : undefined;
  const chain = baseChain(extendsCode, ownCode, getBase);
  const rootFirst = [...chain.entries].reverse();

  let order: ModuleKey[] = [];
  const modules = new Map<ModuleKey, InheritedModule>();
  const custom = new Map<string, CustomModule>();
  for (const { definition: base } of rootFirst) {
    order = applyListedOrder(
      order,
      base.modules.map((entry) => entry.key),
    );
    for (const entry of base.modules) {
      const before = modules.get(entry.key);
      modules.set(entry.key, {
        key: entry.key,
        include: entry.include,
        title: entry.title ?? before?.title,
        labels: { ...before?.labels, ...entry.labels },
        config: mergeConfig(before?.config ?? {}, entry.config ?? {}),
      });
    }
    for (const entry of base.customModules ?? []) custom.set(entry.key, entry);
  }

  return {
    bases: chain.entries.map(({ code, version }) => ({ code, version })),
    order,
    modules,
    customModules: [...custom.values()],
    report: chain.entries.find((entry) => entry.definition.report)?.definition.report ?? null,
    problems: chain.problems,
  };
}

/** Header first and conclusion last, both always present (BUILD_SPEC 4.1), as the resolver orders them. */
export function finalOrder(baseOrder: readonly ModuleKey[], listed: readonly ModuleKey[]): ModuleKey[] {
  const order = applyListedOrder(baseOrder, listed);
  for (const key of ALWAYS_ON_MODULE_KEYS) if (!order.includes(key)) order.push(key);
  return pinEnds(order, "header", "conclusion");
}

/* ------------------------------------------------------------------ *
 * A module as the bases leave it, over its defaults
 * ------------------------------------------------------------------ */

export function inheritedTitle(inheritance: Inheritance, registry: ModuleRegistry, key: ModuleKey): string {
  return inheritance.modules.get(key)?.title ?? registry[key].title;
}

export function inheritedLabels(
  inheritance: Inheritance,
  registry: ModuleRegistry,
  key: ModuleKey,
): Readonly<Record<string, string>> {
  return { ...registry[key].labels, ...inheritance.modules.get(key)?.labels };
}

/** The module's default config with the bases' config merged over it: what this template starts from. */
export function inheritedConfig(inheritance: Inheritance, registry: ModuleRegistry, key: ModuleKey): JsonObject {
  const defaults = registry[key].defaultConfig;
  return mergeConfig(isJsonObject(defaults) ? defaults : {}, inheritance.modules.get(key)?.config ?? {});
}

/** On in the bases; a module they never mention is not in the template. Header and conclusion: always. */
export function inheritedInclude(inheritance: Inheritance, key: ModuleKey): boolean {
  if ((ALWAYS_ON_MODULE_KEYS as readonly ModuleKey[]).includes(key)) return true;
  return inheritance.modules.get(key)?.include ?? false;
}
