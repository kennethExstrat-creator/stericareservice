import { describe, expect, it } from "vitest";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import { registryWith, TEST_REGISTRY } from "./__fixtures__/test-registry";
import type { AnyModuleDefinition, TitleInput } from "./contract";
import { buildInspectionContext } from "./context";
import type { InspectionData } from "./data";
import { makeTestTemplate } from "./testing";
import { buildInspectionView, withShownTitles } from "./titles";

const WEIGHT = "Weight (g) - Average of 13 Gloves per Size";
const NO_DATA: InspectionData = { modules: {}, custom: {} };

/** A test hook's wording: the title's first count of gloves becomes `count`. */
const withCount = (title: string, count: number) => title.replace(/\d+(?=\s+gloves?\b)/i, String(count));

/** The test module with a title hook. */
function withHook(key: "weight" | "dimensions", shownTitle: (input: TitleInput<unknown>) => string): AnyModuleDefinition {
  return { ...TEST_REGISTRY[key], shownTitle };
}

/** Weight titled with a count, weighing `n`; dimensions switched off with a count in its title too. */
function template(n: number | string = 12): ResolvedTemplate {
  return makeTestTemplate(TEST_REGISTRY, [
    { key: "dimensions", include: false, title: "Dimension of 13 gloves" },
    { key: "weight", title: WEIGHT, config: { n, warnThresholdPct: 10 } },
  ]);
}

/** Weight fills in its config's n; dimensions fills in 5. */
const HOOKED = registryWith({
  weight: withHook("weight", ({ title, config }) => withCount(title, (config as { n: number }).n)),
  dimensions: withHook("dimensions", ({ title }) => withCount(title, 5)),
});

const titleOf = (modules: readonly { key: string; title: string }[] | undefined, key: string) =>
  modules?.find((entry) => entry.key === key)?.title;

describe("withShownTitles", () => {
  it("fills every module's title, switched off ones included, on the template and in the context alike", () => {
    const stored = template();
    const context = buildInspectionContext({ template: stored, data: NO_DATA }, HOOKED);
    const view = withShownTitles(stored, context, HOOKED);
    expect(titleOf(view.template.modules, "weight")).toBe("Weight (g) - Average of 12 Gloves per Size");
    expect(titleOf(view.context.modules, "weight")).toBe("Weight (g) - Average of 12 Gloves per Size");
    expect(titleOf(view.template.modules, "dimensions")).toBe("Dimension of 5 gloves");
    // Switched off: not among the modules the context lists.
    expect(titleOf(view.context.modules, "dimensions")).toBeUndefined();
    // The stored template is left as it was.
    expect(titleOf(stored.modules, "weight")).toBe(WEIGHT);
  });

  it("copies only the entries that change, so configs keep their references", () => {
    const stored = template();
    const view = withShownTitles(stored, buildInspectionContext({ template: stored, data: NO_DATA }, HOOKED), HOOKED);
    const weight = (modules: ResolvedTemplate["modules"]) => modules.find((entry) => entry.key === "weight");
    expect(weight(view.template.modules)).not.toBe(weight(stored.modules));
    expect(weight(view.template.modules)?.config).toBe(weight(stored.modules)?.config);
    const header = (modules: ResolvedTemplate["modules"]) => modules.find((entry) => entry.key === "header");
    expect(header(view.template.modules)).toBe(header(stored.modules));
  });

  it("gives back the very same objects when no title changes", () => {
    const stored = template(13);
    const context = buildInspectionContext({ template: stored, data: NO_DATA }, HOOKED);
    const unchanged = withShownTitles(
      stored,
      context,
      registryWith({ weight: withHook("weight", ({ title, config }) => withCount(title, (config as { n: number }).n)) }),
    );
    expect(unchanged.template).toBe(stored);
    expect(unchanged.context).toBe(context);
    const noHooks = withShownTitles(stored, context, TEST_REGISTRY);
    expect(noHooks.template).toBe(stored);
    expect(noHooks.context).toBe(context);
  });

  it("keeps the stored title when the hook throws, answers blank, or the config does not parse", () => {
    const stored = template();
    const context = buildInspectionContext({ template: stored, data: NO_DATA }, TEST_REGISTRY);
    const throwing = registryWith({
      weight: withHook("weight", () => {
        throw new Error("broken hook");
      }),
    });
    const blank = registryWith({ weight: withHook("weight", () => "  ") });
    for (const registry of [throwing, blank]) {
      expect(titleOf(withShownTitles(stored, context, registry).template.modules, "weight")).toBe(WEIGHT);
    }
    const invalid = template("twelve");
    expect(titleOf(withShownTitles(invalid, context, HOOKED).template.modules, "weight")).toBe(WEIGHT);
  });
});

describe("buildInspectionView", () => {
  it("fills the titles from the complete context, every contribution in", () => {
    const sizes = registryWith({
      weight: withHook("weight", ({ title, context }) => withCount(title, context.sizes.length)),
    });
    const data: InspectionData = {
      modules: {
        order_lots: {
          lots: [
            { size: "S", qtyCases: 10, lotNumbers: [] },
            { size: "M", qtyCases: 20, lotNumbers: [] },
          ],
        },
      },
      custom: {},
    };
    const withOrder = makeTestTemplate(sizes, ["order_lots", { key: "weight", title: WEIGHT }]);
    const view = buildInspectionView({ template: withOrder, data }, sizes);
    expect(view.context.sizes).toEqual(["S", "M"]);
    expect(titleOf(view.template.modules, "weight")).toBe("Weight (g) - Average of 2 Gloves per Size");
    expect(titleOf(view.context.modules, "weight")).toBe("Weight (g) - Average of 2 Gloves per Size");
  });
});
