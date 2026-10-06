import { describe, expect, it } from "vitest";
import {
  ALWAYS_ON_MODULE_KEYS,
  isModuleKey,
  MODULE_KEYS,
  ModuleKeySchema,
  ModuleResultSchema,
  OPTIONAL_MODULE_KEYS,
  REPORT_MODULE_KEYS,
} from "./module-result";

describe("module keys", () => {
  it("lists every module in BUILD_SPEC 6.1 once", () => {
    expect(REPORT_MODULE_KEYS).toHaveLength(16);
    expect(OPTIONAL_MODULE_KEYS).toEqual(["dye_leak", "documents", "loading"]);
    expect(new Set(MODULE_KEYS).size).toBe(MODULE_KEYS.length);
    expect(MODULE_KEYS).toEqual(expect.arrayContaining(["dispensing_safedon", "force_at_break", "tensile", "labeling"]));
    expect(ALWAYS_ON_MODULE_KEYS).toEqual(["header", "conclusion"]);
  });

  it("rejects keys outside the library", () => {
    expect(ModuleKeySchema.safeParse("visual").success).toBe(true);
    expect(ModuleKeySchema.safeParse("labelling").success).toBe(false);
    expect(isModuleKey("weight")).toBe(true);
    expect(isModuleKey("custom_notes")).toBe(false);
  });
});

describe("ModuleResultSchema", () => {
  it("accepts a result with and without per-size results", () => {
    expect(ModuleResultSchema.safeParse({ status: "info", summary: "" }).success).toBe(true);
    expect(
      ModuleResultSchema.safeParse({
        status: "warn",
        summary: "Size M is 17% below the indicative weight.",
        perSize: { M: { status: "warn", summary: "17% below" }, "7.0": { status: "pass" } },
      }).success,
    ).toBe(true);
  });

  it("rejects unknown statuses, at module and size level", () => {
    expect(ModuleResultSchema.safeParse({ status: "passed", summary: "" }).success).toBe(false);
    expect(ModuleResultSchema.safeParse({ status: "pass", summary: "", perSize: { M: { status: "ok" } } }).success).toBe(
      false,
    );
  });

  it("requires a summary and a non-empty size key", () => {
    expect(ModuleResultSchema.safeParse({ status: "pass" }).success).toBe(false);
    expect(ModuleResultSchema.safeParse({ status: "pass", summary: "", perSize: { "": { status: "pass" } } }).success).toBe(
      false,
    );
  });
});
