// Edits to a template definition (BUILD_SPEC 4.3), as the editor makes them.
// Each takes the definition and returns a new one, changed as little as it
// can: a template that extends another keeps listing only what differs
// (4.2 rule 9), and a definition opened and saved untouched comes back the
// same. lib/templates resolves the result; nothing here decides validity.
import { ALWAYS_ON_MODULE_KEYS, isModuleKey, MODULE_KEYS, type ModuleKey } from "@/lib/schemas/module-result";
import type { CustomModule, ModuleConfig, TemplateDefinitionInput } from "@/lib/schemas/template";
import { isJsonObject, isTagged, mergeConfig, type JsonObject } from "@/lib/templates";
import { deepEqual, getAt, moveItem, setAt, type FormPath } from "@/lib/zod-form";
import type { ModuleRegistry } from "@/modules/_framework";
import {
  finalOrder,
  inheritedConfig,
  inheritedInclude,
  inheritedLabels,
  inheritedTitle,
  type Inheritance,
} from "./inheritance";

/** A definition as the editor holds it: valid or not yet. */
export type Draft = TemplateDefinitionInput;

export type EditorContext = { inheritance: Inheritance; registry: ModuleRegistry };

const ALWAYS_ON: ReadonlySet<ModuleKey> = new Set(ALWAYS_ON_MODULE_KEYS);

export function isAlwaysOn(key: ModuleKey): boolean {
  return ALWAYS_ON.has(key);
}

/** The module entries a draft lists, skipping anything that is not one (the JSON view can write anything). */
export function entriesOf(draft: Draft): ModuleConfig[] {
  return Array.isArray(draft.modules)
    ? draft.modules.filter((entry): entry is ModuleConfig => isJsonObject(entry) && isModuleKey(String(entry.key)))
    : [];
}

export function entryOf(draft: Draft, key: ModuleKey): ModuleConfig | undefined {
  return entriesOf(draft).find((entry) => entry.key === key);
}

/** Every module the template or its bases mention, in final order: header first, conclusion last. */
export function moduleOrder(draft: Draft, { inheritance }: EditorContext): ModuleKey[] {
  return finalOrder(
    inheritance.order,
    entriesOf(draft).map((entry) => entry.key),
  );
}

/** Modules neither the template nor its bases mention: they can be added. */
export function unusedModules(draft: Draft, context: EditorContext): ModuleKey[] {
  const used = new Set(moduleOrder(draft, context));
  return MODULE_KEYS.filter((key) => !used.has(key));
}

/** A module as the template shows it, and what it would be without this template's own changes. */
export type ModuleView = {
  key: ModuleKey;
  include: boolean;
  title: string;
  labels: Readonly<Record<string, string>>;
  config: JsonObject;
  entry: ModuleConfig | undefined;
  inherited: {
    include: boolean;
    title: string;
    labels: Readonly<Record<string, string>>;
    config: JsonObject;
  };
  /** The template sets its own heading, labels or config for it. */
  changed: boolean;
};

export function moduleView(draft: Draft, context: EditorContext, key: ModuleKey): ModuleView {
  const { inheritance, registry } = context;
  const entry = entryOf(draft, key);
  const inherited = {
    include: inheritedInclude(inheritance, key),
    title: inheritedTitle(inheritance, registry, key),
    labels: inheritedLabels(inheritance, registry, key),
    config: inheritedConfig(inheritance, registry, key),
  };
  const ownConfig = isJsonObject(entry?.config) ? entry.config : {};
  return {
    key,
    include: isAlwaysOn(key) ? true : (entry?.include ?? inherited.include),
    title: entry?.title?.trim() ? entry.title : inherited.title,
    labels: { ...inherited.labels, ...entry?.labels },
    config: mergeConfig(inherited.config, ownConfig),
    entry,
    inherited,
    changed: Boolean(entry?.title) || Object.keys(entry?.labels ?? {}).length > 0 || Object.keys(ownConfig).length > 0,
  };
}

/* ------------------------------------------------------------------ *
 * Listing: which modules the template names, and in what order
 * ------------------------------------------------------------------ */

