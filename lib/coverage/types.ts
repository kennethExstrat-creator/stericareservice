// Types of the data dictionary and source-field coverage inventory
// (BUILD_SPEC 4.2 rules 1 to 5 and 10). docs/DATA_DICTIONARY.md explains them.
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { Unit } from "@/lib/schemas/common";

/* ------------------------------------------------------------------ *
 * Templates and source documents
 * ------------------------------------------------------------------ */

/** The seed templates (BUILD_SPEC 11). */
export const TEMPLATE_CODES = ["STD_EG", "SAFEDON_EG", "STD_SG"] as const;
export type TemplateCode = (typeof TEMPLATE_CODES)[number];

/** The source documents in docs/forms, finished reports first (rule 4.2.1). */
export const SOURCE_IDS = [
  "report_STD_EG",
  "report_SAFEDON_EG",
  "onsite_EG",
  "onsite_SG",
  "onsite_SAFEDON_EG",
] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

/** BUILD_SPEC 6.2 validation rule numbers. */
export type RuleNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

/* ------------------------------------------------------------------ *
 * The dictionary: module data, config and labels
 * ------------------------------------------------------------------ */

/**
 * The value a data field holds, at the innermost level of its nesting.
 * `count_map` is a map of code to count (defect codes, hole locations,
 * labelling checks); `label_counts` is a list of `{ label, count }` for
 * one-off labels that are not in the template's list.
 */
export type ValueType =
  | "text"
  | "textarea"
  | "integer"
  | "decimal"
  | "date"
  | "select"
  | "yes_no"
  | "text_list"
  | "integer_list"
  | "decimal_list"
  | "count_map"
  | "label_counts"
  | "reference"
  | "file"
  | "signature";

/**
 * How a field repeats, outermost first. `hand` applies only when the
 * module's `handSplit` config is on; `glove` and `box` are table rows.
 */
export type Nesting = "size" | "hand" | "class" | "level" | "glove" | "box" | "item";

/**
 * `entered`: typed or tapped by the inspector (possibly prefilled).
 * `system`: recorded by the app, never typed (the inspector).
 * `computed`: derived by the app, never typed (BUILD_SPEC 6.2 rule 2).
 */
export type Entry = "entered" | "system" | "computed";

/** Label overrides per template. The default label is STD_EG's wording. */
export type LabelOverrides = Readonly<Partial<Record<TemplateCode, string>>>;

export type GroupLabel = { readonly label: string; readonly labels?: LabelOverrides };

export type DataFieldSpec = {
  /** Canonical key, camelCase, unique within the module (rule 4.2.3). */
  readonly key: string;
  /** Default label: STD_EG's wording with [sic] typos fixed, in Title Case; the source's wording where STD_EG lacks the field. */
  readonly label: string;
  readonly labels?: LabelOverrides;
  /** Labels that differ per class or level (visual, labeling), keyed by group. */
  readonly groupLabels?: Readonly<Record<string, GroupLabel>>;
  readonly type: ValueType;
  readonly unit?: Unit;
  /** What an integer counts when it is not gloves: cases, inner units, pouches, boxes, cartons. */
  readonly countOf?: string;
  readonly per: readonly Nesting[];
  /** For `count_map` and per-measure values: what the map is keyed by. */
  readonly keyedBy?: string;
  readonly entry: Entry;
  /** Where an entered value is prefilled from (BUILD_SPEC 8: numbers flow forward). */
  readonly prefill?: string;
  /** How a computed value is derived. */
  readonly formula?: string;
  readonly options?: readonly string[];
  /** The `inspections` column that holds or copies the value. */
  readonly column?: string;
  readonly rules?: readonly RuleNumber[];
  /** Why the field exists although BUILD_SPEC 6.1 does not list it: the source that needs it. */
  readonly addition?: string;
  readonly notes?: string;
};

export type ConfigFieldSpec = {
  readonly key: string;
  /** The value's shape, in TypeScript notation. */
  readonly type: string;
  /**
   * The module's default: complete, in the shape of `type`, so a module's
   * defaultConfig is these values (BUILD_SPEC's defaults, else STD_EG's).
   * templates.ts checks each default against the config type at compile time.
   */
  readonly default: unknown;
  /** How docs/DATA_DICTIONARY.md describes a default too long to print. */
  readonly defaultNote?: string;
  readonly meaning: string;
};

