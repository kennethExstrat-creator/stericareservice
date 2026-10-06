// Seed template definitions (BUILD_SPEC 4.3 and 11) built from the data
// dictionary (lib/coverage), which is authoritative for module keys, order,
// titles, wording, config, specs, defect lists and row counts. This file only
// puts the dictionary's values into the shape TemplateDefinitionSchema
// validates; it adds no value of its own.
//
// A root template (STD_EG, STD_SG) lists every module it switches on, in
// capture order, with its title, the labels that differ from the module's
// defaults and its whole config. A child (SAFEDON_EG) lists only what differs
// from its base (BUILD_SPEC 4.2 rule 9): modules whose title, wording or
// config changes, with the config diff the framework merges over the base
// (docs/MODULES.md section 6); modules the base lacks, whole; and the base's
// modules it drops, switched off where the module that replaces them sits.
import {
  configEqual,
  seedModuleConfigs,
  TEMPLATES,
  type CustomModuleSpec,
  type TemplateCode,
  type TemplateSpec,
} from "@/lib/coverage";
import type { ModuleKey } from "@/lib/schemas/module-result";
import {
  TemplateDefinitionSchema,
  type CustomModule,
  type ModuleConfig,
  type TemplateDefinition,
  type TemplateReport,
} from "@/lib/schemas/template";

/** BUILD_SPEC 4.3 `report.title` is one string; the dictionary keeps the report's title lines (decision 13). */
export const REPORT_TITLE_SEPARATOR = ": ";

/** The definition of one seed template, validated. `clientId` scopes a client template (SAFEDON_EG). */
export function definitionFromCoverage(code: TemplateCode, options: { clientId?: string } = {}): TemplateDefinition {
  const spec = TEMPLATES[code];
  const base = spec.extends === null ? null : TEMPLATES[spec.extends];
  if (options.clientId !== undefined && !spec.scope.clientScoped) {
    throw new Error(`${code} is not scoped to a client: it takes no client id.`);
  }

  const definition = {
    code: spec.code,
    name: spec.name,
    ...(spec.extends === null ? {} : { extends: spec.extends }),
    scope: {
      productType: spec.scope.productType,
      standard: spec.scope.standard,
      ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    },
    unit: spec.unit,
    sizes: spec.sizes.map((size) => ({ value: size.value, ...(size.label ? { label: size.label } : {}) })),
    modules: base === null ? rootModules(code) : childModules(code, base),
    ...customModulesOf(spec, base),
    ...reportOf(spec, base),
  };
  // A plain JSON copy, so nothing readonly or shared with lib/coverage leaks into the definition.
  return TemplateDefinitionSchema.parse(JSON.parse(JSON.stringify(definition)));
}

/* ------------------------------------------------------------------ *
 * Modules
 * ------------------------------------------------------------------ */

type SeedModule = ReturnType<typeof seedModuleConfigs>[number];

function toModuleConfig(entry: SeedModule): ModuleConfig {
  const labels = Object.keys(entry.labels).length > 0 ? { labels: entry.labels } : {};
  const config = Object.keys(entry.config).length > 0 ? { config: entry.config as ModuleConfig["config"] } : {};
  return { key: entry.key, include: true, title: entry.title, ...labels, ...config };
}

/** Every module the template switches on, in capture order, with its title, wording and whole config. */
function rootModules(code: TemplateCode): ModuleConfig[] {
  return seedModuleConfigs(code).map(toModuleConfig);
}

/**
 * What a child changes, in its own order. Its modules come from
 * seedModuleConfigs (config already the diff against the base); a base module
 * it does not have is switched off just before the next base module it keeps,
 * which puts it after the module that replaces it (tensile instead of
 * force_at_break). An entry that changes nothing is left out, unless the next
 * entry is a module the base lacks: that one is placed after the entry before
 * it (lib/templates/module-order.ts), so the entry must stay.
 */
