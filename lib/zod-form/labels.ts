// Words for keys and options the schema does not title itself. A form's
// caller can do better (a module's own labels, a template's sizes); these
// are the fallback: "minLayeringPct" reads "Min layering %".
import { formatNumber } from "@/lib/format";
import type { FormScalar, NumberNode } from "./describe";

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

/** "minLayeringPct" -> "Min layering %", "hole_crotch" -> "Hole crotch", "n" -> "n". */
export function humanize(key: string): string {
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
    return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase();
  });
  return spelled.join(" ");
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
