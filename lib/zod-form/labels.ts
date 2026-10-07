// Words for keys and options the schema does not title itself. A form's
// caller can do better (a module's own labels, a template's sizes); these
// are the fallback, in Title Case like every label the app writes:
// "minLayeringPct" reads "Min Layering %". The form and anything that points
// into it (a list of problems) name a field the same way: fieldLabel for one
// setting, pathLabels for each step of a path.
import { staysLowerCase } from "@/lib/design/capitalisation";
import { formatNumber } from "@/lib/format";
import type { FormNode, FormProperty, FormScalar, NumberNode } from "./describe";
import type { FormPath } from "./issues";

/** A choice offered for a string or a record key, e.g. a template's size. */
export type KeyOption = { value: string; label: string };

/**
 * What the caller knows about naming that the schema does not: its own words
 * for a key (a module's labels), the choices behind a marker (the template's
 * sizes), the names of a union's variants. Every hook is optional.
 */
export type NamingHooks = {
  /** Words for a property or record key, e.g. the module's own label for that key; `node` is its value's. */
  labelForKey?: (key: string, path: FormPath, node: FormNode | undefined) => string | undefined;
  /** Choices for a string, or a record's keys, the schema marks (e.g. "size": the template's sizes). */
  markerOptions?: (marker: string, path: FormPath) => readonly KeyOption[] | undefined;
  /** Words for a union's variants, e.g. a spec's "min" as "Minimum (≥)". */
  variantLabel?: (marker: string | undefined, value: string) => string | undefined;
};

const WORDS: Readonly<Record<string, string>> = {
  pct: "%",
  aql: "AQL",
  po: "PO",
  id: "ID",
  na: "NA",
  mfg: "Mfg",
  qty: "Qty",
  url: "URL",
  json: "JSON",
  ai: "AI",
  r: "R",
  l: "L",
};

const capitalised = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** A key's words, each cased by `wordCase` (given in lower case) unless it is an abbreviation or a code. */
function spell(key: string, wordCase: (word: string, index: number, count: number) => string): string {
  if (key.length <= 1) return key;
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter((word) => word !== "");
  const spelled = words.map((word, index) => {
    const known = WORDS[word.toLowerCase()];
    if (known) return known;
    // Keep acronyms and codes as written: "EN455", "S-1", "XL".
    if (/^[A-Z0-9]{2,}$/.test(word)) return word;
    return wordCase(word.toLowerCase(), index, words.length);
  });
  return spelled.join(" ");
}

/**
 * A key as a label, in Title Case (docs/DESIGN.md, Capitalisation): every word
 * capitalised but the small words in the middle. "minLayeringPct" -> "Min
 * Layering %", "hole_crotch" -> "Hole Crotch", "boxesPerSize" -> "Boxes per
 * Size", "shownAs" -> "Shown As", "n" -> "n".
 */
export function humanize(key: string): string {
  return spell(key, (word, index, count) => (staysLowerCase(word, index, count) ? word : capitalised(word)));
}

/** A key as the words of a value, not a label: only the first capitalised. "torn_cuff" -> "Torn cuff". */
export function humanizeValue(key: string): string {
  return spell(key, (word, index) => (index === 0 ? capitalised(word) : word));
}

/** An option as shown: text as humanized, numbers and codes as they are. */
export function optionText(value: FormScalar): string {
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  // Codes such as "S-1", "II", "XL", "7.0" stay as written.
  if (/^[A-Z0-9][A-Z0-9.\-]*$/.test(value)) return value;
  return humanize(value);
}

type NumberLimits = Pick<NumberNode, "integer" | "minimum" | "maximum" | "exclusiveMinimum" | "exclusiveMaximum">;

/**
 * What a number field accepts, in words, from the schema's limits:
 * "Whole number, 1 to 500.", "0 to 100.", "More than 0.". Undefined when
 * any number will do.
 */
