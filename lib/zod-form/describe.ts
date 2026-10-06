// Forms generated from zod schemas (BUILD_SPEC 10: "a config form per module,
// generated from its config schema"). A schema becomes a tree of FormNodes by
// way of z.toJSONSchema(), the public conversion every module's config schema
// must survive (checkModuleContract fails a schema it cannot convert). The
// renderer (schema-form.tsx) draws the tree; validation still runs on the
// zod schema itself (issues.ts), so refinements JSON Schema cannot express
// still give their own messages.
//
// What each JSON Schema shape becomes:
//   object with properties          object (properties in order, required or optional)
//   object keyed by an enum         object: every key a property (z.record), or optional (z.partialRecord)
//   object with free keys           record (z.record): entries added and removed by key
//   array                           array (z.tuple and anything stranger: json)
//   string, number, integer, boolean
//   enum, const                     enum (a select), literal (fixed)
//   anyOf/oneOf with null           nullable
//   anyOf/oneOf of tagged objects   union, switched by the tag (SpecSchema's `kind`)
//   anything else                   json: edited as JSON text
import { z } from "zod";

export type FormScalar = string | number | boolean | null;

export type FormOption = { value: FormScalar; label?: string };

type NodeBase = {
  /** `.meta({ title })`. */
  title?: string;
  /** `.describe()` or `.meta({ description })`. */
  description?: string;
  /** `.default()`, in the schema's input. */
  default?: unknown;
  /** The name of the FormMarker this schema matched, e.g. "size". */
  marker?: string;
  /** Unit shown with a number: `.meta({ unit: "mm" })`, a `…Pct` key or "in %" in the description. */
  unit?: string;
  /** Every other `.meta()` key, for widgets that look for one. */
  meta: Readonly<Record<string, unknown>>;
};

export type FormProperty = { key: string; node: FormNode; required: boolean };

export type ObjectNode = NodeBase & { kind: "object"; properties: FormProperty[] };

/** What a record's keys may be: free text (with a pattern), or a marked kind such as a size. */
export type RecordKey = { pattern?: string; marker?: string; description?: string };

export type RecordNode = NodeBase & { kind: "record"; key: RecordKey; value: FormNode };

export type ArrayNode = NodeBase & { kind: "array"; items: FormNode; minItems?: number; maxItems?: number };

export type StringNode = NodeBase & {
  kind: "string";
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
};

export type NumberNode = NodeBase & {
  kind: "number";
  integer: boolean;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
};

export type BooleanNode = NodeBase & { kind: "boolean" };

export type EnumNode = NodeBase & { kind: "enum"; options: FormOption[] };

export type LiteralNode = NodeBase & { kind: "literal"; value: FormScalar };

export type NullableNode = NodeBase & { kind: "nullable"; inner: FormNode };

/** One shape of a tagged union, e.g. SpecSchema's `{ kind: "min", min }`. */
export type UnionVariant = { value: string; node: ObjectNode };

export type UnionNode = NodeBase & { kind: "union"; discriminator: string; variants: UnionVariant[] };

export type JsonNode = NodeBase & { kind: "json"; reason: string };

export type FormNode =
  | ObjectNode
  | RecordNode
  | ArrayNode
  | StringNode
  | NumberNode
  | BooleanNode
  | EnumNode
  | LiteralNode
  | NullableNode
  | UnionNode
  | JsonNode;

export type FormNodeKind = FormNode["kind"];

/**
 * A schema the form should recognise wherever it is used, also through
 * `.describe()`, `.meta()`, `.optional()` or `.nullable()`: CanonicalSizeSchema
 * as "size" (a record keyed by size offers the template's sizes), SpecSchema
 * as "spec".
 */
export type FormMarker = { name: string; schema: z.ZodType };

export type DescribeOptions = { markers?: readonly FormMarker[] };

/** Units a number may carry (BUILD_SPEC 4.2 rule 5), as `.meta({ unit })` or in the description. */
export const FORM_UNITS = ["mm", "g", "N", "MPa", "%", "pcs"] as const;

const MARKER_KEY = "x-form-marker";
const SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

/** Keys JSON Schema itself uses: everything else on a node came from `.meta()`. */
const SCHEMA_KEYS = new Set([
  "$schema",
  "$ref",
  "$defs",
  "definitions",
  "$id",
  "id",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "propertyNames",
  "patternProperties",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "uniqueItems",
  "contains",
  "enum",
  "const",
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "contentEncoding",
  "contentMediaType",
  "title",
  "description",
  "default",
  "examples",
  "readOnly",
  "writeOnly",
  "deprecated",
  MARKER_KEY,
]);

