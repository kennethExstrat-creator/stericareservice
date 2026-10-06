// Values in a generated form: plain JSON, read and replaced by path without
// mutating anything, and a sensible empty value for something just added.
import type { FormNode, FormScalar, ObjectNode, UnionNode } from "./describe";
import type { FormPath } from "./issues";

export type FormValue = unknown;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getAt(value: unknown, path: FormPath): unknown {
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === "number") current = current[segment];
    else if (isPlainObject(current) && typeof segment === "string") current = current[segment];
    else return undefined;
  }
  return current;
}

/**
 * A copy of `value` with `next` at `path`. `undefined` removes an object key
 * (an optional setting cleared) or an array item. Objects and arrays missing
 * on the way are created.
 */
export function setAt(value: unknown, path: FormPath, next: unknown): unknown {
  if (path.length === 0) return next;
  const [head, ...rest] = path;
  if (typeof head === "number") {
    const list = Array.isArray(value) ? [...value] : [];
    const child = setAt(list[head], rest, next);
    if (child === undefined && rest.length === 0) list.splice(head, 1);
    else list[head] = child;
    return list;
  }
  const object = isPlainObject(value) ? { ...value } : {};
  const child = setAt(object[head], rest, next);
  if (child === undefined) delete object[head];
  else object[head] = child;
  return object;
}

/** Structural equality of JSON values; key order ignored. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a).filter((key) => a[key] !== undefined);
    const otherKeys = Object.keys(b).filter((key) => b[key] !== undefined);
    return keys.length === otherKeys.length && keys.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

/** Moves an array item; out-of-range moves leave the array as it is. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * What a newly added value starts as: the schema's default when it has one;
 * otherwise empty text, off, the first option, no value (null), an empty
 * list, or an object with its required settings filled in this way. A number
 * starts missing, so the form asks for it instead of guessing 0.
 */
export function emptyValue(node: FormNode): FormValue {
  if (node.default !== undefined) return structuredCloneJson(node.default);
  switch (node.kind) {
    case "object":
      return emptyObject(node);
    case "record":
      return {};
    case "array":
      return [];
    case "string":
      return "";
    case "number":
      return undefined;
    case "boolean":
      return false;
    case "enum":
      return node.options[0]?.value ?? null;
    case "literal":
      return node.value;
    case "nullable":
      return null;
    case "union":
      return emptyVariant(node, node.variants[0]?.value);
    case "json":
      return null;
  }
}

export function emptyObject(node: ObjectNode): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const property of node.properties) {
    if (!property.required) continue;
    const empty = emptyValue(property.node);
    if (empty !== undefined) value[property.key] = empty;
  }
  return value;
}

/**
 * A union switched to another variant: the tag, plus the values of the old
 * variant that the new one also has (a range keeps its min when it becomes
 * a minimum), then the new variant's required settings.
 */
export function emptyVariant(node: UnionNode, tag: string | undefined, previous?: unknown): FormValue {
  const variant = node.variants.find((entry) => entry.value === tag) ?? node.variants[0];
  if (!variant) return null;
  const value: Record<string, unknown> = { [node.discriminator]: variant.value };
  for (const property of variant.node.properties) {
    if (property.key === node.discriminator) continue;
    const kept = isPlainObject(previous) ? previous[property.key] : undefined;
    if (kept !== undefined) value[property.key] = kept;
    else if (property.required) {
      const empty = emptyValue(property.node);
      if (empty !== undefined) value[property.key] = empty;
    }
  }
  return value;
}

/** The variant a value is in, by its tag. */
export function variantOf(node: UnionNode, value: unknown): string | undefined {
  const tag = isPlainObject(value) ? value[node.discriminator] : undefined;
  return typeof tag === "string" && node.variants.some((variant) => variant.value === tag) ? tag : undefined;
}

/** Which option a scalar is, by value (options can be numbers, strings, booleans or null). */
export function optionIndex(options: readonly { value: FormScalar }[], value: unknown): number {
  return options.findIndex((option) => option.value === value);
}

function structuredCloneJson(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