function childModules(code: TemplateCode, base: TemplateSpec): ModuleConfig[] {
  const own = seedModuleConfigs(code);
  const ownKeys = new Set<ModuleKey>(own.map((entry) => entry.key));
  const baseKeys = base.modules.map((entry) => entry.key);
  const baseTitles = new Map(seedModuleConfigs(base.code).map((entry) => [entry.key, entry.title]));
  const baseLabels = new Map(seedModuleConfigs(base.code).map((entry) => [entry.key, entry.labels]));

  type Listed = { entry: ModuleConfig; changes: boolean; added: boolean };
  const listed: Listed[] = [];
  for (const entry of own) {
    const added = !baseKeys.includes(entry.key);
    if (added) {
      listed.push({ entry: toModuleConfig(entry), changes: true, added });
      continue;
    }
    const inherited = baseLabels.get(entry.key) ?? {};
    const labels = Object.fromEntries(Object.entries(entry.labels).filter(([key, label]) => inherited[key] !== label));
    const titleChanges = entry.title !== baseTitles.get(entry.key);
    const config = entry.config;
    const changes = titleChanges || Object.keys(labels).length > 0 || Object.keys(config).length > 0;
    listed.push({
      entry: {
        key: entry.key,
        include: true,
        ...(titleChanges ? { title: entry.title } : {}),
        ...(Object.keys(labels).length > 0 ? { labels } : {}),
        ...(Object.keys(config).length > 0 ? { config: config as ModuleConfig["config"] } : {}),
      },
      changes,
      added,
    });
  }

  // Base modules the child drops: off, just before the next base module the child keeps.
  for (const [index, key] of baseKeys.entries()) {
    if (ownKeys.has(key)) continue;
    const nextKept = baseKeys.slice(index + 1).find((candidate) => ownKeys.has(candidate));
    const at = nextKept === undefined ? listed.length : listed.findIndex((item) => item.entry.key === nextKept);
    listed.splice(at, 0, { entry: { key, include: false }, changes: true, added: false });
  }

  return listed
    .filter((item, index) => item.changes || listed[index + 1]?.added === true)
    .map((item) => item.entry);
}

/* ------------------------------------------------------------------ *
 * Custom modules and report settings
 * ------------------------------------------------------------------ */

function toCustomModule(spec: CustomModuleSpec): CustomModule {
  return {
    key: spec.key,
    title: spec.title,
    after: spec.after,
    layout: spec.layout,
    fields: spec.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      ...(field.hint ? { hint: field.hint } : {}),
    })),
  };
}

/** A root's custom modules; a child's only where they differ from the base's (same key replaces, BUILD_SPEC 4.3). */
function customModulesOf(spec: TemplateSpec, base: TemplateSpec | null): { customModules?: CustomModule[] } {
  const inherited = new Map((base?.customModules ?? []).map((custom) => [custom.key, custom]));
  const own = spec.customModules.filter((custom) => {
    const same = inherited.get(custom.key);
    return same === undefined || !configEqual(JSON.parse(JSON.stringify(same)), JSON.parse(JSON.stringify(custom)));
  });
  return own.length > 0 ? { customModules: own.map(toCustomModule) } : {};
}

function reportSettings(spec: TemplateSpec): TemplateReport | null {
  if (spec.report.titleLines === null) return null;
  return { title: spec.report.titleLines.join(REPORT_TITLE_SEPARATOR), showClientLogo: spec.report.showClientLogo };
}

/**
 * The report title and client logo. A template whose title is still to
 * confirm (STD_SG) sets none, and the resolver falls back to its name; a
 * child with its base's settings inherits them.
 */
function reportOf(spec: TemplateSpec, base: TemplateSpec | null): { report?: TemplateReport } {
  const own = reportSettings(spec);
  if (own === null) return {};
  const inherited = base === null ? null : reportSettings(base);
  return inherited !== null && configEqual(inherited, own) ? {} : { report: own };
}
