// Template resolution (BUILD_SPEC 4.2 rules 3, 8 and 9; 4.3). A definition
// and its extends chain become one ResolvedTemplate: every module in final
// order with its effective title, labels and config, custom modules checked
// and carried, sizes in their canonical spelling. The result is stored in
// `templates.resolved` with the version, so it is computed when a version
// is saved, not on every read: a new base version reaches a child when the
// child is saved again. `bases` records the version of each base it was
// built from, so the editor can tell when that is due (staleBases).
//
// Down the chain, root first:
// - include, title: the nearest template that sets them wins;
// - labels: merged key by key, the module's defaults underneath;
// - config: merged as lib/templates/merge.ts describes, over the module's
//   default config, then validated by the module's config schema;
// - order: lib/templates/module-order.ts; header first, conclusion last,
//   both always included (4.1); order_lots on whenever a per-size module is;
// - custom modules: inherited; a child's custom module with the same key
//   replaces the base's in place.
// Scope, unit, sizes, name and source file are the template's own; the
// report and AI settings are inherited when a child has none (the AI
// settings stay out of the result when no template in the chain sets them).
import { ALWAYS_ON_MODULE_KEYS, type ModuleKey } from "@/lib/schemas/module-result";
import {
  RESOLVED_TEMPLATE_FORMAT,
  ResolvedTemplateSchema,
  TemplateDefinitionSchema,
  type CustomModule,
  type ResolvedModule,
  type ResolvedTemplate,
  type TemplateDefinition,
} from "@/lib/schemas/template";
import { normaliseSize } from "@/lib/sizes";
import type { ModuleRegistry } from "@/modules/_framework/contract";
import { findCanonicalPath, isMappableType, parseCanonicalPath } from "@/modules/_framework/paths";
import { isJsonObject, mergeConfig, type JsonObject } from "./merge";
import { applyListedOrder, pinEnds } from "./module-order";

/** A chain longer than this is almost certainly a mistake. */
export const MAX_EXTENDS_DEPTH = 10;

export type TemplateProblem = {
  /** Code of the template the problem is in (the one resolved, or a base). */
  template: string;
  /** Inside that definition. Module paths use the module key: ["modules", "weight", "config", "n"]. */
  path: (string | number)[];
  message: string;
};

export type TemplateResolution =
  | { ok: true; template: ResolvedTemplate }
  | { ok: false; problems: TemplateProblem[] };

/** A base template: one version's definition (usually the active version) and its number. */
export type TemplateBase = { definition: unknown; version: number };

/** A base template by code, or undefined when there is none. */
export type TemplateLookup = (code: string) => TemplateBase | null | undefined;

export type ResolveOptions = {
  getBase: TemplateLookup;
  /** modules/registry.ts in the app; a test registry in tests. */
  registry: ModuleRegistry;
};

/** `version` is null for the template being resolved: its row holds its version. */
type ChainEntry = { code: string; version: number | null; definition: TemplateDefinition };

type MergedModule = {
  key: ModuleKey;
  include: boolean;
  title?: string;
  labels: Record<string, string>;
  config: JsonObject;
};

export function resolveTemplate(definition: unknown, { getBase, registry }: ResolveOptions): TemplateResolution {
  const chain = loadChain(definition, getBase);
  if (!chain.ok) return chain;
  const leafFirst = chain.entries;
  const leaf = leafFirst[0].definition;
  const rootFirst = [...leafFirst].reverse();
  const problems: TemplateProblem[] = [];
  const problem = (path: TemplateProblem["path"], message: string) =>
    problems.push({ template: leaf.code, path, message });

  const merged = mergeModules(rootFirst);
  const modules = merged.order.flatMap((key) => {
    const entry = merged.entries.get(key);
    return entry ? [effectiveModule(entry, registry, problem)] : [];
  });
  checkSizeSource(modules, registry, problem);
  const customModules = mergeCustomModules(rootFirst);
  checkCustomModules(customModules, modules, registry, problem);

  const template: ResolvedTemplate = {
    format: RESOLVED_TEMPLATE_FORMAT,
    code: leaf.code,
    name: leaf.name,
    chain: leafFirst.map((entry) => entry.code),
    bases: leafFirst.slice(1).flatMap(({ code, version }) => (version === null ? [] : [{ code, version }])),
    scope: leaf.scope,
    unit: leaf.unit,
    sizes: leaf.sizes.map((size) => {
      const value = normaliseSize(size.value) ?? size.value;
      return { value, label: size.label ?? value };
    }),
    modules,
    customModules,
    report: leafFirst.find((entry) => entry.definition.report)?.definition.report ?? {
      title: leaf.name,
      showClientLogo: false,
    },
    ...aiSettingsOf(leafFirst),
    sourceFile: leaf.sourceFile ?? null,
  };
  if (problems.length > 0) return { ok: false, problems };

  const checked = ResolvedTemplateSchema.safeParse(template);
  if (!checked.success) {
    return {
      ok: false,
      problems: checked.error.issues.map((issue) => ({
        template: leaf.code,
        path: issue.path.map(String),
        message: `Resolved template is invalid: ${issue.message}`,
      })),
    };
  }
  return { ok: true, template: checked.data };
}

