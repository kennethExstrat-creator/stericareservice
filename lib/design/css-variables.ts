// Reads CSS custom properties out of a stylesheet. Used by tests to check
// app/globals.css against lib/design/tokens.ts; not shipped to the browser.

type ParseOptions = {
  /** Throw when a name is declared twice with different values (default true). */
  strict?: boolean;
};

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every `--name: value;` declaration in the stylesheet, comments removed. */
export function parseCustomProperties(
  css: string,
  { strict = true }: ParseOptions = {},
): Map<string, string> {
  const source = stripComments(css);
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

/** The body of `@utility <name> { … }`, comments removed; undefined when there is none. */
export function utilityBody(css: string, name: string): string | undefined {
  const source = stripComments(css);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = new RegExp(`@utility\\s+${escaped}\\s*\\{`).exec(source);
  if (!start) return undefined;
  const open = start.index + start[0].length - 1;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`@utility ${name} is not closed`);
}

/** `property: value` declarations in a CSS fragment, nesting flattened (later wins). */
export function declarations(css: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, property, value] of stripComments(css).matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
    found.set(property, value.trim().replace(/\s+/g, " "));
  }
  return found;
}
