import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODULE_KEYS } from "@/lib/schemas/module-result";
import { calcOrder, NOT_BUILT_SUMMARY } from "./_framework";
import { checkModuleContract, makeTestContext } from "./_framework/testing";
import { getModuleDefinition, MODULE_REGISTRY } from "./registry";

const MODULES_DIR = fileURLToPath(new URL("./", import.meta.url));

describe("module registry", () => {
  it("maps every module key to that module's definition", () => {
    expect(Object.keys(MODULE_REGISTRY).sort()).toEqual([...MODULE_KEYS].sort());
    for (const key of MODULE_KEYS) expect(getModuleDefinition(key).key).toBe(key);
  });

  it("has one folder with an index.ts per module key, and nothing else besides the framework", () => {
    const folders = readdirSync(MODULES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "_framework")
      .map((entry) => entry.name)
      .sort();
    expect(folders).toEqual([...MODULE_KEYS].sort());
    for (const key of MODULE_KEYS) expect(existsSync(`${MODULES_DIR}${key}/index.ts`)).toBe(true);
  });

  it.each(MODULE_KEYS)("%s satisfies the module contract", (key) => {
    expect(checkModuleContract(MODULE_REGISTRY[key])).toEqual([]);
  });

  it("makes submit wait for the conclusion, which holds the final result, and for no other module", () => {
    const required = Object.values(MODULE_REGISTRY)
      .filter((definition) => definition.requiredForSubmit)
      .map((definition) => definition.key);
    expect(required).toEqual(["conclusion"]);
  });

  it("orders all modules without a dependency loop, the conclusion last", () => {
    const order = calcOrder(MODULE_KEYS, MODULE_REGISTRY);
    expect([...order].sort()).toEqual([...MODULE_KEYS].sort());
    expect(order.at(-1)).toBe("conclusion");
  });

  it("marks placeholders as not built yet", () => {
    const stubs = Object.values(MODULE_REGISTRY).filter((definition) => definition.stub);
    for (const stub of stubs) {
      const output = stub.calc({
        data: stub.emptyData(),
        config: stub.defaultConfig,
        title: stub.title,
        labels: stub.labels,
        context: makeTestContext({ sizes: ["M"] }),
        results: {},
        hasData: true,
      });
      expect(output.result).toEqual({ status: "not_done", summary: NOT_BUILT_SUMMARY });
    }
    expect(MODULE_REGISTRY.glove_info.stub).toBe(false);
  });
});
