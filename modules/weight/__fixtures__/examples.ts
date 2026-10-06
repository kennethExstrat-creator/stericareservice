// The example reports (tests/fixtures/examples) in this module's shapes: the
// weights as data, the ordered sizes and the indicative weight as a context,
// and each seed template's config and wording (lib/coverage).
import { labelOverrides, moduleConfig, moduleTitle, type TemplateCode } from "@/lib/coverage";
import type { InspectionContext } from "@/modules/_framework";
import { makeTestContext } from "@/modules/_framework/testing";
import type { ExampleReport, PerSize, WeightEntry } from "@/tests/fixtures/examples";
import { WEIGHT_LABELS, WeightConfigSchema, type WeightConfig } from "../config";
import type { WeightData } from "../schema";

/**
 * The report's weights as module data. STD_EG prints only the average of its
 * 13 gloves, so 13 gloves of that weight stand in for them (docs/FIXTURES.md).
 */
export function weightData(entries: PerSize<WeightEntry>): WeightData {
  const sizes = Object.entries(entries).map(([size, entry]) => [
    size,
    { values: [...(entry.values ?? Array.from({ length: entry.gloves }, () => entry.averageG))] },
  ]);
  return { sizes: Object.fromEntries(sizes) };
}

/** The example's ordered sizes and its indicative weight, for the size its template gives it for. */
export function exampleContext(example: ExampleReport, overrides: Partial<InspectionContext> = {}): InspectionContext {
  const size = moduleConfig(example.template, "glove_info")?.indicativeWeightSize ?? "M";
  return makeTestContext({
    sizes: [...example.sizesOrdered],
    indicativeWeight: { grams: example.gloveInfo.indicativeWeightG, size },
    ...overrides,
  });
}

/** The seed template's weight config, as the module parses it. */
export function templateConfig(code: TemplateCode): WeightConfig {
  return WeightConfigSchema.parse(moduleConfig(code, "weight"));
}

/** The seed template's wording over the module's defaults (effectiveLabels). */
export function templateLabels(code: TemplateCode): Record<string, string> {
  return { ...WEIGHT_LABELS, ...labelOverrides(code, "weight") };
}

export function templateTitle(code: TemplateCode): string {
  return moduleTitle(code, "weight");
}
