import { describe, expect, it } from "vitest";
import type { CustomModule } from "@/lib/schemas/template";
import { TEST_ADMIN_ID, TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { makeTestTemplate } from "@/modules/_framework/testing";
import { sectionOrder, templateSections } from "./sections";

function custom(key: string, after: CustomModule["after"]): CustomModule {
  return { key, title: key, after, layout: "fields", fields: [{ key: "note", label: "Note", type: "text" }] };
}

describe("templateSections", () => {
  it("puts each custom module right after its module, in list order", () => {
    const template = makeTestTemplate(TEST_REGISTRY, ["glove_info", "weight"], {
      customModules: [custom("after_weight", "weight"), custom("after_header", "header"), custom("also_after_weight", "weight")],
    });
    expect(sectionOrder(template)).toEqual([
      "header",
      "after_header",
      "glove_info",
      "weight",
      "after_weight",
      "also_after_weight",
      "conclusion",
    ]);
    expect(templateSections(template)[1]).toMatchObject({ kind: "custom", key: "after_header" });
  });

  it("keeps a custom module in place when its module is switched off, and puts an orphan last", () => {
    const template = makeTestTemplate(
      TEST_REGISTRY,
      [
        "glove_info",
        { key: "weight", override: { reason: "Scale broken", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" }, include: false },
      ],
      { customModules: [custom("after_weight", "weight"), custom("after_tensile", "tensile")] },
    );
    expect(sectionOrder(template)).toEqual(["header", "glove_info", "after_weight", "conclusion", "after_tensile"]);
  });
});
