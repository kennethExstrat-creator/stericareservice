// Reads CSS custom properties out of a stylesheet. Used by tests to check
// app/globals.css against lib/design/tokens.ts; not shipped to the browser.

type ParseOptions = {
  /** Throw when a name is declared twice with different values (default true). */
  strict?: boolean;
};

/** Every `--name: value;` declaration in the stylesheet, comments removed. */
export function parseCustomProperties(
  css: string,
  { strict = true }: ParseOptions = {},
): Map<string, string> {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const properties = new Map<string, string>();
  for (const [, name, raw] of source.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
    const value = raw.trim().replace(/\s+/g, " ");
    const existing = properties.get(name);
    if (existing === undefined) {
      properties.set(name, value);
    } else if (strict && existing !== value) {
      throw new Error(`${name} is declared twice with different values`);
    }
  }
  return properties;
}

/** Follows `var(--x)` chains to a literal value. */
export function resolveCustomProperty(name: string, properties: Map<string, string>): string {
  const seen = new Set<string>();
  let current = name;
  for (;;) {
    if (seen.has(current)) throw new Error(`Cycle while resolving ${name}`);
    seen.add(current);
    const value = properties.get(current);
    if (value === undefined) throw new Error(`${current} is not declared`);
    const reference = /^var\((--[\w-]+)\)$/.exec(value);
    if (!reference) return value;
    current = reference[1];
  }
}
