// Everything that stops a draft from saving, each with the place the editor
// shows it: the definition against TemplateDefinitionSchema, each module's
// config against its own schema (in plain words, lib/zod-form), then what
// only the resolver knows (order_lots, mapsTo, bases). The server action
// resolves again before it writes; these are for the admin, as they type.
import { isModuleKey, type ModuleKey } from "@/lib/schemas/module-result";
import { TemplateDefinitionSchema, type ResolvedTemplate } from "@/lib/schemas/template";
import { resolveTemplate, type TemplateLookup, type TemplateProblem } from "@/lib/templates";
import { getAt, isPlainObject, parseWithMessages, pathKey, type FormPath } from "@/lib/zod-form";
import type { Draft, EditorContext } from "./model";
import { entriesOf, moduleOrder, moduleView, ownCustomModules } from "./model";

export type ProblemPlace =
  /** A module's switch, heading, labels or config; `path` is inside that part. */
  | { area: "module"; moduleKey: ModuleKey; part: "include" | "title" | "labels" | "config" | "entry"; path: FormPath }
  /** One of this template's custom modules, by position; `path` is inside it. */
  | { area: "custom"; index: number; customKey: string; path: FormPath }
  /** Anything else: name, scope, sizes, extends, report (the JSON view). */
  | { area: "template"; path: FormPath };

export type EditorProblem = { id: string; place: ProblemPlace; message: string };

export type ProblemReport = {
  problems: EditorProblem[];
  /** The resolved template when there is no problem; the preview draws it. */
  resolved: ResolvedTemplate | null;
};

/**
 * Text in a field that is not a value yet (half-written JSON), kept while its
 * field is closed: it stops the save, and the field shows it again when it
 * opens. Numbers need none of this: "2 42" is stored as typed, and the
 * module's schema says what is wrong with it.
 */
export type DraftError = { place: ProblemPlace; message: string; text: string };

export function collectProblems(
  draft: Draft,
  context: EditorContext,
  options: { code: string; getBase: TemplateLookup; draftErrors?: readonly DraftError[] },
): ProblemReport {
  const problems: EditorProblem[] = [];
  const add = (place: ProblemPlace, message: string) => {
    const id = `${placeId(place)}:${message}`;
    if (!problems.some((problem) => problem.id === id)) problems.push({ id, place, message });
  };

  for (const error of options.draftErrors ?? []) add(error.place, error.message);

  if (draft.code !== options.code) {
    add({ area: "template", path: ["code"] }, `The code of this version is ${options.code}; it cannot change.`);
  }

  const parsed = parseWithMessages(TemplateDefinitionSchema, draft);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) add(placeOfDefinitionPath(draft, issue.path), issue.message);
  }

  // Each module's config, merged as the resolver merges it, against the module's schema.
  const configFailed = new Set<ModuleKey>();
  for (const key of moduleOrder(draft, context)) {
    const view = moduleView(draft, context, key);
    const result = parseWithMessages(context.registry[key].configSchema, view.config);
    if (result.success) continue;
    configFailed.add(key);
    for (const issue of result.error.issues) {
      add({ area: "module", moduleKey: key, part: "config", path: issue.path.map(segmentOf) }, issue.message);
    }
  }

  const baseMissing = context.inheritance.problems.length > 0;
  for (const message of context.inheritance.problems) add({ area: "template", path: ["extends"] }, message);

  if (!parsed.success) return { problems, resolved: null };

  const resolution = resolveTemplate(draft, { getBase: options.getBase, registry: context.registry });
  if (!resolution.ok) {
    for (const problem of resolution.problems) {
      // Config problems are above, in plainer words.
      if (problem.path[0] === "modules" && problem.path[2] === "config" && configFailed.has(problem.path[1] as ModuleKey)) {
        continue;
      }
      const place = placeOfResolverProblem(draft, problem, options.code);
      // A missing base is said once, above: the resolver finds the same thing.
      if (baseMissing && place.area === "template" && place.path.length === 1 && place.path[0] === "extends") continue;
      add(place, resolverMessage(problem, options.code));
    }
  }
  return { problems, resolved: resolution.ok && problems.length === 0 ? resolution.template : null };
}

function segmentOf(segment: PropertyKey): string | number {
  return typeof segment === "number" ? segment : String(segment);
}

/** TemplateDefinitionSchema paths use list positions: modules[3], customModules[0]. */
function placeOfDefinitionPath(draft: Draft, issuePath: readonly PropertyKey[]): ProblemPlace {
  const path = issuePath.map(segmentOf);
  if (path[0] === "modules" && typeof path[1] === "number") {
    const entry = Array.isArray(draft.modules) ? (draft.modules[path[1]] as { key?: unknown } | undefined) : undefined;
    const key = typeof entry?.key === "string" && isModuleKey(entry.key) ? entry.key : null;
    if (key) return { area: "module", moduleKey: key, part: partOf(path[2]), path: path.slice(3) };
  }
  if (path[0] === "customModules" && typeof path[1] === "number") {
    const custom = ownCustomModules(draft)[path[1]];
    return { area: "custom", index: path[1], customKey: custom?.key ?? String(path[1]), path: path.slice(2) };
  }
  return { area: "template", path };
}

