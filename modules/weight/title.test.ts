import { describe, expect, it } from "vitest";
import type { SamplingValues } from "@/modules/_framework";
import { makeSampling, makeTestContext } from "@/modules/_framework/testing";
import { templateConfig } from "./__fixtures__/examples";
import { WEIGHT_TITLE } from "./config";
import { weightTitle } from "./title";

const STD_EG = templateConfig("STD_EG");
/** STD_EG version 1's wording, still on older drafts. */
const V1_TITLE = "Weight (g) - average of 13 gloves per size";

/** Sizes ordered with the sampling plan's gloves for dimension (null: the cell is empty). */
function planned(dimensions: Record<string, number | null>) {
  const sampling: Record<string, SamplingValues> = Object.fromEntries(
    Object.entries(dimensions).map(([size, count]) => [size, makeSampling({ dimensions: count })]),
  );
  return makeTestContext({ sizes: Object.keys(dimensions), sampling });
}

describe("weightTitle: the title names the gloves this inspection weighs", () => {
  it("says 12 when every ordered size weighs the plan's 12 gloves for dimension", () => {
    expect(weightTitle({ title: WEIGHT_TITLE, config: STD_EG, context: planned({ M: 12 }) })).toBe(
      "Weight (g) - Average of 12 Gloves per Size",
    );
  });

  it("keeps version 1's lowercase wording", () => {
    expect(weightTitle({ title: V1_TITLE, config: STD_EG, context: planned({ M: 12 }) })).toBe(
      "Weight (g) - average of 12 gloves per size",
    );
  });

  it("lists the counts when sizes weigh different numbers, smallest first", () => {
    expect(weightTitle({ title: WEIGHT_TITLE, config: STD_EG, context: planned({ M: 13, XS: 8 }) })).toBe(
      "Weight (g) - Average of 8 or 13 Gloves per Size",
    );
    expect(weightTitle({ title: WEIGHT_TITLE, config: STD_EG, context: planned({ XS: 5, S: 8, M: 13, L: 8 }) })).toBe(
      "Weight (g) - Average of 5, 8 or 13 Gloves per Size",
    );
  });

  it("takes the template's n for a size whose plan gives no number yet", () => {
    expect(weightTitle({ title: WEIGHT_TITLE, config: STD_EG, context: planned({ M: null }) })).toBe(WEIGHT_TITLE);
    expect(weightTitle({ title: WEIGHT_TITLE, config: STD_EG, context: planned({ S: null, M: 12 }) })).toBe(
      "Weight (g) - Average of 12 or 13 Gloves per Size",
    );
  });

  it("says Glove for a lone 1", () => {
    expect(weightTitle({ title: WEIGHT_TITLE, config: { ...STD_EG, n: 1 }, context: planned({ M: 13 }) })).toBe(
      "Weight (g) - Average of 1 Glove per Size",
    );
  });

  it("takes the template's n before any size is ordered", () => {
    expect(weightTitle({ title: WEIGHT_TITLE, config: { ...STD_EG, n: 10 }, context: makeTestContext() })).toBe(
      "Weight (g) - Average of 10 Gloves per Size",
    );
  });

  it("leaves out a size with no gloves for dimension beside the others; 0 only when every size has none", () => {
    expect(weightTitle({ title: WEIGHT_TITLE, config: STD_EG, context: planned({ S: 0, M: 12 }) })).toBe(
      "Weight (g) - Average of 12 Gloves per Size",
    );
    expect(weightTitle({ title: WEIGHT_TITLE, config: STD_EG, context: planned({ M: 0 }) })).toBe(
      "Weight (g) - Average of 0 Gloves per Size",
    );
  });

  it("leaves a title without a count as it is (SAFEDON_EG)", () => {
    expect(weightTitle({ title: "Weight (g)", config: templateConfig("SAFEDON_EG"), context: planned({ M: 13 }) })).toBe(
      "Weight (g)",
    );
  });
});
