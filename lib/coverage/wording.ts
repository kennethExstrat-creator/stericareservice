// The forms' wording and the app's (BUILD_SPEC 4.2 rules 3 and 10). Kenneth,
// 8 October 2026: the app and the report write labels in Title Case
// (docs/DESIGN.md, Capitalisation); the forms' wording stays in sources.ts,
// verbatim. A label the app shows is the form's words with the rule's
// capitals: `sameWording` checks that, so the coverage tests still prove
// every printed label reaches the template. One more change is allowed:
// whatever a form calls the box or carton number ("Box #", "(Carton #)",
// "carton number", "Box Number"), the app says "Box/Carton #" (Kenneth, 13
// October 2026: box # and carton # are one number). `targetLabel` and
// `appWording` say what the app shows for a target and a source field (the
// coverage matrix's App wording column).
import { UNITS } from "@/lib/design/capitalisation";
import { SAFEDON_DISPENSING_DEFECTS } from "./defects";
import { captionLabel, fieldLabel } from "./fields";
import { DEFECT_CLASSES, LABELLING_LEVELS } from "./keys";
import { moduleConfig, templateOfSource, TEMPLATES } from "./templates";
import {
  isConfigTarget,
  isCustomTarget,
  isFieldTarget,
  isLabelTarget,
  type SourceField,
  type SourceTarget,
  type TemplateCode,
} from "./types";

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A form's words for the box or carton number, and the app's own ("Box/Carton #"). */
const BOX_CARTON_NUMBER = /\b(?:box\/carton|box|carton)\s*(?:#|numbers?\b|no\.)/gi;

/** The box or carton number in one wording, whatever the form called it: "No carton number" is "No box/carton #". */
function oneBoxCartonWording(text: string): string {
  return text.replace(BOX_CARTON_NUMBER, "box/carton #");
}

const isUnit = (word: string) => [...UNITS].some((unit) => unit.toLowerCase() === word.toLowerCase());

/**
 * The words with the first letter of each in lower case: "Total # Carton"
 * reads "total # carton". A unit in brackets keeps its case, so "(g)" and
 * "(G)" stay apart: the rule leaves units as they are.
 */
function withoutCapitals(text: string): string {
  return text.replace(
    /\(([^()\s]+)\)|(^|[^\p{L}\p{N}])(\p{L})/gu,
    (match, bracketed: string | undefined, before: string | undefined, letter: string | undefined) => {
      if (bracketed !== undefined) return isUnit(bracketed) ? match : `(${withoutCapitals(bracketed)})`;
      return `${before ?? ""}${(letter ?? "").toLowerCase()}`;
    },
  );
}

/**
 * True when `label` (the app's) is `printed` (a form's, [sic] fixed) with
 * only the first letters of its words in another case: "Total # carton" is
 * "Total # Carton", "Force At Break" is "Force at Break". Any other change
 * is a different label ("Total # Cartons", "Po / So Number", "Weight (G)"),
 * except the box or carton number, which the app words "Box/Carton #": "Box
 * #" is "Box/Carton #", "No carton number printed" is "No Box/Carton #
 * Printed". A `{name}` in the label stands for whatever the form printed
 * there: "Sampling Code Letter {codeLetters}" is "Sampling code letter K, L & M".
 */
export function sameWording(printed: string, label: string): boolean {
  const text = withoutCapitals(oneBoxCartonWording(printed));
  const wording = withoutCapitals(oneBoxCartonWording(label));
  if (!/\{\w+\}/.test(wording)) return text === wording;
  const pattern = wording.split(/\{\w+\}/).map(escapeRegExp).join(".+?");
  return new RegExp(`^${pattern}$`).test(text);
}

/** The label a list entry (defect, hole location, labelling check) has in the template's config. */
function listItemLabel(template: TemplateCode, target: SourceTarget): string | undefined {
  if (!isFieldTarget(target) || target.key === undefined) return undefined;
  const { module, group, key } = target;
  if (module === "watertight") return moduleConfig(template, "watertight")?.locations.find((item) => item.code === key)?.label;
  if (module === "visual" && group) {
    const classes = moduleConfig(template, "visual")?.classes;
    return classes?.[group as (typeof DEFECT_CLASSES)[number]]?.defects.find((item) => item.code === key)?.label;
  }
  if (module === "labeling" && group) {
    const levels = moduleConfig(template, "labeling")?.levels;
    return levels?.[group as (typeof LABELLING_LEVELS)[number]]?.checks.find((item) => item.code === key)?.label;
  }
  if (module === "dispensing_safedon") {
    return moduleConfig(template, "dispensing_safedon")?.defects.find((item) => item.code === key)?.label;
  }
  return undefined;
}

/**
 * What the template holds for a target, in its wording: a field's, caption's
 * or custom field's label, a list entry's label, a stickiness legend line as
 * the report prints it, a Safedon defect's definition as printed ([sic]
 * fixed). Undefined when the target has no single label: a config value as a
 * whole, the size list, the title block, a legend the AI report draws.
 */
export function targetLabel(template: TemplateCode, target: SourceTarget): string | undefined {
  if (isFieldTarget(target)) {
    return target.key === undefined
      ? fieldLabel(template, target.module, target.field, target.group)
      : listItemLabel(template, target);
  }
  if (isLabelTarget(target)) return captionLabel(template, target.module, target.label);
  if (isConfigTarget(target) && target.key !== undefined) {
    if (target.module === "dispensing_packing" && target.config === "stickinessCodes") {
      const code = moduleConfig(template, "dispensing_packing")?.stickinessCodes.find((item) => item.code === target.key);
      return code && `${code.code} = ${code.label} (${code.pass ? "Passed" : "Failed"})`;
    }
    if (target.module === "dispensing_safedon" && target.config === "defects") {
      const defect = SAFEDON_DISPENSING_DEFECTS.find((item) => item.code === target.key);
      return defect && (defect.correctedHint ?? defect.printedHint);
    }
  }
  if (isCustomTarget(target)) {
    const customModule = TEMPLATES[template].customModules.find((item) => item.key === target.custom);
    return customModule?.fields.find((field) => field.key === target.field)?.label;
  }
  return undefined;
}

/**
 * What the app shows for a source field, in its own template: the label of
 * the field's first target; for a field the template words apart on purpose
 * (`templateLabel: false`), each target's label ("Manufacturing Date; Expiry
 * Date"); for a Safedon definition, the hint the app shows in its place.
 * Otherwise the [sic] fix, if any. For the coverage matrix.
 */
export function appWording(field: SourceField): string | undefined {
  const template = templateOfSource(field.source);
  const [first] = field.targets;
  if (field.templateLabel === false) {
    const labels = field.targets.flatMap((target) => targetLabel(template, target) ?? []);
    return labels.length > 0 ? [...new Set(labels)].join("; ") : field.corrected;
  }
  if (isConfigTarget(first) && first.module === "dispensing_safedon" && first.config === "defects") {
    const defects = moduleConfig(template, "dispensing_safedon")?.defects;
    return defects?.find((item) => item.code === first.key)?.hint ?? field.corrected;
  }
  return targetLabel(template, first) ?? field.corrected;
}