type Json = Record<string, unknown>;

const cache = new WeakMap<z.ZodType, Map<string, FormNode>>();

/**
 * The form tree of a zod schema. Pure and cached per schema and marker set;
 * a schema that cannot be converted at all becomes one JSON node.
 */
export function describeSchema(schema: z.ZodType, options: DescribeOptions = {}): FormNode {
  const markers = options.markers ?? [];
  const cacheKey = markers.map((marker) => marker.name).join("|");
  const cached = cache.get(schema)?.get(cacheKey);
  if (cached) return cached;

  let node: FormNode;
  try {
    const json = z.toJSONSchema(schema, {
      io: "input",
      unrepresentable: "any",
      override: ({ zodSchema, jsonSchema }) => {
        const found = markers.find((marker) => sameSchema(zodSchema, marker.schema));
        if (found) (jsonSchema as Json)[MARKER_KEY] = found.name;
      },
    }) as Json;
    node = fromJsonSchema(json, json, [], undefined);
  } catch (error) {
    node = { kind: "json", reason: `The schema could not be read: ${messageOf(error)}`, meta: {} };
  }

  const forSchema = cache.get(schema) ?? new Map<string, FormNode>();
  forSchema.set(cacheKey, node);
  cache.set(schema, forSchema);
  return node;
}

/**
 * The same schema, or a copy made by `.describe()` or `.meta()`: zod clones
 * keep their definition and point at the schema they came from. (`_zod` is
 * zod's internal record; `parent` is set by exactly these clones.)
 */
function sameSchema(candidate: z.core.$ZodType, target: z.ZodType): boolean {
  let current: z.core.$ZodType | undefined = candidate;
  for (let depth = 0; current !== undefined && depth < 16; depth += 1) {
    if (current === target || current._zod.def === target._zod.def) return true;
    current = current._zod.parent;
  }
  return false;
}

function fromJsonSchema(json: Json, root: Json, refs: readonly string[], key: string | undefined): FormNode {
  const ref = typeof json.$ref === "string" ? json.$ref : null;
  if (ref !== null) {
    if (refs.includes(ref)) return jsonNode(json, "It refers to itself, so it is edited as JSON.");
    const target = resolveRef(root, ref);
    if (!target) return jsonNode(json, `${ref} could not be found.`);
    // Keywords next to $ref (a description, a marker) apply on top of the target.
    const beside = Object.fromEntries(Object.entries(json).filter(([name]) => name !== "$ref"));
    return fromJsonSchema({ ...target, ...beside }, root, [...refs, ref], key);
  }

  const base = baseOf(json, key);
  const choices = asArray(json.anyOf) ?? asArray(json.oneOf);
  if (choices) return fromChoices(choices, json, base, root, refs, key);

  if (Array.isArray(json.allOf)) return jsonNode(json, "Intersections are edited as JSON.");

  if (Array.isArray(json.enum)) {
    const values = json.enum.filter(isScalar);
    if (values.length !== json.enum.length || values.length === 0) return jsonNode(json, "Unsupported options.");
    if (values.length === 1) return { ...base, kind: "literal", value: values[0] };
    return { ...base, kind: "enum", options: values.map((value) => ({ value })) };
  }
  if ("const" in json) {
    return isScalar(json.const) ? { ...base, kind: "literal", value: json.const } : jsonNode(json, "Unsupported constant.");
  }

  const type = json.type;
  if (Array.isArray(type)) {
    const types = type.filter((entry): entry is string => typeof entry === "string");
    const others = types.filter((entry) => entry !== "null");
    if (others.length === 1) {
      const inner = fromJsonSchema({ ...json, type: others[0] }, root, refs, key);
      return types.includes("null") ? { ...base, kind: "nullable", inner: { ...inner, meta: {} } } : inner;
    }
    return jsonNode(json, "Several types at once are edited as JSON.");
  }

  switch (type) {
    case "object":
      return fromObject(json, base, root, refs);
    case "array":
      return fromArray(json, base, root, refs, key);
    case "string":
      return {
        ...base,
        kind: "string",
        ...numberProp("minLength", json.minLength),
        ...numberProp("maxLength", json.maxLength),
        ...stringProp("pattern", json.pattern),
        ...stringProp("format", json.format),
      };
    case "number":
    case "integer": {
      const maximum = typeof json.maximum === "number" && json.maximum < SAFE_INTEGER ? json.maximum : undefined;
      const minimum = typeof json.minimum === "number" && json.minimum > -SAFE_INTEGER ? json.minimum : undefined;
      return {
        ...base,
        kind: "number",
        integer: type === "integer",
        ...numberProp("minimum", minimum),
        ...numberProp("maximum", maximum),
        ...numberProp("exclusiveMinimum", json.exclusiveMinimum),
        ...numberProp("exclusiveMaximum", json.exclusiveMaximum),
        ...numberProp("multipleOf", json.multipleOf),
      };
    }
    case "boolean":
      return { ...base, kind: "boolean" };
    case "null":
      return { ...base, kind: "literal", value: null };
    default:
      return jsonNode(json, "Any value: edited as JSON.");
  }
}