/**
 * The modules a template must list, in order, for the resolver to give
 * `desired` (lib/templates/module-order.ts): `required`, then whatever else
 * it takes. At the first place the result goes wrong, the module found there
 * comes too early: unlisted, it gets listed so it moves after the module
 * listed before it; listed, the module it must follow gets listed too
 * ("to move a module later, list the module it must follow, then it").
 * Listing every module always works; most edits need far less.
 */
export function listingFor(
  baseOrder: readonly ModuleKey[],
  desired: readonly ModuleKey[],
  required: Iterable<ModuleKey>,
): ModuleKey[] {
  const listed = new Set(required);
  for (let attempt = 0; attempt <= desired.length + 1; attempt += 1) {
    const listing = desired.filter((key) => listed.has(key));
    const result = finalOrder(baseOrder, listing);
    const mismatch = desired.findIndex((key, index) => result[index] !== key);
    if (mismatch === -1 && result.length === desired.length) return listing;
    if (mismatch === -1) break;
    const early = result[mismatch];
    const follows = desired[desired.indexOf(early) - 1];
    const candidate = [early, follows, desired[mismatch]].find((key) => key !== undefined && !listed.has(key));
    if (candidate === undefined) break;
    listed.add(candidate);
  }
  return [...desired];
}

/**
 * The draft listing its modules so that they come out in `desired` order,
 * every module in `required` listed. A module listed for the first time is
 * written with its current include, so nothing else about it changes.
 */
function relist(draft: Draft, context: EditorContext, desired: readonly ModuleKey[], required: Iterable<ModuleKey>): Draft {
  const listing = listingFor(context.inheritance.order, desired, required);
  const existing = new Map(entriesOf(draft).map((entry) => [entry.key, entry]));
  const modules = listing.map(
    (key) => existing.get(key) ?? { key, include: moduleView(draft, context, key).include },
  );
  return { ...draft, modules };
}

/** The draft with `key` listed (added in place if it was not) and its entry changed by `update`. */
function withEntry(draft: Draft, context: EditorContext, key: ModuleKey, update: (entry: ModuleConfig) => ModuleConfig): Draft {
  let next = draft;
  if (!entryOf(draft, key)) {
    const order = moduleOrder(draft, context);
    const desired = order.includes(key) ? order : insertBeforeConclusion(order, key);
    next = relist(draft, context, desired, [...entriesOf(draft).map((entry) => entry.key), key]);
  }
  return {
    ...next,
    modules: entriesOf(next).map((entry) => (entry.key === key ? tidyEntry(update(entry)) : entry)),
  };
}

function insertBeforeConclusion(order: readonly ModuleKey[], key: ModuleKey): ModuleKey[] {
  const at = order.indexOf("conclusion");
  const next = [...order];
  next.splice(at === -1 ? next.length : at, 0, key);
  return next;
}

