// What the editor calls each place a problem can be (BUILD_SPEC 6.2: "list
// each problem with a link"): the problem list names a place by the labels
// the admin sees on the way there, never by schema keys. A module's settings
// as its form names them (settings.ts), a custom module's parts as its form
// does (the labels below, which custom-module-form.tsx shows), the Details
// tab's fields as that tab does (details.ts).
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { CustomModule } from "@/lib/schemas/template";
import { humanize, pathLabels, type FormPath, type KeyOption } from "@/lib/zod-form";
import { detailPathLabels, isDetailPath } from "./details";
import { moduleView, ownCustomModules, type Draft, type EditorContext } from "./model";
import type { ProblemPlace } from "./problems";
import { configNodeOf, settingNaming } from "./settings";

/** The parts of a module's details panel (module-details.tsx). */
export const MODULE_PART_LABELS = {
  include: "Include This Module",
  title: "Heading",
  labels: "Labels",
  config: "Settings",
  entry: "Entry",
} as const;

/** A custom module's own fields (custom-module-form.tsx). */
export const CUSTOM_MODULE_LABELS = {
  title: "Title",
  key: "Key",
  after: "Comes After",
  layout: "Layout",
  grid: "Repeated Columns",
  fields: "Fields",
} as const;

/** The repeated columns of a grid (custom-module-form.tsx). */
export const CUSTOM_GRID_LABELS = {
  label: "Column Heading",
  default: "Columns to Start With",
  addable: "The Inspector Can Add Columns",
  repeatPer: "One Grid for Each Ordered Size",
} as const;

/** One field of a custom module (custom-module-form.tsx). */
export const CUSTOM_FIELD_LABELS = {
  label: "Label",
  key: "Key",
  type: "Type",
  unit: "Unit",
  min: "Lowest Value",
  max: "Highest Value",
  options: "Options, One per Line",
  hint: "Hint",
  mapsTo: "Shows a Module's Value",
  required: "Required Before Submit",
} as const;

/** A custom field as its form heads it: "2. Cuff length", or "Field 2" before it has a label. */
export function customFieldName(field: { label?: unknown } | undefined, position: number): string {
  const label = typeof field?.label === "string" ? field.label.trim() : "";
  return `${position + 1}. ${label || `Field ${position + 1}`}`;
}

export type NamingScope = {
  draft: Draft;
  context: EditorContext;
  /** The template's sizes, as its forms offer them. */
  sizes: readonly KeyOption[];
  /** Whether the module list can read the draft (isEditableShape); if not, modules go by their defaults. */
  shapeOk: boolean;
};

/**
 * Where a problem is, as the steps the admin takes to get there:
 * ["Weight (g)", "Settings", "Gloves Weighed"],
 * ["Custom Module Glove type", "Fields", "2. Cuff length", "Lowest Value"],
 * ["Details", "Where It Applies", "Client"], ["JSON Tab"].
 */
export function placeLabels(place: ProblemPlace, scope: NamingScope): string[] {
  switch (place.area) {
    case "module":
      return moduleLabels(place, scope);
    case "custom": {
      const custom = ownCustomModules(scope.draft)[place.index];
      const title = typeof custom?.title === "string" && custom.title.trim() ? custom.title.trim() : `#${place.index + 1}`;
      return [`Custom Module ${title}`, ...customPathLabels(custom, place.path)];
    }
    case "template":
      if (place.path[0] === "json") return ["JSON Tab"];
      if (isDetailPath(place.path)) return ["Details", ...detailPathLabels(place.path)];
      return ["Template", ...place.path.map(stepName)];
  }
}

function moduleLabels(place: Extract<ProblemPlace, { area: "module" }>, scope: NamingScope): string[] {
  const key: ModuleKey = place.moduleKey;
  const definition = scope.context.registry[key];
  const view = scope.shapeOk ? moduleView(scope.draft, scope.context, key) : null;
  const title = view?.title ?? definition.title;
  const part = MODULE_PART_LABELS[place.part];
  switch (place.part) {
    case "labels": {
      // A label is listed by the wording it inherits (label-overrides.tsx), its key below.
      const labelKey = String(place.path[0] ?? "");
      const wording = view?.inherited.labels[labelKey] ?? definition.labels[labelKey];
      return [title, part, ...(labelKey ? [wording ?? labelKey] : [])];
    }
    case "config":
      return [
        title,
        part,
        ...pathLabels(configNodeOf(definition), place.path, settingNaming(key, view?.labels ?? definition.labels, scope.sizes)),
      ];
    case "entry":
      return [title, ...(place.path.length > 0 ? place.path.map(stepName) : [part])];
    default:
      return [title, part];
  }
}

/** A path inside a custom module, named as its form names each field. */
export function customPathLabels(custom: CustomModule | undefined, path: FormPath): string[] {
  const [head, ...rest] = path;
  if (typeof head !== "string") return path.map(stepName);
  if (head === "fields") {
    const [position, field, ...more] = rest;
    if (typeof position !== "number") return [CUSTOM_MODULE_LABELS.fields, ...rest.map(stepName)];
    const named = typeof field === "string" && field in CUSTOM_FIELD_LABELS;
    return [
      CUSTOM_MODULE_LABELS.fields,
      customFieldName(custom?.fields[position], position),
      ...(field === undefined ? [] : [named ? CUSTOM_FIELD_LABELS[field as keyof typeof CUSTOM_FIELD_LABELS] : stepName(field)]),
      ...more.map(stepName),
    ];
  }
  if (head === "grid") {
    // grid.columns.<part> and grid.repeatPer are each one switch or field on the form.
    const part = rest[0] === "columns" ? rest[1] : rest[0];
    const named = typeof part === "string" && part in CUSTOM_GRID_LABELS;
    return [
      CUSTOM_MODULE_LABELS.grid,
      ...(named ? [CUSTOM_GRID_LABELS[part as keyof typeof CUSTOM_GRID_LABELS]] : rest.map(stepName)),
    ];
  }
  if (head in CUSTOM_MODULE_LABELS) {
    return [CUSTOM_MODULE_LABELS[head as keyof typeof CUSTOM_MODULE_LABELS], ...rest.map(stepName)];
  }
  return path.map(stepName);
}

function stepName(segment: string | number): string {
  return typeof segment === "number" ? String(segment + 1) : humanize(segment);
}
