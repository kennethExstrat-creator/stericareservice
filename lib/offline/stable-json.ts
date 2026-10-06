/**
 * JSON with object keys sorted, so two copies of the same data serialise the
 * same way whatever their key order (Postgres jsonb reorders keys). Otherwise
 * it follows JSON.stringify: toJSON is honoured, undefined, functions and
 * symbols are left out of objects and become null in arrays, and NaN and
 * Infinity become null.
 */
export function stableStringify(value: unknown): string {
  return serialize(value) ?? "null";
}

function serialize(input: unknown): string | undefined {
  const value = hasToJson(input) ? input.toJSON() : input;
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : "null";
    case "boolean":
      return value ? "true" : "false";
    case "bigint":
      throw new TypeError("A BigInt cannot be serialised as JSON.");
    case "object": {
      if (Array.isArray(value)) return `[${value.map((item) => serialize(item) ?? "null").join(",")}]`;
      const record = value as Record<string, unknown>;
      const members: string[] = [];
      for (const key of Object.keys(record).sort()) {
        const member = serialize(record[key]);
        if (member !== undefined) members.push(`${JSON.stringify(key)}:${member}`);
      }
      return `{${members.join(",")}}`;
    }
    default:
      return undefined;
  }
}

function hasToJson(value: unknown): value is { toJSON: () => unknown } {
  return typeof value === "object" && value !== null && typeof (value as { toJSON?: unknown }).toJSON === "function";
}

/**
 * A 64-bit non-cryptographic hash (cyrb53's mixing, both halves kept) as 16
 * hex digits. Used to recognise data this device has already seen or sent;
 * crypto.subtle is not an option because it needs a secure context.
 */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/** Equal for equal JSON content, whatever the key order. */
export function contentHash(value: unknown): string {
  return hashText(stableStringify(value));
}
