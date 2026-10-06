import { describe, expect, it } from "vitest";
import type { ModuleKey, ModuleResult } from "@/lib/schemas/module-result";
import { registryWith, TEST_REGISTRY } from "./__fixtures__/test-registry";
import { stubModule } from "./define";
import { calcOrder, resultsFor } from "./order";

describe("calcOrder", () => {
  it("follows the template's order", () => {
    const keys: ModuleKey[] = ["header", "weight", "glove_info", "order_lots"];
    expect(calcOrder(keys, TEST_REGISTRY)).toEqual(keys);
  });

  it("runs the conclusion after everything, wherever it is listed", () => {
    expect(calcOrder(["conclusion", "weight", "header"], TEST_REGISTRY)).toEqual(["weight", "header", "conclusion"]);
  });

  it("runs a module after the modules it depends on", () => {
    const registry = registryWith({ dimensions: stubModule({ key: "dimensions", title: "Dimension", dependsOn: ["weight"] }) });
    expect(calcOrder(["dimensions", "header", "weight"], registry)).toEqual(["weight", "dimensions", "header"]);
  });

  it("ignores dependencies the inspection does not include", () => {
    const registry = registryWith({ dimensions: stubModule({ key: "dimensions", title: "Dimension", dependsOn: ["tensile"] }) });
    expect(calcOrder(["dimensions", "header"], registry)).toEqual(["dimensions", "header"]);
  });

  it("refuses a dependency loop", () => {
    const registry = registryWith({
      dimensions: stubModule({ key: "dimensions", title: "Dimension", dependsOn: ["tensile"] }),
      tensile: stubModule({ key: "tensile", title: "Physical Properties", dependsOn: ["dimensions"] }),
    });
    expect(() => calcOrder(["dimensions", "tensile"], registry)).toThrow(
      "Module dependencies loop: dimensions -> tensile -> dimensions",
    );
  });
});

describe("resultsFor", () => {
  it("shows a module only the results it depends on", () => {
    const results = new Map<ModuleKey, ModuleResult>([
      ["weight", { status: "warn", summary: "17% below." }],
      ["header", { status: "info", summary: "PO." }],
    ]);
    const keys: ModuleKey[] = ["header", "weight", "glove_info", "conclusion"];
    expect(resultsFor("conclusion", keys, results, TEST_REGISTRY)).toEqual({
      header: { status: "info", summary: "PO." },
      weight: { status: "warn", summary: "17% below." },
    });
    expect(resultsFor("glove_info", keys, results, TEST_REGISTRY)).toEqual({});
  });
});
