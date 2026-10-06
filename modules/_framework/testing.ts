// Test kit for module authors. Import it from tests only:
//   import { checkModuleContract, makeTestContext } from "@/modules/_framework/testing";
import { z } from "zod";
import { ModuleResultSchema, isModuleKey, type ModuleKey } from "@/lib/schemas/module-result";
import {
  JsonObjectSchema,
  LABEL_KEY_PATTERN,
  RESOLVED_TEMPLATE_FORMAT,
  type ResolvedModule,
  type ResolvedTemplate,
} from "@/lib/schemas/template";
import { ValidationIssueSchema } from "@/lib/validation/issues";
import type { AnyModuleDefinition, ModuleRegistry } from "./contract";
import { AQL_DEFAULTS, assertOwnership, EMPTY_SAMPLING, type InspectionContext } from "./context";
import { COMMENT_KEY } from "./data";
import { readPath } from "./paths";

export const TEST_INSPECTOR = { id: "00000000-0000-4000-8000-000000000101", name: "Inspector A" } as const;

const EXAMINATION_SIZES = ["XS", "S", "M", "L", "XL"];

/**
 * A context for calc tests: an examination template with sizes XS to XL,
 * nothing ordered, an inspector recorded and the BUILD_SPEC 7 AQL defaults.
 * Override what the test needs; per-size parts should use ordered sizes.
 */
export function makeTestContext(overrides: Partial<InspectionContext> = {}): InspectionContext {
  return {
    template: { code: "TEST_EG", name: "Test examination gloves", productType: "examination", standard: "EN455", unit: "pcs" },
    templateSizes: EXAMINATION_SIZES.map((value) => ({ value, label: value })),
    sizes: [],
    order: {},
    header: {
      client: null,
      manufacturer: null,
      poNo: null,
      productName: null,
      productCode: null,
      inspectionDate: null,
      mfgDate: null,
      expiryDate: null,
    },
    inspection: { refNo: null, inspector: { ...TEST_INSPECTOR }, client: null, manufacturer: null },
    packing: { innerUnit: null, glovesPerInner: null, innersPerCase: null, glovesPerCase: null },
    sampling: {},
    cartons: {},
    indicativeWeight: null,
    aql: { ...AQL_DEFAULTS },
    ...overrides,
  };
}

/** Sampling values for one size with the rest empty. */
export function makeSampling(values: Partial<typeof EMPTY_SAMPLING>) {
  return { ...EMPTY_SAMPLING, ...values };
}

type TestModuleEntry = ModuleKey | (Partial<ResolvedModule> & { key: ModuleKey });

/**
 * A resolved template for engine tests: each module with its defaults from
 * `registry` unless the entry overrides them. Header and conclusion are added
 * when missing.
 */
export function makeTestTemplate(
  registry: ModuleRegistry,
  entries: readonly TestModuleEntry[],
  overrides: Partial<ResolvedTemplate> = {},
): ResolvedTemplate {
  const listed = entries.map((entry) => (typeof entry === "string" ? { key: entry } : entry));
  const keys = listed.map((entry) => entry.key);
  const all = [
    ...(keys.includes("header") ? [] : [{ key: "header" as const }]),
    ...listed,
    ...(keys.includes("conclusion") ? [] : [{ key: "conclusion" as const }]),
  ];
  return {
    format: RESOLVED_TEMPLATE_FORMAT,
    code: "TEST_EG",
    name: "Test examination gloves",
    chain: ["TEST_EG"],
    scope: { productType: "examination", standard: "EN455" },
    unit: "pcs",
    sizes: EXAMINATION_SIZES.map((value) => ({ value, label: value })),
    modules: all.map((entry) => {
      const definition = registry[entry.key];
      return {
        key: entry.key,
        include: entry.include ?? true,
        title: entry.title ?? definition.title,
        labels: entry.labels ?? { ...definition.labels },
        config: entry.config ?? (definition.defaultConfig as ResolvedModule["config"]),
        ...(entry.override ? { override: entry.override } : {}),
      };
    }),
    customModules: [],
    report: { title: "Test examination gloves", showClientLogo: false },
    sourceFile: null,
    ...overrides,
  };
}