function fromChoices(
  choices: Json[],
  json: Json,
  base: NodeBase,
  root: Json,
  refs: readonly string[],
  key: string | undefined,
): FormNode {
  const nullable = choices.some((choice) => choice.type === "null" && Object.keys(choice).length === 1);
  const rest = choices.filter((choice) => !(choice.type === "null" && Object.keys(choice).length === 1));
  let inner: FormNode;

  if (rest.length === 0) {
    inner = { ...base, kind: "literal", value: null };
    return inner;
  }
  if (rest.length === 1) {
    inner = fromJsonSchema(rest[0], root, refs, key);
  } else {
    const nodes = rest.map((choice) => fromJsonSchema(choice, root, refs, key));
    inner = mergeChoices(nodes, json) ?? jsonNode(json, "Alternatives that are not tagged are edited as JSON.");
  }

  // JSON text takes null as it is: no switch around it.
  if (!nullable || inner.kind === "json") return withBase(inner, base);
  // The description and marker belong to the field, not to the value inside.
  return { ...base, kind: "nullable", inner: stripBase(inner) };
}

/** Options that are all plain values become one select; objects tagged by one key become a union. */
function mergeChoices(nodes: FormNode[], json: Json): FormNode | null {
  if (nodes.every((node) => node.kind === "enum" || node.kind === "literal")) {
    const options: FormOption[] = [];
    for (const node of nodes) {
      const values = node.kind === "enum" ? node.options.map((option) => option.value) : [node.value];
      for (const value of values) if (!options.some((option) => option.value === value)) options.push({ value });
    }
    return { ...baseOf(json, undefined), kind: "enum", options };
  }
  if (nodes.every((node) => node.kind === "object")) {
    const objects = nodes as ObjectNode[];
    const discriminator = objects[0].properties
      .map((property) => property.key)
      .find((candidate) =>
        objects.every((object) => {
          const property = object.properties.find((entry) => entry.key === candidate);
          return property?.required && property.node.kind === "literal" && typeof property.node.value === "string";
        }),
      );
    if (!discriminator) return null;
    const variants = objects.map((object) => {
      const tag = object.properties.find((property) => property.key === discriminator)?.node as LiteralNode;
      return { value: String(tag.value), node: object };
    });
    if (new Set(variants.map((variant) => variant.value)).size !== variants.length) return null;
    return { ...baseOf(json, undefined), kind: "union", discriminator, variants };
  }
  return null;
}

function fromObject(json: Json, base: NodeBase, root: Json, refs: readonly string[]): FormNode {
  const required = new Set(asStringArray(json.required));
  const properties = isRecord(json.properties) ? json.properties : null;
  const additional = json.additionalProperties;

  if (properties && Object.keys(properties).length > 0) {
    return {
      ...base,
      kind: "object",
      properties: Object.entries(properties).flatMap(([name, value]) =>
        isRecord(value) ? [{ key: name, node: fromJsonSchema(value, root, refs, name), required: required.has(name) }] : [],
      ),
    };
  }

  const names = isRecord(json.propertyNames) ? json.propertyNames : null;
  const valueSchema = isRecord(additional) ? additional : null;
  // z.record(z.enum([...]), value): every key required; z.partialRecord: every key optional.
  if (names && Array.isArray(names.enum) && valueSchema) {
    const keys = names.enum.filter((entry): entry is string => typeof entry === "string");
    return {
      ...base,
      kind: "object",
      properties: keys.map((name) => ({
        key: name,
        node: fromJsonSchema(valueSchema, root, refs, name),
        required: required.has(name),
      })),
    };
  }
  if (valueSchema || names) {
    const valueNode = valueSchema ? fromJsonSchema(valueSchema, root, refs, undefined) : jsonNode({}, "Any value.");
    return {
      ...base,
      kind: "record",
      key: {
        ...stringProp("pattern", names?.pattern),
        ...stringProp("marker", names?.[MARKER_KEY]),
        ...stringProp("description", names?.description),
      },
      value: valueNode,
    };
  }
  if (additional === false) return { ...base, kind: "object", properties: [] };
  return jsonNode(json, "An object with any keys: edited as JSON.");
}

