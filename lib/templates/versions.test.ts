import { describe, expect, it } from "vitest";
import { TEST_CLIENT_ID, TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { baseEg, clientEg } from "./__fixtures__/definitions";
import { lookupFrom, resolveTemplateOrThrow } from "./resolve";
import { nextVersion, planActivation, planTemplateEdit, templateRowFields, type VersionRow } from "./versions";

describe("nextVersion", () => {
  it("is one more than the highest version, 1 for a new code", () => {
    expect(nextVersion([])).toBe(1);
    expect(nextVersion([1, 3, 2])).toBe(4);
  });
});

describe("planTemplateEdit (BUILD_SPEC 4.2 rule 8)", () => {
  it("edits an unused draft in place", () => {
    expect(planTemplateEdit({ id: "t1", status: "draft", inUse: false }, [1])).toEqual({ kind: "update", id: "t1" });
  });

  it("makes a new version of anything an inspection uses or inspectors start from", () => {
    expect(planTemplateEdit({ id: "t1", status: "active", inUse: false }, [1])).toEqual({ kind: "new_version", version: 2 });
    expect(planTemplateEdit({ id: "t1", status: "draft", inUse: true }, [1, 2])).toEqual({ kind: "new_version", version: 3 });
    expect(planTemplateEdit({ id: "t1", status: "retired", inUse: true }, [1, 2])).toEqual({ kind: "new_version", version: 3 });
  });
});

describe("planActivation", () => {
  const row = (overrides: Partial<VersionRow>): VersionRow => ({
    id: "v1",
    version: 1,
    status: "draft",
    coverageConfirmedAt: "2026-10-06T08:00:00.000Z",
    resolved: { format: 1 },
    ...overrides,
  });

  it("retires the active version, then activates the new one", () => {
    const versions = [row({ id: "v1", status: "active" }), row({ id: "v2", version: 2 })];
    expect(planActivation(versions, "v2")).toEqual({ ok: true, retire: ["v1"], activate: "v2" });
  });

  it("needs the field coverage checklist confirmed (rule 10)", () => {
    expect(planActivation([row({ coverageConfirmedAt: null })], "v1")).toEqual({
      ok: false,
      message: expect.stringContaining("coverage checklist"),
    });
  });

  it("needs a version that resolved, and one that exists", () => {
    expect(planActivation([row({ resolved: null })], "v1")).toMatchObject({ ok: false });
    expect(planActivation([row({})], "v9")).toMatchObject({ ok: false });
  });
});

describe("templateRowFields", () => {
  it("fills the templates columns from the definition and its resolution", () => {
    const definition = clientEg();
    const resolved = resolveTemplateOrThrow(definition, { getBase: lookupFrom([baseEg()]), registry: TEST_REGISTRY });
    expect(templateRowFields(definition, resolved)).toEqual({
      code: "CLIENT_EG",
      extends_code: "BASE_EG",
      product_type: "examination",
      standard: "ASTM_D6319",
      client_id: TEST_CLIENT_ID,
      manufacturer_id: null,
      definition,
      resolved,
      source_file_path: null,
    });
  });
});