const CalcIssuesSchema = z.array(ValidationIssueSchema.omit({ moduleKey: true }));

/**
 * What a module must satisfy to plug into the framework. Returns one line per
 * problem; a module test asserts `toEqual([])`. The registry test runs it on
 * every module.
 */
export function checkModuleContract(definition: AnyModuleDefinition): string[] {
  const problems: string[] = [];
  const add = (message: string) => problems.push(`${definition.key}: ${message}`);

  if (!isModuleKey(definition.key)) add("key is not a module key of lib/schemas/module-result.ts");
  if (definition.title.trim() === "") add("title is empty");
  for (const [key, label] of Object.entries(definition.labels)) {
    if (!LABEL_KEY_PATTERN.test(key)) add(`label key "${key}" is not a canonical key or a dotted path of them`);
    if (label.trim() === "") add(`label "${key}" is empty`);
  }

  const config = definition.configSchema.safeParse(definition.defaultConfig);
  if (!config.success) add(`defaultConfig does not match configSchema: ${firstIssue(config.error)}`);
  if (!isPlainJson(definition.defaultConfig)) add("defaultConfig is not plain JSON");
  try {
    z.toJSONSchema(definition.configSchema);
  } catch (error) {
    add(`configSchema cannot become JSON Schema, which the template editor needs: ${messageOf(error)}`);
  }

  const empty = definition.emptyData();
  if (typeof empty === "object" && empty !== null && empty === definition.emptyData()) {
    add("emptyData() returns the same object twice; return a new one each call");
  }
  const data = definition.dataSchema.safeParse(empty);
  if (!data.success) add(`emptyData() does not match dataSchema: ${firstIssue(data.error)}`);
  if (!isPlainJson(empty)) add("emptyData() is not plain JSON");
  if (isRecord(empty) && COMMENT_KEY in empty) add(`"${COMMENT_KEY}" is reserved for the inspector comment`);
  if (definition.perSize && !(isRecord(empty) && isRecord(empty.sizes))) {
    add("a per-size module keeps its data under `sizes` (use perSizeData)");
  }

  if (definition.dependsOn !== "all") {
    for (const dependency of definition.dependsOn) {
      if (!isModuleKey(dependency)) add(`dependsOn names "${dependency}", which is not a module`);
      if (dependency === definition.key) add("depends on itself");
    }
  }

  const paths = new Set<string>();
  for (const canonical of definition.canonicalPaths) {
    if (paths.has(canonical.path)) add(`canonical path "${canonical.path}" is listed twice`);
    paths.add(canonical.path);
    if (readPath(empty, canonical.path.split(".")) === undefined) {
      add(`canonical path "${canonical.path}" is not in emptyData()`);
    }
  }

  if (config.success && data.success) {
    try {
      const output = definition.calc({
        data: data.data,
        config: config.data,
        title: definition.title,
        labels: definition.labels,
        context: makeTestContext({ sizes: ["M"] }),
        results: {},
        hasData: false,
      });
      const result = ModuleResultSchema.safeParse(output.result);
      if (!result.success) add(`calc returns an invalid result: ${firstIssue(result.error)}`);
      else if (result.data.status !== "not_done") {
        add(`calc on empty data says "${result.data.status}": missing data is not done (BUILD_SPEC 6.2 rule 5)`);
      }
      if (!JsonObjectSchema.safeParse(output.computed).success) add("calc returns computed values that are not a JSON object");
      if (!CalcIssuesSchema.safeParse(output.issues).success) add("calc returns malformed issues");
      if (definition.contribute) assertOwnership(definition.key, definition.contribute({ data: data.data, config: config.data }));
    } catch (error) {
      add(`calc or contribute throws on empty data: ${messageOf(error)}`);
    }
  }
  return problems;
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}` : "invalid";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Survives JSON unchanged: no undefined, NaN, Infinity, Date, Map or class instance anywhere. */
function isPlainJson(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isPlainJson);
  if (isRecord(value)) {
    const prototype = Object.getPrototypeOf(value);
    return (prototype === Object.prototype || prototype === null) && Object.values(value).every(isPlainJson);
  }
  return false;
}