export function numberRange(node: NumberLimits): string | undefined {
  const text = (value: number) => formatNumber(value, { grouping: true });
  const low =
    node.minimum !== undefined
      ? { value: node.minimum, strict: false }
      : node.exclusiveMinimum !== undefined
        ? { value: node.exclusiveMinimum, strict: true }
        : null;
  const high =
    node.maximum !== undefined
      ? { value: node.maximum, strict: false }
      : node.exclusiveMaximum !== undefined
        ? { value: node.exclusiveMaximum, strict: true }
        : null;
  let range: string | null = null;
  if (low && high && !low.strict && !high.strict) {
    range = `${text(low.value)} to ${text(high.value)}`;
  } else if (low || high) {
    range = [
      low && (low.strict ? `more than ${text(low.value)}` : `${text(low.value)} or more`),
      high && (high.strict ? `less than ${text(high.value)}` : `${text(high.value)} or less`),
    ]
      .filter(Boolean)
      .join(" and ");
  }
  if (node.integer) return range ? `Whole number, ${range}.` : "Whole number.";
  return range ? `${range.charAt(0).toUpperCase()}${range.slice(1)}.` : undefined;
}

/**
 * A setting's name: the schema's title, else the caller's words for its key,
 * else the key in words. A list item is named by its position.
 */
export function fieldLabel(node: FormNode, key: string | number | undefined, path: FormPath, hooks: NamingHooks = {}): string {
  if (node.title) return node.title;
  if (typeof key === "string") return hooks.labelForKey?.(key, path, node) ?? humanize(key);
  return typeof key === "number" ? String(key + 1) : "Value";
}

/** "Hole locations" names one item "hole location", "Classes" one "class". */
export function singularLabel(label: string): string {
  if (/ies$/i.test(label)) return `${label.slice(0, -3)}y`;
  if (/(ss|sh|x)es$/i.test(label)) return label.slice(0, -2);
  if (/(ss|us)$/i.test(label)) return label;
  if (/s$/i.test(label)) return label.slice(0, -1);
  return label;
}

/** One item of a list, as the form names it: "Locations" holds "Location 1", "Location 2"... */
export function itemLabel(listLabel: string, index: number): string {
  return `${humanize(singularLabel(listLabel))} ${index + 1}`;
}

/** A record entry's name: the marker's choice (a size's label), else the caller's words, else the key. */
export function recordKeyLabel(
  node: Extract<FormNode, { kind: "record" }>,
  key: string,
  path: FormPath,
  hooks: NamingHooks = {},
): string {
  const offered = node.key.marker ? hooks.markerOptions?.(node.key.marker, path) : undefined;
  return offered?.find((option) => option.value === key)?.label ?? hooks.labelForKey?.(key, [...path, key], node.value) ?? key;
}

/**
 * Each step of a path into a value, named as its form names it: a setting
 * by its label, a list item by its position ("Location 2"), a record entry
 * by its key's label (a size), a union's tag as "Type". Steps past what the
 * schema describes (JSON edited by hand) are named by their keys.
 *
 * pathLabels(weightNode, ["specs", 0, "spec", "min"], hooks)
 *   -> ["Specs", "Spec 1", "Spec", "Min"]
 */
export function pathLabels(root: FormNode, path: FormPath, hooks: NamingHooks = {}, rootLabel = "Value"): string[] {
  const names: string[] = [];
  let node: FormNode | undefined = root;
  let label = rootLabel;
  for (let depth = 0; depth < path.length; depth += 1) {
    const segment = path[depth];
    const parent = path.slice(0, depth);
    const here = path.slice(0, depth + 1);
    while (node?.kind === "nullable") node = node.inner;
    let next: FormNode | undefined;
    if (node?.kind === "object" && typeof segment === "string") {
      const property: FormProperty | undefined = node.properties.find((entry) => entry.key === segment);
      next = property?.node;
      label = property ? fieldLabel(property.node, segment, here, hooks) : humanize(segment);
    } else if (node?.kind === "record") {
      next = node.value;
      label = recordKeyLabel(node, String(segment), parent, hooks);
    } else if (node?.kind === "array" && typeof segment === "number") {
      next = node.items;
      label = itemLabel(label, segment);
    } else if (node?.kind === "union" && typeof segment === "string") {
      if (segment === node.discriminator) {
        label = "Type";
      } else {
        const property: FormProperty | undefined = node.variants
          .flatMap((variant) => variant.node.properties)
          .find((entry) => entry.key === segment);
        next = property?.node;
        label = property ? fieldLabel(property.node, segment, here, hooks) : humanize(segment);
      }
    } else {
      label = typeof segment === "number" ? String(segment + 1) : humanize(segment);
    }
    names.push(label);
    node = next;
  }
  return names;
}
