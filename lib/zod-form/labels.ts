// Words for keys and options the schema does not title itself. A form's
// caller can do better (a module's own labels, a template's sizes); these
// are the fallback: "minLayeringPct" reads "Min layering %".
import type { FormScalar } from "./describe";

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