/** For seeds and tests: the resolved template, or an error listing every problem. */
export function resolveTemplateOrThrow(definition: unknown, options: ResolveOptions): ResolvedTemplate {
  const resolution = resolveTemplate(definition, options);
  if (resolution.ok) return resolution.template;
  const lines = resolution.problems.map(
    (problem) => `${problem.template} ${problem.path.join(".") || "(root)"}: ${problem.message}`,
  );
  throw new Error(`Template does not resolve:\n${lines.join("\n")}`);
}

/** A lookup over template versions held in memory, by code; a later entry for a code replaces an earlier one. */
export function lookupFrom(templates: readonly TemplateBase[]): TemplateLookup {
  const byCode = new Map<string, TemplateBase>();
  for (const template of templates) {
    const code = codeOf(template.definition);
    if (code !== null) byCode.set(code, template);
  }
  return (code) => byCode.get(code);
}

/** The definition and its bases, leaf first. Stops at the first problem. */
function loadChain(
  definition: unknown,
  getBase: TemplateLookup,
): { ok: true; entries: ChainEntry[] } | { ok: false; problems: TemplateProblem[] } {
  const entries: ChainEntry[] = [];
  let current = definition;
  let version: number | null = null;
  let requested: string | null = null;

  for (;;) {
    const label = requested ?? codeOf(current) ?? "(new template)";
    const parsed = TemplateDefinitionSchema.safeParse(current);
    if (!parsed.success) {
      return {
        ok: false,
        problems: parsed.error.issues.map((issue) => ({
          template: label,
          path: issue.path.map((segment) => (typeof segment === "number" ? segment : String(segment))),
          message: issue.message,
        })),
      };
    }
    const found = parsed.data;
    const fail = (message: string, path: TemplateProblem["path"] = ["extends"]) => ({
      ok: false as const,
      problems: [{ template: found.code, path, message }],
    });
    if (requested !== null && found.code !== requested) {
      return fail(`Looked up base template ${requested} but got ${found.code}.`, ["code"]);
    }
    if (entries.some((entry) => entry.code === found.code)) {
      const loop = [...entries.map((entry) => entry.code), found.code].join(" -> ");
      return fail(`Templates extend each other in a loop: ${loop}.`);
    }
    entries.push({ code: found.code, version, definition: found });
    if (found.extends === undefined) return { ok: true, entries };
    if (entries.length >= MAX_EXTENDS_DEPTH) {
      return fail(`More than ${MAX_EXTENDS_DEPTH} templates in the extends chain.`);
    }
    const base = getBase(found.extends);
    if (base === undefined || base === null) {
      return fail(`Base template ${found.extends} was not found.`);
    }
    if (!Number.isInteger(base.version) || base.version < 1) {
      return fail(`Base template ${found.extends} came without a valid version number.`);
    }
    current = base.definition;
    version = base.version;
    requested = found.extends;
  }
}

function mergeModules(rootFirst: readonly ChainEntry[]): { order: ModuleKey[]; entries: Map<ModuleKey, MergedModule> } {
  let order: ModuleKey[] = [];
  const entries = new Map<ModuleKey, MergedModule>();
  for (const { definition } of rootFirst) {
    order = applyListedOrder(
      order,
      definition.modules.map((module) => module.key),
    );
    for (const entry of definition.modules) {
      const base = entries.get(entry.key);
      entries.set(entry.key, {
        key: entry.key,
        include: entry.include,
        title: entry.title ?? base?.title,
        labels: { ...base?.labels, ...entry.labels },
        config: mergeConfig(base?.config ?? {}, entry.config ?? {}),
      });
    }
  }
  for (const key of ALWAYS_ON_MODULE_KEYS) {
    if (!entries.has(key)) {
      entries.set(key, { key, include: true, labels: {}, config: {} });
      order.push(key);
    }
  }
  return { order: pinEnds(order, "header", "conclusion"), entries };
}