/**
 * A heading or caption that is not a data field: table headings, group
 * captions, row captions, result words. `{name}` marks a value the app
 * fills in (see docs/DATA_DICTIONARY.md, Labels).
 */
export type LabelSpec = {
  readonly key: string;
  readonly label: string;
  readonly labels?: LabelOverrides;
  readonly meaning: string;
};

export type ModuleSpec = {
  readonly key: ModuleKey;
  readonly kind: "report" | "optional";
  readonly alwaysOn: boolean;
  /** Section heading in STD_EG's wording (ModuleConfig.title). */
  readonly title: string;
  readonly titles?: LabelOverrides;
  /** Class or level names for `group` in targets and `groupLabels`. */
  readonly groups?: readonly string[];
  readonly captures: string;
  readonly result: string;
  readonly rules: readonly RuleNumber[];
  readonly data: readonly DataFieldSpec[];
  readonly config: readonly ConfigFieldSpec[];
  readonly labels: readonly LabelSpec[];
  readonly notes?: readonly string[];
};

/* ------------------------------------------------------------------ *
 * The inventory: where each source field goes
 * ------------------------------------------------------------------ */

/** A module data field; `group` picks a class or level, `key` an entry of a map (a defect code, a check, a measure). */
export type FieldTarget = {
  readonly module: ModuleKey;
  readonly field: string;
  readonly group?: string;
  readonly key?: string;
};

/** A value the template fixes in the module's config (a spec, an AQL, a defect list entry). */
export type ConfigTarget = { readonly module: ModuleKey; readonly config: string; readonly key?: string };

/** A heading or caption of the module; `title` is the module title (ModuleConfig.title). */
export type LabelTarget = { readonly module: ModuleKey; readonly label: string };

/** A field of a custom module: no module holds it (rule 4.2.2). */
export type CustomTarget = { readonly custom: string; readonly field: string };

/** Template-level values (BUILD_SPEC 4.3): the size list, the unit, the report settings. */
export const TEMPLATE_PROPERTIES = ["sizes", "unit", "report.titleLines", "report.showClientLogo"] as const;
export type TemplateProperty = (typeof TEMPLATE_PROPERTIES)[number];

/** A template-level value: the size list, the report title. */
export type TemplateTarget = { readonly template: TemplateProperty };

/**
 * Report layout only (page numbers, running headers, legends): the AI report
 * draws it from values the app already holds; nothing to capture or configure.
 */
export type LayoutTarget = { readonly layout: string };

export type SourceTarget = FieldTarget | ConfigTarget | LabelTarget | CustomTarget | TemplateTarget | LayoutTarget;

/** What the source shows in the cell. */
export type SourceInput =
  | "text"
  | "number"
  | "date"
  | "select"
  | "size"
  | "signature"
  | "blank"
  | "handwritten_rows"
  | "computed"
  | "fixed"
  | "heading"
  | "label"
  | "repeat"
  | "image"
  | "page";

export type SourceField = {
  /** Stable id for the coverage checklist: `<source>:<section>:<label>`, slugged. */
  readonly id: string;
  readonly source: SourceId;
  /** Where on the source: page or section number, then the heading. */
  readonly section: string;
  /** Verbatim, original spelling included. `<...>` marks a value printed in the label. */
  readonly label: string;
  /** The source's words with its typo fixed ([sic]); the app writes them in Title Case (wording.ts). */
  readonly corrected?: string;
  readonly input: SourceInput;
  /** Where the field goes. Never empty: nothing is dropped (rule 4.2.2). */
  readonly targets: readonly SourceTarget[];
  /**
   * false when the template shows the target under a different label on
   * purpose (a split box, a value shown again under another caption).
   */
  readonly templateLabel?: false;
  readonly notes?: string;
};

export function isFieldTarget(target: SourceTarget): target is FieldTarget {
  return "module" in target && "field" in target;
}

export function isConfigTarget(target: SourceTarget): target is ConfigTarget {
  return "module" in target && "config" in target;
}

export function isLabelTarget(target: SourceTarget): target is LabelTarget {
  return "module" in target && "label" in target;
}

export function isCustomTarget(target: SourceTarget): target is CustomTarget {
  return "custom" in target;
}

export function isTemplateTarget(target: SourceTarget): target is TemplateTarget {
  return "template" in target;
}

export function isLayoutTarget(target: SourceTarget): target is LayoutTarget {
  return "layout" in target;
}
