import { describe, expect, it } from "vitest";
import { makeTestContext } from "@/modules/_framework/testing";
import { templateConfig } from "./__fixtures__/examples";
import { WEIGHT_TITLE } from "./config";
import { weightTitle } from "./title";

const STD_EG = templateConfig("STD_EG");
const ORDERED = makeTestContext({ sizes: ["S", "M"] });
/** STD_EG version 1's wording, still on older drafts. */
const V1_TITLE = "Weight (g) - average of 13 gloves per size";

describe("weightTitle: one average per size names no count of gloves (Kenneth, 26 October 2026)", () => {
  it("reads STD_EG's 'Weight (g) - Average of 13 Gloves per Size' as 'Weight (g)', whatever the template's n", () => {
    expect(weightTitle({ title: WEIGHT_TITLE, config: STD_EG, context: ORDERED })).toBe("Weight (g)");
    expect(weightTitle({ title: WEIGHT_TITLE, config: { ...STD_EG, n: 12 }, context: makeTestContext() })).toBe("Weight (g)");
  });

  it("drops version 1's lowercase wording, and a count already filled in, with a hyphen or an en dash", () => {
    expect(weightTitle({ title: V1_TITLE, config: STD_EG, context: ORDERED })).toBe("Weight (g)");
    expect(weightTitle({ title: "Weight (g) – Average of 8 or 13 Gloves per Size", config: STD_EG, context: ORDERED })).toBe(
      "Weight (g)",
    );
    expect(weightTitle({ title: "Weight (g) - Average of 1 Glove per Size", config: STD_EG, context: ORDERED })).toBe("Weight (g)");
  });

  it("leaves a title without a count as it is (SAFEDON_EG), and wording elsewhere in a title", () => {
    expect(weightTitle({ title: "Weight (g)", config: templateConfig("SAFEDON_EG"), context: ORDERED })).toBe("Weight (g)");
    expect(weightTitle({ title: "Average of 13 Gloves per Size, by Weight", config: STD_EG, context: ORDERED })).toBe(
      "Average of 13 Gloves per Size, by Weight",
    );
  });
});