/** The resolver names modules and custom modules by key, and fields by key. */
function placeOfResolverProblem(draft: Draft, problem: TemplateProblem, code: string): ProblemPlace {
  const path = problem.path;
  if (problem.template !== code) return { area: "template", path: ["extends"] };
  if (path[0] === "modules" && typeof path[1] === "string" && isModuleKey(path[1])) {
    return { area: "module", moduleKey: path[1], part: partOf(path[2]), path: path.slice(3) };
  }
  if (path[0] === "customModules" && typeof path[1] === "string") {
    const index = ownCustomModules(draft).findIndex((custom) => custom.key === path[1]);
    if (index !== -1) {
      const custom = ownCustomModules(draft)[index];
      const rest = path.slice(2);
      // ["fields", "<field key>", "mapsTo"] -> ["fields", <position>, "mapsTo"]
      if (rest[0] === "fields" && typeof rest[1] === "string") {
        const position = custom.fields.findIndex((field) => field.key === rest[1]);
        if (position !== -1) return { area: "custom", index, customKey: custom.key, path: ["fields", position, ...rest.slice(2)] };
      }
      return { area: "custom", index, customKey: custom.key, path: rest };
    }
  }
  return { area: "template", path };
}

/**
 * A problem the save action found (results.ts ServerProblem), placed and
 * worded as the problem list does it, so "Not saved" names settings by their
 * labels too. `template` is "" for a definition that did not parse (its path
 * uses list positions), else the template the resolver found it in (paths
 * by key). The browser checks the same things first, so the server finds
 * one only when something changed meanwhile, such as a base.
 */
export function serverProblem(
  draft: Draft,
  problem: Pick<TemplateProblem, "template" | "path" | "message">,
  code: string,
): { place: ProblemPlace; message: string } {
  if (problem.template === "") return { place: placeOfDefinitionPath(draft, problem.path), message: problem.message };
  const found: TemplateProblem = { template: problem.template, path: [...problem.path], message: problem.message };
  return { place: placeOfResolverProblem(draft, found, code), message: resolverMessage(found, code) };
}

function resolverMessage(problem: TemplateProblem, code: string): string {
  return problem.template === code ? problem.message : `In base template ${problem.template}: ${problem.message}`;
}

function partOf(segment: string | number | undefined): "include" | "title" | "labels" | "config" | "entry" {
  return segment === "include" || segment === "title" || segment === "labels" || segment === "config" ? segment : "entry";
}

/**
 * Whether kept field text still has its field: the setting or list item it
 * was typed into is still there. A list item removed while the text was kept
 * takes its text with it.
 */
export function hasDraftPlace(error: DraftError, draft: Draft, context: EditorContext): boolean {
  const { place } = error;
  const parent = place.path.slice(0, -1);
  const holds = (container: unknown) => place.path.length === 0 || isContainer(getAt(container, parent));
  switch (place.area) {
    case "module":
      return place.part !== "config" || holds(moduleView(draft, context, place.moduleKey).config);
    case "custom": {
      const custom = ownCustomModules(draft)[place.index];
      return custom !== undefined && holds(custom);
    }
    case "template":
      return holds(draft);
  }
}

function isContainer(value: unknown): boolean {
  return Array.isArray(value) || isPlainObject(value);
}

export function placeId(place: ProblemPlace): string {
  switch (place.area) {
    case "module":
      return `module:${place.moduleKey}:${place.part}:${pathKey(place.path)}`;
    case "custom":
      return `custom:${place.index}:${pathKey(place.path)}`;
    case "template":
      return `template:${pathKey(place.path)}`;
  }
}

/**
 * A client or manufacturer in the scope that is not among the ones the
 * database has: saving would fail on the reference, so it is a problem here,
 * on the field. (An id that is not a UUID at all is the schema's problem.)
 */
export function scopeProblems(
  draft: Draft,
  options: { clients: readonly { id: string }[]; manufacturers: readonly { id: string }[] },
): EditorProblem[] {
  const scope: Record<string, unknown> = isRecord(draft.scope) ? draft.scope : {};
  const checks = [
    { key: "clientId", list: options.clients, message: "Not one of the clients: choose a client, or Any Client." },
    {
      key: "manufacturerId",
      list: options.manufacturers,
      message: "Not one of the manufacturers: choose a manufacturer, or Any Manufacturer.",
    },
  ] as const;
  return checks.flatMap(({ key, list, message }) => {
    const id = scope[key];
    if (typeof id !== "string" || !UUID.test(id) || list.some((entry) => entry.id === id)) return [];
    const place: ProblemPlace = { area: "template", path: ["scope", key] };
    return [{ id: `${placeId(place)}:${message}`, place, message }];
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------------------ *
 * Problems by where they show
 * ------------------------------------------------------------------ */

export function problemsOfModule(problems: readonly EditorProblem[], key: ModuleKey): EditorProblem[] {
  return problems.filter((problem) => problem.place.area === "module" && problem.place.moduleKey === key);
}

/** Config messages by path, for the module's generated form. */
export function configIssues(problems: readonly EditorProblem[], key: ModuleKey): Map<string, string[]> {
  const issues = new Map<string, string[]>();
  for (const problem of problems) {
    const place = problem.place;
    if (place.area !== "module" || place.moduleKey !== key || place.part !== "config") continue;
    const id = pathKey(place.path);
    issues.set(id, [...(issues.get(id) ?? []), problem.message]);
  }
  return issues;
}

export function problemsOfCustom(problems: readonly EditorProblem[], index: number): EditorProblem[] {
  return problems.filter((problem) => problem.place.area === "custom" && problem.place.index === index);
}

/** Whether the definition is the shape the module list can work on; if not, the JSON view is the way in. */
export function isEditableShape(draft: Draft): boolean {
  return (
    typeof draft === "object" &&
    draft !== null &&
    Array.isArray(draft.modules) &&
    entriesOf(draft).length === draft.modules.length &&
    (draft.customModules === undefined || Array.isArray(draft.customModules))
  );
}