/** Drops empty overrides, so a cleared label leaves no `labels: {}` behind. */
function tidyEntry(entry: ModuleConfig): ModuleConfig {
  const { title, labels, config, ...rest } = entry;
  return {
    ...rest,
    ...(title !== undefined && title.trim() !== "" ? { title } : {}),
    ...(labels && Object.keys(labels).length > 0 ? { labels } : {}),
    ...(config && Object.keys(config).length > 0 ? { config } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * Module edits
 * ------------------------------------------------------------------ */

/** Switches a module on or off. Header and conclusion stay on (4.1). */
export function setInclude(draft: Draft, context: EditorContext, key: ModuleKey, include: boolean): Draft {
  if (isAlwaysOn(key)) return draft;
  return withEntry(draft, context, key, (entry) => ({ ...entry, include }));
}

/** Adds a module the template and its bases never mention, switched on, just before the conclusion. */
export function addModule(draft: Draft, context: EditorContext, key: ModuleKey): Draft {
  return withEntry(draft, context, key, (entry) => ({ ...entry, include: true }));
}

/**
 * The heading in the source's wording; empty uses the inherited one. Text the
 * same as the inherited heading still counts as the template's own (it is
 * being typed, and it pins the wording).
 */
export function setTitle(draft: Draft, context: EditorContext, key: ModuleKey, title: string): Draft {
  const value = title.trim() === "" ? undefined : title;
  if (value === undefined && !entryOf(draft, key)?.title) return draft;
  return withEntry(draft, context, key, (entry) => ({ ...entry, title: value }));
}

/** A label override; empty removes it, so the inherited wording shows again. */
export function setLabel(
  draft: Draft,
  context: EditorContext,
  key: ModuleKey,
  labelKey: string,
  label: string | undefined,
): Draft {
  const value = label === undefined || label.trim() === "" ? undefined : label;
  if (value === undefined && entryOf(draft, key)?.labels?.[labelKey] === undefined) return draft;
  return withEntry(draft, context, key, (entry) => {
    const labels = { ...entry.labels };
    if (value === undefined) delete labels[labelKey];
    else labels[labelKey] = value;
    return { ...entry, labels };
  });
}

/** Takes the whole config as the form shows it and keeps only what this template sets. */
export function setConfig(draft: Draft, context: EditorContext, key: ModuleKey, next: unknown): Draft {
  const view = moduleView(draft, context, key);
  const target = isJsonObject(next) ? next : {};
  const previous = isJsonObject(view.entry?.config) ? view.entry.config : {};
  const own = diffConfig(view.inherited.config, target, previous);
  if (Object.keys(own).length === 0 && !view.entry?.config) return draft;
  return withEntry(draft, context, key, (entry) => ({ ...entry, config: own }));
}

/** Back to the inherited value at a path of the config: the template stops setting it. */
export function resetConfigAt(draft: Draft, context: EditorContext, key: ModuleKey, path: FormPath): Draft {
  const entry = entryOf(draft, key);
  if (!entry?.config || getAt(entry.config, path) === undefined) return draft;
  const own = pruneEmpty(setAt(entry.config, path, undefined) as JsonObject);
  return withEntry(draft, context, key, (current) => ({ ...current, config: own }));
}

/** Whether this template sets the config value at a path itself. */
export function isConfigOverridden(draft: Draft, key: ModuleKey, path: FormPath): boolean {
  const config = entryOf(draft, key)?.config;
  return config !== undefined && getAt(config, path) !== undefined;
}

/**
 * Whether an optional setting or a record entry can be taken out of the
 * config: not when the template inherits it, since a merge can change a
 * key but never remove one. Inside a list or a tagged value it can, as the
 * template replaces those whole.
 */
export function canRemoveConfigAt(inherited: JsonObject, path: FormPath): boolean {
  let current: unknown = inherited;
  for (const segment of path) {
    if (Array.isArray(current) || (isJsonObject(current) && isTagged(current))) return true;
    current = isJsonObject(current) && typeof segment === "string" ? current[segment] : undefined;
    if (current === undefined) return true;
  }
  return false;
}

/** The template's heading, labels and config for a module go; it keeps its place and its switch. */
export function resetModule(draft: Draft, key: ModuleKey): Draft {
  const entry = entryOf(draft, key);
  if (!entry) return draft;
  return {
    ...draft,
    modules: entriesOf(draft).map((current) => (current.key === key ? { key: current.key, include: current.include } : current)),
  };
}

/**
 * Moves a module to a position in the final order. Header stays first and
 * conclusion last; everything else moves between them.
 */
export function moveModule(draft: Draft, context: EditorContext, key: ModuleKey, to: number): Draft {
  if (isAlwaysOn(key)) return draft;
  const order = moduleOrder(draft, context);
  const from = order.indexOf(key);
  if (from === -1) return draft;
  const first = order[0] === "header" ? 1 : 0;
  const last = order.at(-1) === "conclusion" ? order.length - 2 : order.length - 1;
  const target = Math.min(Math.max(to, first), last);
  if (target === from) return draft;
  const desired = moveItem(order, from, target);
  return relist(draft, context, desired, [...entriesOf(draft).map((entry) => entry.key), key]);
}

/* ------------------------------------------------------------------ *
 * Config: what a template writes
 * ------------------------------------------------------------------ */

function isMergeable(value: unknown): value is JsonObject {
  return isJsonObject(value) && !isTagged(value);
}

/**
 * What the template writes for a module's config: the values that differ
 * from what it inherits, objects down to the changed keys, lists and tagged
 * values (a spec) whole, as lib/templates/merge.ts merges them. A value the
 * template already set (`previous`) stays set even when it now equals the
 * inherited one: only a reset lets go of it. Merging the result over
 * `inherited` gives `next` back whenever `next` keeps every inherited key.
 */
export function diffConfig(inherited: JsonObject, next: JsonObject, previous: JsonObject = {}): JsonObject {
  const own: JsonObject = {};
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue;
    const base = inherited[key];
    const before = previous[key];
    if (isMergeable(value) && isMergeable(base)) {
      const nested = diffConfig(base, value, isMergeable(before) ? before : {});
      if (Object.keys(nested).length > 0) own[key] = nested;
      continue;
    }
    if (base === undefined || before !== undefined || !deepEqual(base, value)) own[key] = value;
  }
  return own;
}

function pruneEmpty(value: JsonObject): JsonObject {
  const pruned: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isMergeable(entry)) {
      const inner = pruneEmpty(entry);
      if (Object.keys(inner).length > 0) pruned[key] = inner;
    } else if (entry !== undefined) {
      pruned[key] = entry;
    }
  }
  return pruned;
}

