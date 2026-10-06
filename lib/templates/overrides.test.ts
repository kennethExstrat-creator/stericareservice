import { describe, expect, it } from "vitest";
import type { ModuleOverride, ResolvedTemplate } from "@/lib/schemas/template";
import { TEST_ADMIN_ID, TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { baseEg, clientEg } from "./__fixtures__/definitions";
import {
  applyModuleOverrides,
  excludedForInspection,
  includedModules,
  moduleOverrideProblem,
  parseModuleOverrides,
} from "./overrides";
import { lookupFrom, resolveTemplateOrThrow } from "./resolve";

const OVERRIDE: ModuleOverride = { reason: "Lab report not available for this lot", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" };

function client(): ResolvedTemplate {
  return resolveTemplateOrThrow(clientEg(), { getBase: lookupFrom([baseEg()]), registry: TEST_REGISTRY });
}

describe("applyModuleOverrides (BUILD_SPEC 4.4)", () => {
  it("switches a module off for the inspection and keeps the reason", () => {
    const template = applyModuleOverrides(client(), { tensile: OVERRIDE });
    const tensile = template.modules.find((module) => module.key === "tensile");
    expect(tensile).toMatchObject({ include: false, override: OVERRIDE });
    expect(includedModules(template).map((module) => module.key)).not.toContain("tensile");
    expect(excludedForInspection(template)).toEqual([{ key: "tensile", title: "Physical Properties", reason: OVERRIDE.reason }]);
  });

  it("never switches off header or conclusion, nor lists a module the template already excludes", () => {
    const template = applyModuleOverrides(client(), { header: OVERRIDE, conclusion: OVERRIDE, force_at_break: OVERRIDE });
    expect(template).toEqual(client());
    expect(excludedForInspection(template)).toEqual([]);
  });

  it("returns the template itself without overrides", () => {
    const template = client();
    expect(applyModuleOverrides(template, {})).toBe(template);
    expect(applyModuleOverrides(template, null)).toBe(template);
  });
});

describe("moduleOverrideProblem", () => {
  it("explains what an admin cannot switch off", () => {
    const template = client();
    expect(moduleOverrideProblem(template, "weight")).toBeNull();
    expect(moduleOverrideProblem(template, "header")).toContain("always on");
    expect(moduleOverrideProblem(template, "force_at_break")).toContain("already off");
    expect(moduleOverrideProblem(template, "dye_leak")).toContain("not part of template CLIENT_EG");
    expect(moduleOverrideProblem(template, "labelling")).toBe("labelling is not a module.");
  });
});

describe("parseModuleOverrides", () => {
  it("keeps valid entries of a stored value and drops the rest", () => {
    expect(
      parseModuleOverrides({
        tensile: OVERRIDE,
        weight: { reason: "", by: TEST_ADMIN_ID, at: OVERRIDE.at },
        labelling: OVERRIDE,
      }),
    ).toEqual({ tensile: OVERRIDE });
    expect(parseModuleOverrides(null)).toEqual({});
    expect(parseModuleOverrides([OVERRIDE])).toEqual({});
  });
});
