import { describe, expect, it } from "vitest";
import type { ModuleKey } from "@/lib/schemas/module-result";
import { evaluateSafedonEg, evaluateStdEg } from "@/tests/acceptance/examples";
import { evaluated } from "./__fixtures__/review";
import { moduleSummary, shownStatus, sizeResults, summaryBeyondSizes, type SizeLine } from "./results";

/** The summary each module of an example report shows above its per-size lines. */
function shownSummaries(example: ReturnType<typeof evaluateStdEg>, keys: readonly ModuleKey[]) {
  return Object.fromEntries(keys.map((key) => [key, moduleSummary(example.module(key), example.context)]));
}

describe("moduleSummary on the example reports", () => {
  it("leaves out a summary that repeats the one size of STD_EG, and keeps what it adds", () => {
    const stdEg = evaluateStdEg({ corrected: true });
    expect(shownSummaries(stdEg, ["sampling_plan", "carton_sampling", "watertight", "dispensing_packing"])).toEqual({
      sampling_plan: null,
      carton_sampling: null,
      watertight: null,
      dispensing_packing: null,
    });
    // "Size M: Median 6.537 N. Spec. ≥ 6 N." over "Median 6.537 N": only the spec is new.
    expect(moduleSummary(stdEg.module("force_at_break"), stdEg.context)).toBe("Spec. ≥ 6 N.");
  });

  it("keeps a headline of its own whole", () => {
    const stdEg = evaluateStdEg({ corrected: true });
    expect(shownSummaries(stdEg, ["dimensions", "labeling", "weight", "visual", "order_lots"])).toEqual({
      dimensions: "Median within spec for size M.",
      labeling: "No defects in size M.",
      weight: stdEg.module("weight").result.summary,
      visual: stdEg.module("visual").result.summary,
      order_lots: "Size M. Total # carton 2,900; Total # gloves 5,800,000.",
    });
  });

  it("does the same with SAFEDON_EG's four sizes, sizes listed together included", () => {
    const safedon = evaluateSafedonEg();
    // "Size XS, L: 80 sampled, …. Size S, M: 200 sampled, …."
    expect(shownSummaries(safedon, ["watertight", "dispensing_safedon", "sampling_plan"])).toEqual({
      watertight: null,
      dispensing_safedon: null,
      sampling_plan: null,
    });
    expect(moduleSummary(safedon.module("tensile"), safedon.context)).toBe("Spec. (ASTM D6319) ≥ 14.00 MPa / ≥ 500%.");
    expect(moduleSummary(safedon.module("carton_sampling"), safedon.context)).toBe(
      safedon.module("carton_sampling").result.summary,
    );
    expect(moduleSummary(safedon.module("visual"), safedon.context)).toBe(safedon.module("visual").result.summary);
  });

  it("lists every size's result in the template's order, named as the template names it", () => {
    const safedon = evaluateSafedonEg();
    expect(sizeResults(safedon.module("watertight"), safedon.context).map(({ size, status }) => [size, status])).toEqual([
      ["XS", "pass"],
      ["S", "pass"],
      ["M", "pass"],
      ["L", "pass"],
    ]);
  });
});

describe("summaryBeyondSizes", () => {
  const line = (size: string, summary: string, label = size): SizeLine => ({ size, label, summary });

  it("matches a size by the template's name for it, and a lower-case 'size'", () => {
    expect(summaryBeyondSizes("Size Medium: 0 / 125: Passed; size L: 1 / 80: Passed.", [
      line("M", "0 / 125: Passed.", "Medium"),
      line("L", "1 / 80: Passed."),
    ])).toBeNull();
  });

  it("reads sizes listed together, with 'and' as well as commas", () => {
    expect(summaryBeyondSizes("Sizes S and M: 200 sampled.", [line("S", "200 sampled."), line("M", "200 sampled.")])).toBeNull();
  });

  it("leaves out a summary that is the one size's line itself", () => {
    expect(summaryBeyondSizes("Median 6.5 N.", [line("M", "Median 6.5 N")])).toBeNull();
  });

  it("keeps the summary whole when a size's line is not repeated behind its size", () => {
    const summary = "Passed in every size: Size M looked fine.";
    expect(summaryBeyondSizes(summary, [line("M", "Passed."), line("L", "Passed.")])).toBe(summary);
    // A size's words inside a headline do not count: they are not behind "Size M:".
    expect(summaryBeyondSizes("All sizes passed.", [line("M", "passed")])).toBe("All sizes passed.");
  });

  it("keeps a note between the sizes' lines and after them", () => {
    expect(summaryBeyondSizes("Size M: 2.9 g; checked twice; size L: 3.1 g. Spec. NA.", [line("M", "2.9 g"), line("L", "3.1 g")])).toBe(
      "checked twice. Spec. NA.",
    );
  });

  it("tells XS from S", () => {
    expect(summaryBeyondSizes("Size XS: 1 / 80; size S: 0 / 200.", [line("XS", "1 / 80"), line("S", "0 / 200")])).toBeNull();
  });

  it("shows the summary when the sizes say nothing of their own, and nothing for a blank one", () => {
    expect(summaryBeyondSizes("Missing: Tested.", [line("M", ""), line("L", "  ")])).toBe("Missing: Tested.");
    expect(summaryBeyondSizes("Missing: Tested.", [])).toBe("Missing: Tested.");
    expect(summaryBeyondSizes("   ", [line("M", "Passed.")])).toBeNull();
  });
});

describe("shownStatus", () => {
  const conclusionOf = (finalResult: "pass" | "fail" | "hold") => {
    const evaluation = evaluated({
      data: { modules: { conclusion: { finalResult, remark: null } }, custom: {} },
    });
    if (!evaluation.ok) throw new Error(evaluation.message);
    const found = evaluation.report.modules.find((entry) => entry.key === "conclusion");
    if (!found) throw new Error("no conclusion");
    return found;
  };

  it("shows the conclusion's HOLD as on hold, not as the warning its module status has to be", () => {
    const hold = conclusionOf("hold");
    expect(hold.result.status).toBe("warn");
    expect(shownStatus(hold)).toBe("hold");
    expect(shownStatus(conclusionOf("pass"))).toBe("pass");
    expect(shownStatus(conclusionOf("fail"))).toBe("fail");
  });

  it("leaves every other module's warning a warning", () => {
    expect(shownStatus({ key: "weight", result: { status: "warn", summary: "" }, data: { finalResult: "hold" } })).toBe("warn");
    expect(shownStatus({ key: "conclusion", result: { status: "not_done", summary: "" }, data: { finalResult: "hold" } })).toBe(
      "not_done",
    );
  });
});