function fromArray(json: Json, base: NodeBase, root: Json, refs: readonly string[], key: string | undefined): FormNode {
  if (Array.isArray(json.prefixItems)) return jsonNode(json, "Fixed-length lists are edited as JSON.");
  const items = isRecord(json.items) ? json.items : null;
  if (!items) return jsonNode(json, "A list of any values: edited as JSON.");
  return {
    ...base,
    kind: "array",
    items: fromJsonSchema(items, root, refs, singular(key)),
    ...numberProp("minItems", json.minItems),
    ...numberProp("maxItems", json.maxItems),
  };
}

function baseOf(json: Json, key: string | undefined): NodeBase {
  const meta: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(json)) {
    if (!SCHEMA_KEYS.has(name)) meta[name] = value;
  }
  const description = typeof json.description === "string" ? json.description : undefined;
  const unit = unitOf(meta.unit, key, description);
  return {
    ...stringProp("title", json.title),
    ...stringProp("description", description),
    ...("default" in json ? { default: json.default } : {}),
    ...stringProp("marker", json[MARKER_KEY]),
    ...stringProp("unit", unit),
    meta,
  };
}

/** `.meta({ unit })` first; else a key ending in Pct; else "in %" or "(mm)" at the end of the description. */
export function unitOf(metaUnit: unknown, key: string | undefined, description: string | undefined): string | undefined {
  if (typeof metaUnit === "string" && metaUnit.trim() !== "") return metaUnit.trim();
  if (key && /[a-z]Pct$/.test(key)) return "%";
  if (description) {
    const match = /(?:,?\s+in\s+(%|mm|g|N|MPa|pcs)|\((%|mm|g|N|MPa|pcs)\))\.?\s*$/.exec(description);
    if (match) return match[1] ?? match[2];
  }
  return undefined;
}

function withBase(node: FormNode, base: NodeBase): FormNode {
  return {
    ...node,
    ...(base.title !== undefined ? { title: base.title } : {}),
    ...(base.description !== undefined ? { description: base.description } : {}),
    ...("default" in base ? { default: base.default } : {}),
    ...(base.marker !== undefined ? { marker: base.marker } : {}),
    ...(base.unit !== undefined ? { unit: base.unit } : {}),
    meta: { ...node.meta, ...base.meta },
  } as FormNode;
}

function stripBase(node: FormNode): FormNode {
  const rest: Record<string, unknown> = { ...node };
  delete rest.title;
  delete rest.description;
  return rest as FormNode;
}

function jsonNode(json: Json, reason: string): JsonNode {
  return { ...baseOf(json, undefined), kind: "json", reason };
}

function resolveRef(root: Json, ref: string): Json | null {
  if (!ref.startsWith("#/")) return null;
  let current: unknown = root;
  for (const part of ref.slice(2).split("/")) {
    if (!isRecord(current)) return null;
    current = current[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return isRecord(current) ? current : null;
}

/** "locations" names its items "location", for "Add location". */
function singular(key: string | undefined): string | undefined {
  if (!key) return undefined;
  if (/ies$/.test(key)) return `${key.slice(0, -3)}y`;
  if (/(ss|us)$/.test(key)) return key;
  if (/s$/.test(key)) return key.slice(0, -1);
  return key;
}

function isScalar(value: unknown): value is FormScalar {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): Json[] | null {
  return Array.isArray(value) && value.every(isRecord) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function numberProp<K extends string>(name: K, value: unknown): Partial<Record<K, number>> {
  return typeof value === "number" && Number.isFinite(value) ? ({ [name]: value } as Record<K, number>) : {};
}

function stringProp<K extends string>(name: K, value: unknown): Partial<Record<K, string>> {
  return typeof value === "string" && value !== "" ? ({ [name]: value } as Record<K, string>) : {};
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
