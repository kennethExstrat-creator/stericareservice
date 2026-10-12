import { describe, expect, it } from "vitest";
import type { ModuleOverrides, ResolvedTemplate } from "@/lib/schemas/template";
import { fillGloveCount, moduleTitle } from "@/modules/_framework";
import { registryWith } from "@/modules/_framework/__fixtures__/test-registry";
import { filledData, TEST_ADMIN_ID, TEST_META, TEST_REGISTRY, testTemplate } from "./__fixtures__/capture";
import { evaluateCapture, storedTemplateWithShownTitles } from "./evaluate";

/** Weight names how many sizes are ordered, standing in for the gloves it weighs (filledData orders two). */
const COUNTING = registryWith({
  weight: { ...TEST_REGISTRY.weight, shownTitle: ({ title, context }) => fillGloveCount(title, [context.sizes.length]) },
});
const OFF: ModuleOverrides = { weight: { reason: "Scale out of calibration.", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" } };

/** The test template with a count in weight's title. */
function titled(): ResolvedTemplate {
  const template = testTemplate();
  return {
    ...template,
    modules: template.modules.map((entry) => (entry.key === "weight" ? { ...entry, title: "Weight of 13 gloves" } : entry)),
  };
}

const weightOf = (template: ResolvedTemplate) => template.modules.find((entry) => entry.key === "weight");

describe("evaluateCapture: titles as the inspection shows them", () => {
  it("names weight by its count on the template, in the context and in its result", () => {
    const { template, context, report } = evaluateCapture(
      { template: titled(), overrides: {}, data: filledData(), meta: TEST_META },
      COUNTING,
    );
    expect(weightOf(template)?.title).toBe("Weight of 2 gloves");
    expect(moduleTitle(context, "weight")).toBe("Weight of 2 gloves");
    expect(report.modules.find((entry) => entry.key === "weight")?.title).toBe("Weight of 2 gloves");
  });

  it("names a module switched off for the inspection the same way", () => {
    const { report } = evaluateCapture({ template: titled(), overrides: OFF, data: filledData(), meta: TEST_META }, COUNTING);
    expect(report.excluded).toEqual([{ key: "weight", title: "Weight of 2 gloves", reason: "Scale out of calibration." }]);
  });
});

describe("storedTemplateWithShownTitles", () => {
  it("fills the titles on the template as stored, without the inspection's overrides", () => {
    const stored = titled();
    const shown = storedTemplateWithShownTitles({ template: stored, overrides: OFF, data: filledData() }, COUNTING);
    expect(weightOf(shown)).toEqual({ ...weightOf(stored), title: "Weight of 2 gloves" });
    expect(weightOf(shown)?.include).toBe(true);
    expect(weightOf(stored)?.title).toBe("Weight of 13 gloves");
  });
});
