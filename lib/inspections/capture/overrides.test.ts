import { describe, expect, it } from "vitest";
import type { ModuleOverride } from "@/lib/schemas/template";
import { TEST_ADMIN_ID, testTemplate } from "./__fixtures__/capture";
import { canBeSwitchedOff, switchOffProblem, switchOnProblem, withOverride, withoutOverride } from "./overrides";

const OVERRIDE: ModuleOverride = { reason: "Not in this order.", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" };
const template = testTemplate();

describe("switchOffProblem", () => {
  it("lets an admin switch off an ordinary module", () => {
    expect(switchOffProblem(template, {}, "packing_config")).toBeNull();
    expect(canBeSwitchedOff(template, {}, "weight")).toBe(true);
  });

  it("explains why a module stays on, naming it by its short name (docs/DESIGN.md, Step Names)", () => {
    // The template's "Manufacturer Information", General Information on screen.
    expect(switchOffProblem(template, {}, "header")).toBe(
      "General Information is always on. Its fields are switched on and off in the template.",
    );
    expect(switchOffProblem(template, {}, "conclusion")).toMatch(/^Conclusion is always on/);
    expect(switchOffProblem(template, {}, "order_lots")).toBe(
      "Order cannot be switched off: it gives the ordered sizes every per-size section shows.",
    );
    expect(switchOffProblem(template, {}, "visual")).toBe("This section is not part of the inspection's template.");
  });

  it("keeps a module on while a custom field shows its value", () => {
    const problem = switchOffProblem(template, {}, "glove_info");
    expect(problem).toMatch(/^Glove Information cannot be switched off\. Site notes: Colour on the form shows a value of it/);
  });

  it("says when it is off already", () => {
    expect(switchOffProblem(template, { packing_config: OVERRIDE }, "packing_config")).toBe(
      "Packing Configuration is already switched off for this inspection.",
    );
    const offInTemplate = {
      ...template,
      modules: template.modules.map((entry) => (entry.key === "weight" ? { ...entry, include: false } : entry)),
    };
    // The template's "Weight (g)".
    expect(switchOffProblem(offInTemplate, {}, "weight")).toBe("Weight is already off in the template.");
  });
});

describe("switchOnProblem and the overrides value", () => {
  it("switches back on only what is off", () => {
    expect(switchOnProblem(template, { packing_config: OVERRIDE }, "packing_config")).toBeNull();
    expect(switchOnProblem(template, {}, "packing_config")).toBe(
      "Packing Configuration is not switched off for this inspection.",
    );
  });

  it("adds and removes one module's override, leaving the others", () => {
    const one = withOverride({}, "packing_config", OVERRIDE);
    const two = withOverride(one, "weight", OVERRIDE);
    expect(Object.keys(two)).toEqual(["packing_config", "weight"]);
    expect(withoutOverride(two, "packing_config")).toEqual({ weight: OVERRIDE });
    expect(one).toEqual({ packing_config: OVERRIDE });
  });
});