function effectiveModule(
  entry: MergedModule,
  registry: ModuleRegistry,
  problem: (path: TemplateProblem["path"], message: string) => void,
): ResolvedModule {
  const definition = registry[entry.key];
  const defaults = isJsonObject(definition.defaultConfig) ? definition.defaultConfig : {};
  const merged = mergeConfig(defaults, entry.config);
  const parsed = definition.configSchema.safeParse(merged);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problem(["modules", entry.key, "config", ...issue.path.map(String)], issue.message);
    }
  }
  return {
    key: entry.key,
    include: entry.include,
    title: entry.title ?? definition.title,
    labels: { ...definition.labels, ...entry.labels },
    config: parsed.success && isJsonObject(parsed.data) ? parsed.data : merged,
  };
}

/** Per-size modules show only the sizes in order_lots (6.2 rule 4): without it they could never be done. */
function checkSizeSource(
  modules: readonly ResolvedModule[],
  registry: ModuleRegistry,
  problem: (path: TemplateProblem["path"], message: string) => void,
): void {
  const perSize = modules.filter((entry) => entry.include && registry[entry.key].perSize).map((entry) => entry.key);
  const orderLots = modules.find((entry) => entry.key === "order_lots");
  if (perSize.length > 0 && !orderLots?.include) {
    problem(
      ["modules", "order_lots", "include"],
      `${perSize.join(", ")} show only the sizes ordered in order_lots, so order_lots must be on.`,
    );
  }
}

function mergeCustomModules(rootFirst: readonly ChainEntry[]): CustomModule[] {
  const byKey = new Map<string, CustomModule>();
  for (const { definition } of rootFirst) {
    for (const custom of definition.customModules ?? []) byKey.set(custom.key, custom);
  }
  return [...byKey.values()];
}

function checkCustomModules(
  customModules: readonly CustomModule[],
  modules: readonly ResolvedModule[],
  registry: ModuleRegistry,
  problem: (path: TemplateProblem["path"], message: string) => void,
): void {
  const byKey = new Map(modules.map((module) => [module.key, module]));
  const mapped = new Map<string, string>();

  for (const custom of customModules) {
    if (!byKey.has(custom.after)) {
      problem(["customModules", custom.key, "after"], `${custom.after} is not a module of this template.`);
    }
    custom.fields.forEach((field) => {
      if (field.mapsTo === undefined) return;
      const path = ["customModules", custom.key, "fields", field.key, "mapsTo"];
      const target = parseCanonicalPath(field.mapsTo);
      const targetModule = target ? byKey.get(target.moduleKey) : undefined;
      if (!target || !targetModule) {
        problem(path, `${field.mapsTo} points at a module this template does not have.`);
        return;
      }
      if (!targetModule.include) {
        problem(path, `${field.mapsTo} points at ${target.moduleKey}, which this template switches off.`);
        return;
      }
      const found = findCanonicalPath(registry, field.mapsTo);
      if (!found) {
        const declared = registry[target.moduleKey].canonicalPaths.map((entry) => entry.path);
        problem(
          path,
          declared.length > 0
            ? `${target.moduleKey} has no field ${target.segments.join(".")}. It accepts: ${declared.join(", ")}.`
            : `${target.moduleKey} has no fields a custom field can map to.`,
        );
        return;
      }
      if (!isMappableType(field.type, found.canonical.type)) {
        problem(path, `A ${field.type} field cannot hold ${field.mapsTo}, which is ${found.canonical.type}.`);
      }
      if (field.unit && found.canonical.unit && field.unit !== found.canonical.unit) {
        problem(path, `${field.mapsTo} is in ${found.canonical.unit}, not ${field.unit}.`);
      }
      const first = mapped.get(field.mapsTo);
      if (first) problem(path, `${field.mapsTo} is already mapped by ${first}: a value is entered once.`);
      else mapped.set(field.mapsTo, `${custom.key}.${field.key}`);
    });
  }
}

/**
 * The AI settings of the nearest template that sets them (BUILD_SPEC 9.2).
 * None when no template in the chain does: off, and a resolution stays as
 * it was before the setting existed.
 */
function aiSettingsOf(leafFirst: readonly ChainEntry[]): Pick<ResolvedTemplate, "ai"> {
  const ai = leafFirst.find((entry) => entry.definition.ai)?.definition.ai;
  return ai ? { ai } : {};
}

function codeOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}