/* ------------------------------------------------------------------ *
 * Custom modules
 * ------------------------------------------------------------------ */

export function ownCustomModules(draft: Draft): CustomModule[] {
  return Array.isArray(draft.customModules) ? (draft.customModules as CustomModule[]) : [];
}

/** This template's custom modules and the ones it inherits, a child's replacing a base's with the same key. */
export function customModuleViews(
  draft: Draft,
  context: EditorContext,
): { custom: CustomModule; own: boolean; index: number; overrides: boolean }[] {
  const own = ownCustomModules(draft);
  const inherited = context.inheritance.customModules;
  const ownKeys = new Set(own.map((entry) => entry.key));
  return [
    ...inherited
      .filter((entry) => !ownKeys.has(entry.key))
      .map((custom) => ({ custom, own: false, index: -1, overrides: false })),
    ...own.map((custom, index) => ({
      custom,
      own: true,
      index,
      overrides: inherited.some((entry) => entry.key === custom.key),
    })),
  ];
}

export function setCustomModule(draft: Draft, index: number, next: CustomModule): Draft {
  const own = ownCustomModules(draft);
  if (index < 0 || index >= own.length) return draft;
  return { ...draft, customModules: own.map((entry, position) => (position === index ? next : entry)) };
}

export function removeCustomModule(draft: Draft, index: number): Draft {
  const own = ownCustomModules(draft);
  if (index < 0 || index >= own.length) return draft;
  const rest = own.filter((_, position) => position !== index);
  if (rest.length > 0) return { ...draft, customModules: rest };
  const without = { ...draft };
  delete without.customModules;
  return without;
}

/** A new custom module: one text field, after the last module before the conclusion. */
export function addCustomModule(draft: Draft, context: EditorContext): { draft: Draft; index: number } {
  const own = ownCustomModules(draft);
  const taken = new Set([...own, ...context.inheritance.customModules].map((entry) => entry.key));
  let number = own.length + 1;
  while (taken.has(`custom_${number}`)) number += 1;
  const order = moduleOrder(draft, context).filter((key) => moduleView(draft, context, key).include);
  const after = order.filter((key) => key !== "conclusion").at(-1) ?? "header";
  const custom: CustomModule = {
    key: `custom_${number}`,
    title: "New Section",
    after,
    layout: "fields",
    fields: [{ key: "field1", label: "New Field", type: "text" }],
  };
  return { draft: { ...draft, customModules: [...own, custom] }, index: own.length };
}

/** Copies an inherited custom module into this template, to change it here. */
export function overrideCustomModule(draft: Draft, custom: CustomModule): { draft: Draft; index: number } {
  const own = ownCustomModules(draft);
  return { draft: { ...draft, customModules: [...own, structuredClone(custom)] }, index: own.length };
}
