import { describe, expect, it } from "vitest";
import { z } from "zod";
import { registryWith, TEST_REGISTRY } from "./__fixtures__/test-registry";
import type { CalcOutput, CaptureProps, ModuleRegistry } from "./contract";
import { defineModule, NOT_BUILT_SUMMARY, stubModule } from "./define";
import { checkModuleContract, makeTestContext } from "./testing";

function validModule() {
  return defineModule({
    key: "documents",
    title: "Documents",
    labels: { coa: "Certificate of analysis" },
    dataSchema: z.strictObject({ coa: z.boolean().nullable().default(null) }),
    emptyData: () => ({ coa: null }),
    configSchema: z.strictObject({ required: z.array(z.string()) }),
    defaultConfig: { required: ["coa"] },
    canonicalPaths: [{ path: "coa", label: "Certificate of analysis", type: "yes_no" }],
    calc: ({ data }): CalcOutput => ({
      result: data.coa === null ? { status: "not_done", summary: "Not done." } : { status: data.coa ? "pass" : "fail", summary: "" },
      computed: {},
      issues: [],
    }),
  });
}

describe("defineModule", () => {
  it("fills in what most modules do not need", () => {
    expect(validModule()).toMatchObject({
      perSize: false,
      handSplit: false,
      dependsOn: [],
      stub: false,
    });
    expect(checkModuleContract(validModule())).toEqual([]);
  });

  it("takes a typed capture component and still fits the registry", async () => {
    type Data = { coa: boolean | null };
    type Config = { required: string[] };
    const seen: Data[] = [];
    // Stands in for `export default function Capture(props: CaptureProps<...>)` in Capture.tsx.
    const Capture = (props: CaptureProps<Data, Config>) => {
      seen.push(props.data);
      props.onChange({ coa: true });
      return null;
    };
    const definition = defineModule({ ...validModule(), loadCapture: async () => ({ default: Capture }) });
    const registry: ModuleRegistry = registryWith({ documents: definition });

    const loaded = await registry.documents.loadCapture?.();
    const changes: unknown[] = [];
    loaded?.default({
      data: { coa: null },
      config: { required: [] },
      title: "Documents",
      labels: {},
      context: makeTestContext(),
      evaluation: null,
      focusPath: null,
      readOnly: false,
      onChange: (next) => changes.push(next),
    });
    expect(seen).toEqual([{ coa: null }]);
    expect(changes).toEqual([{ coa: true }]);
  });
});

describe("stubModule", () => {
  it("is not built yet and never done", () => {
    const stub = stubModule({ key: "dimensions", title: "Dimension", perSize: true });
    expect(stub).toMatchObject({ key: "dimensions", title: "Dimension", perSize: true, stub: true, labels: {} });
    expect(stub.emptyData()).toEqual({ sizes: {} });
    const output = stub.calc({
      data: stub.emptyData(),
      config: {},
      title: "Dimension",
      labels: {},
      context: makeTestContext({ sizes: ["M"] }),
      results: {},
      hasData: true,
    });
    expect(output).toEqual({ result: { status: "not_done", summary: NOT_BUILT_SUMMARY }, computed: {}, issues: [] });
    expect(checkModuleContract(stub)).toEqual([]);
  });

  it("accepts any JSON config and data until the module is built", () => {
    const stub = stubModule({ key: "dimensions", title: "Dimension", perSize: true });
    expect(stub.configSchema.safeParse({ statistic: "median", measures: ["length", "width"] }).success).toBe(true);
    expect(stub.dataSchema.safeParse({ sizes: { M: [{ length: 245 }] }, labReport: null }).success).toBe(true);
    expect(stub.configSchema.safeParse({ when: new Date() }).success).toBe(false);
  });
});

describe("checkModuleContract", () => {
  it("passes every test double", () => {
    for (const definition of Object.values(TEST_REGISTRY)) expect(checkModuleContract(definition)).toEqual([]);
  });

  it.each([
    ["a default config its schema rejects", { defaultConfig: { required: "coa" } }, "defaultConfig does not match configSchema"],
    ["empty data its schema rejects", { emptyData: () => ({ coa: "yes" }) }, "emptyData() does not match dataSchema"],
    ["a shared empty record", { emptyData: ((shared) => () => shared)({ coa: null }) }, "returns the same object twice"],
    ["a per-size module without sizes", { perSize: true }, "keeps its data under `sizes`"],
    ["a pass on empty data", { calc: () => ({ result: { status: "pass", summary: "" }, computed: {}, issues: [] }) }, "missing data is not done"],
    ["a reserved comment field", { emptyData: () => ({ coa: null, comment: null }) }, "reserved for the inspector comment"],
    ["a canonical path missing from the data", { canonicalPaths: [{ path: "iso", label: "ISO", type: "text" }] }, 'canonical path "iso" is not in emptyData()'],
    ["a config schema the editor cannot render", { configSchema: z.string().transform((value) => value.length), defaultConfig: "abc" }, "cannot become JSON Schema"],
    ["a dependency on itself", { dependsOn: ["documents"] }, "depends on itself"],
    ["a contribution it does not own", { contribute: () => ({ sizes: ["M"] }) }, "which only order_lots may provide"],
    ["a non-JSON default", { configSchema: z.any(), defaultConfig: { at: new Date(0) } }, "defaultConfig is not plain JSON"],
    ["a malformed issue", { calc: () => ({ result: { status: "not_done", summary: "" }, computed: {}, issues: [{ level: "fatal" }] }) }, "malformed issues"],
    ["a malformed label key", { labels: { "minor.": "Defective beads" } }, 'label key "minor." is not a canonical key'],
  ])("flags %s", (_name, change, message) => {
    const broken = { ...validModule(), ...change } as unknown as Parameters<typeof checkModuleContract>[0];
    expect(checkModuleContract(broken)).toEqual(expect.arrayContaining([expect.stringContaining(message)]));
  });

  it("accepts label keys for one class or level", () => {
    const labelled = { ...validModule(), labels: { bead_defective: "Defective bead", "minor.bead_defective": "Defective beads" } };
    expect(checkModuleContract(labelled)).toEqual([]);
  });
});
