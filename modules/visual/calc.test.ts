import { describe, expect, it } from "vitest";
import {
  defaultLabels,
  labelOverrides,
  moduleConfig,
  moduleTitle,
  seedModuleConfigs,
  TEMPLATES,
  type TemplateCode,
} from "@/lib/coverage";
import { lookupFrom, resolveTemplate } from "@/lib/templates";
import { MODULE_REGISTRY } from "@/modules/registry";
import {
  buildInspectionContext,
  evaluateInspection,
  stubModule,
  type CalcInput,
  type InspectionContext,
  type ModuleRegistry,
} from "@/modules/_framework";
import { checkModuleContract, makeSampling, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import {
  SAFEDON_EG_EXAMPLE,
  SAFEDON_EG_EXPECTED,
  STD_EG_EXAMPLE,
  STD_EG_EXPECTED,
  type ExampleReport,
  type ExpectedVisual,
  type VisualClass,
} from "@/tests/fixtures/examples";
import { calcVisual, classLabel, contributeVisual, defectLabel } from "./calc";
import { VISUAL_DEFAULT_CONFIG, VISUAL_LABELS, VISUAL_TITLE, VisualConfigSchema, type VisualConfig } from "./config";
import { definition } from "./index";
import { DEFECT_CLASSES, emptyVisual, VisualDataSchema, type VisualData } from "./schema";

type Input = CalcInput<VisualData, VisualConfig>;

const M_500 = () => makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ watertightVisual: 500 }) } });

function input(
  sizes: Record<string, unknown>,
  {
    config = VISUAL_DEFAULT_CONFIG,
    context = M_500(),
    labels = VISUAL_LABELS,
  }: { config?: VisualConfig; context?: InspectionContext; labels?: Input["labels"] } = {},
): Input {
  return { data: VisualDataSchema.parse({ sizes }), config, title: VISUAL_TITLE, labels, context, results: {}, hasData: true };
}

/** Every class inspected with n gloves, and the given counts. */
function inspectedAll(n: number, counts: Partial<Record<VisualClass, Record<string, number>>> = {}) {
  return Object.fromEntries(DEFECT_CLASSES.map((cls) => [cls, { inspected: n, counts: counts[cls] ?? {} }]));
}

function withClass(cls: VisualClass, change: Partial<VisualConfig["classes"]["major"]>): VisualConfig {
  return {
    ...VISUAL_DEFAULT_CONFIG,
    classes: { ...VISUAL_DEFAULT_CONFIG.classes, [cls]: { ...VISUAL_DEFAULT_CONFIG.classes[cls], ...change } },
  };
}

/** An example report's visual section in this module's data shape, with its template's config and wording. */
function fromExample(example: ExampleReport): Input {
  const code = example.template;
  const sizes = [...example.sizesOrdered];
  const context = makeTestContext({
    sizes,
    sampling: Object.fromEntries(
      sizes.map((size) => [size, makeSampling({ watertightVisual: example.sampling[size]?.watertightVisualGloves ?? null })]),
    ),
  });
  const data = Object.fromEntries(
    sizes.map((size) => [
      size,
      Object.fromEntries(
        DEFECT_CLASSES.flatMap((cls) => {
          const entry = example.visual[cls].perSize[size];
          return entry ? [[cls, { inspected: entry.inspected, counts: { ...entry.counts } }]] : [];
        }),
      ),
    ]),
  );
  return {
    ...input(data, {
      config: VisualConfigSchema.parse(moduleConfig(code, "visual")),
      context,
      labels: { ...VISUAL_LABELS, ...labelOverrides(code, "visual") },
    }),
    title: moduleTitle(code, "visual"),
  };
}

function expectClass(output: ReturnType<typeof calcVisual>, size: string, cls: VisualClass, expected: ExpectedVisual) {
  const computed = output.computed.sizes[size]?.[cls];
  expect(computed, `${size} ${cls}`).toMatchObject({
    inspected: expected.n,
    codeLetter: expected.codeLetter,
    accept: expected.accept,
    reject: expected.reject,
    total: expected.found,
    result: expected.status,
  });
  for (const [code, count] of Object.entries(expected.byDefect)) expect(computed?.counts[code], `${size} ${code}`).toBe(count);
  expect(output.computed.classes[cls].aql, `${cls} AQL`).toBe(expected.aql);
  if (expected.arrow) {
    expect(computed).toMatchObject({ arrow: expected.arrow.direction, usedLetter: expected.arrow.codeLetter, n: expected.arrow.n });
  }
}

const codesOf = (issues: readonly { code: string }[]) => issues.map((issue) => issue.code);

describe("visual", () => {
  it("satisfies the module contract", () => {
    expect(checkModuleContract(definition)).toEqual([]);
    expect(definition).toMatchObject({ perSize: true, handSplit: true, stub: false });
  });

  it("takes its title and labels from the data dictionary (STD_EG's wording)", () => {
    expect(VISUAL_TITLE).toBe(moduleTitle("STD_EG", "visual"));
    expect(VISUAL_LABELS).toEqual(defaultLabels("visual"));
  });

  describe("expected results (docs/examples/expected-results.md)", () => {
    it("B. STD_EG M: critical 0 / 1, major 21 / 22 with 8 found, minor at code N follows the arrow to M: 21 / 22; all passed", () => {
      const output = calcVisual(fromExample(STD_EG_EXAMPLE));
      for (const cls of DEFECT_CLASSES) {
        const expected = STD_EG_EXPECTED.visual[cls].M;
        if (!expected) throw new Error(`No expected ${cls}`);
        expectClass(output, "M", cls, expected);
      }
      expect(output.computed.sizes.M.major?.counts).toEqual({
        thin_crotch_area: 2,
        thin_crotch_ring: 0,
        thin_body_area: 1,
        thin_spot: 5,
        dirt_nonremovable: 0,
        stain: 0,
        foreign_matter: 0,
        bead_defective: 0,
        lump_big: 0,
        // Only the onsite forms have these (SKV, FM): none on the example report.
        skin_visual: 0,
        flow_mark: 0,
      });
      expect(output.result).toEqual({
        status: "pass",
        summary: "Size M: Critical Defects 0 / 500, Major Defects 8 / 500, Minor Defects 0 / 500: Passed.",
        perSize: {
          M: {
            status: "pass",
            summary:
              "Critical Defects 0 / 500, Defect Limit 0 / 1: Passed; Major Defects 8 / 500 (Thin Area Between Fingers (Crotch) 2, Thin Area on Glove Body 1, Thin Spot on Glove Body 5), Defect Limit 21 / 22: Passed; Minor Defects 0 / 500, Defect Limit 21 / 22: Passed.",
          },
        },
      });
      expect(output.issues).toEqual([]);
    });

    it("B. corrects the original report: major 21 / 22, not 14 / 15, and code letter N in the heading, not 'K, L & M'", () => {
      expect(STD_EG_EXAMPLE.visual.major.perSize.M?.printedLimit).toEqual({ accept: 14, reject: 15 });
      expect(STD_EG_EXAMPLE.visual.printedTitle).toContain("K, L & M");
      const output = calcVisual(fromExample(STD_EG_EXAMPLE));
      expect([output.computed.sizes.M.major?.accept, output.computed.sizes.M.major?.reject]).toEqual([21, 22]);
      expect(output.computed.heading).toBe("Visual Inspection (Single Sampling Code Letter N)");
      expect(output.computed.classes.minor.heading).toBe("Minor Defects (AQL 4.0)");
      expect(output.computed.classes.critical.heading).toBe("Critical Defects (AQL 0.0)");
    });

    it("A. SAFEDON_EG: critical 0 / 1; major 5 / 6 at n 80 and 10 / 11 at n 200; minor 7 / 8 and 14 / 15; nothing found, all passed", () => {
      const output = calcVisual(fromExample(SAFEDON_EG_EXAMPLE));
      for (const cls of DEFECT_CLASSES) {
        for (const [size, expected] of Object.entries(SAFEDON_EG_EXPECTED.visual[cls])) expectClass(output, size, cls, expected);
      }
      expect(Object.values(output.result.perSize ?? {}).map((entry) => entry.status)).toEqual(["pass", "pass", "pass", "pass"]);
      expect(output.result.status).toBe("pass");
      expect(output.computed.heading).toBe("Visual Inspection (Sampling Code Letter J & L)");
      expect(output.issues).toEqual([]);
    });

    it("A and B. label the critical result line Critical, where both reports printed 'Visual Minor'", () => {
      for (const example of [STD_EG_EXAMPLE, SAFEDON_EG_EXAMPLE]) {
        expect(example.visual.critical.printedResultLabel).toBe("Disposition - Visual Minor (Passed / Failed)");
        const { labels } = fromExample(example);
        expect(labels.criticalResult).toBe("Disposition - Visual Critical (Passed / Failed)");
      }
    });

    it("A. reads SAFEDON_EG's wording for its own defects", () => {
      const output = calcVisual(fromExample(SAFEDON_EG_EXAMPLE));
      expect(output.computed.classes.major.defects).toContainEqual({ code: "thin_body_area", label: "Thin Patch / Area (Body)" });
      expect(output.computed.classes.major.defects.map((defect) => defect.code)).toContain("powder_mark");
    });
  });

  describe("results per class and size", () => {
    it("fails on any critical defect, even before the gloves inspected are entered", () => {
      const counted = calcVisual(input({ M: inspectedAll(500, { critical: { embedded_insect: 1 } }) }));
      expect(counted.computed.sizes.M.critical).toMatchObject({ accept: 0, reject: 1, total: 1, result: "fail" });
      expect(counted.result).toMatchObject({ status: "fail", perSize: { M: { status: "fail" } } });
      const early = calcVisual(input({ M: { critical: { counts: { embedded_metal: 1 } } } }));
      expect(early.computed.sizes.M.critical).toMatchObject({ inspected: null, accept: 0, reject: 1, total: 1, result: "fail" });
      expect(early.result.summary).toBe(
        "Size M: Critical Defects 1 found, Major Defects not done, Minor Defects not done: Failed.",
      );
      expect(early.result.perSize?.M).toEqual({
        status: "fail",
        summary:
          "Critical Defects 1 found (Embedded Metal Debris 1): Failed (any critical defect fails); Major Defects: No. of Sample Inspected missing (sampling plan: 500); Minor Defects: No. of Sample Inspected missing (sampling plan: 500).",
      });
    });

    it("sets the critical limits before the gloves inspected are entered: AQL 0 is Accept 0 / Reject 1 whatever n", () => {
      const empty = calcVisual(input({ M: {} })).computed.sizes.M;
      expect(empty.critical).toMatchObject({ inspected: null, codeLetter: null, accept: 0, reject: 1, result: "not_done" });
      // Major and minor take their limits from the plan for n.
      expect(empty.major).toMatchObject({ accept: null, reject: null, result: "not_done" });
      expect(empty.minor).toMatchObject({ accept: null, reject: null, result: "not_done" });
      const tooFew = calcVisual(input({ M: { critical: { inspected: 1 } } })).computed.sizes.M.critical;
      expect(tooFew).toMatchObject({ accept: 0, reject: 1, result: "not_done" });
    });

    it("rejects a major or minor class at Re and accepts at Ac", () => {
      const major = (count: number) =>
        calcVisual(input({ M: inspectedAll(500, { major: { thin_spot: count } }) })).computed.sizes.M.major?.result;
      expect(major(21)).toBe("pass");
      expect(major(22)).toBe("fail");
      const minor = calcVisual(input({ M: inspectedAll(500, { minor: { dirt_small: 20, bead_poor: 2 } }) }));
      expect(minor.result).toMatchObject({
        status: "fail",
        summary: "Size M: Critical Defects 0 / 500, Major Defects 0 / 500, Minor Defects 22 / 500: Failed.",
      });
    });

    it("is not done for a class until its gloves inspected are entered, and the size takes its worst class", () => {
      const output = calcVisual(input({ M: { critical: { inspected: 500 }, major: { inspected: 500 } } }));
      expect(output.computed.sizes.M.minor).toMatchObject({ inspected: null, planned: 500, result: "not_done" });
      expect(output.result.perSize?.M?.status).toBe("not_done");
      expect(output.result.summary).toBe(
        "Size M: Critical Defects 0 / 500, Major Defects 0 / 500, Minor Defects not done: Not done.",
      );
    });

    it("never passes an ordered size with nothing entered", () => {
      const context = makeTestContext({
        sizes: ["S", "M"],
        sampling: { S: makeSampling({ watertightVisual: 200 }), M: makeSampling({ watertightVisual: 500 }) },
      });
      const output = calcVisual(input({ M: inspectedAll(500) }, { context }));
      expect(output.result.perSize?.S?.status).toBe("not_done");
      expect(output.result.perSize?.M?.status).toBe("pass");
      expect(output.result.summary).toBe(
        "Size S: not done, No. of Sample Inspected missing (sampling plan: 200); size M: Critical Defects 0 / 500, Major Defects 0 / 500, Minor Defects 0 / 500: Passed.",
      );
    });

    it("is not done while the sample is too small for a class's AQL, with the n it needs", () => {
      // AQL 0.65 at n 50 (code H) points down to code J: n 80, Accept 1 / Reject 2.
      const context = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ watertightVisual: 50 }) } });
      const output = calcVisual(input({ M: inspectedAll(50) }, { config: withClass("major", { aql: 0.65 }), context }));
      expect(output.computed.sizes.M.major).toMatchObject({ arrow: "down", usedLetter: "J", n: 80, decision: "incomplete", result: "not_done" });
      expect(output.issues).toEqual([
        expect.objectContaining({ code: "sample_too_small", size: "M", path: ["sizes", "M", "major", "inspected"] }),
      ]);
    });

    it("switches classes on and off; with none on the module only records", () => {
      const noMinor = calcVisual(input({ M: inspectedAll(500) }, { config: withClass("minor", { include: false }) }));
      expect(noMinor.computed.sizes.M.minor).toBeNull();
      expect(noMinor.result.summary).toBe("Size M: Critical Defects 0 / 500, Major Defects 0 / 500: Passed.");
      const none: VisualConfig = {
        ...VISUAL_DEFAULT_CONFIG,
        classes: {
          critical: { ...VISUAL_DEFAULT_CONFIG.classes.critical, include: false },
          major: { ...VISUAL_DEFAULT_CONFIG.classes.major, include: false },
          minor: { ...VISUAL_DEFAULT_CONFIG.classes.minor, include: false },
        },
      };
      expect(calcVisual(input({ M: {} }, { config: none })).result).toEqual({
        status: "info",
        summary: "No defect classes are switched on.",
        perSize: { M: { status: "info", summary: "No defect classes are switched on." } },
      });
    });

    it("uses the template's AQL, else the client's, else 2.5 and 4.0", () => {
      const base = M_500();
      const client = { ...base, aql: { ...base.aql, major: 1.5, minor: 6.5 } };
      const limits = (config: VisualConfig, context: InspectionContext) => {
        const size = calcVisual(input({ M: inspectedAll(500) }, { config, context })).computed.sizes.M;
        return [size.major?.accept, size.minor?.accept];
      };
      expect(limits(VISUAL_DEFAULT_CONFIG, base)).toEqual([21, 21]);
      expect(limits(VISUAL_DEFAULT_CONFIG, client)).toEqual([14, 21]);
      expect(limits(withClass("major", { aql: 2.5 }), client)).toEqual([21, 21]);
      // AQL 0 for critical whatever the client says (BUILD_SPEC 7).
      expect(calcVisual(input({ M: inspectedAll(500) }, { context: { ...base, aql: { ...base.aql, critical: 1 } } })).computed.classes.critical.aql).toBe(0);
    });

    it("sets no limits for an AQL outside Table 2-A, with an error", () => {
      const base = M_500();
      const output = calcVisual(input({ M: inspectedAll(500) }, { context: { ...base, aql: { ...base.aql, minor: 3 } } }));
      expect(output.computed.sizes.M.minor?.result).toBe("not_done");
      expect(codesOf(output.issues)).toEqual(["aql_invalid"]);
    });

    it("gives the classes' AQLs to the context, for the sampling plan's lot check (AQL_SOURCES)", () => {
      const contribute = (config: VisualConfig) => contributeVisual({ data: emptyVisual(), config });
      // Critical is always 0; major and minor only when the template sets them, else the client's or BUILD_SPEC 7's stay.
      expect(contribute(VISUAL_DEFAULT_CONFIG)).toEqual({ aql: { critical: 0 } });
      expect(contribute(withClass("major", { aql: 1.5 }))).toEqual({ aql: { critical: 0, major: 1.5 } });
      // A class switched off is not run: no plan needs its AQL.
      expect(contribute(withClass("minor", { include: false, aql: 6.5 }))).toEqual({ aql: { critical: 0, minor: null } });
      expect(definition.contribute).toBe(contributeVisual);

      const template = makeTestTemplate(MODULE_REGISTRY, ["order_lots", { key: "visual", config: withClass("minor", { include: false }) }]);
      const context = buildInspectionContext(
        { template, data: { modules: {}, custom: {} }, aqlDefaults: { critical: 0.065, major: 1.5, minor: 6.5 } },
        MODULE_REGISTRY,
      );
      expect(context.aql).toMatchObject({ watertight: null, critical: 0, major: 1.5, minor: null });
      expect(context.contributionErrors).toEqual([]);
      // The class switched off still has a heading, with the default AQL.
      const output = calcVisual(input({ M: inspectedAll(500) }, { config: withClass("minor", { include: false }), context: { ...M_500(), aql: context.aql } }));
      expect(output.computed.classes.minor).toMatchObject({ include: false, aql: 4, heading: "Minor Defects (AQL 4.0)" });
      expect(output.computed.sizes.M.minor).toBeNull();
    });

    it("refuses fewer than 2 gloves inspected and warns when the gloves inspected differ from the sampling plan", () => {
      const output = calcVisual(input({ M: { ...inspectedAll(500), major: { inspected: 1 }, minor: { inspected: 315 } } }));
      expect(output.issues).toEqual([
        expect.objectContaining({ level: "error", code: "inspected_too_small", path: ["sizes", "M", "major", "inspected"] }),
        expect.objectContaining({
          level: "warning",
          code: "inspected_not_planned",
          message:
            "Size M, Minor Defects: No. of Sample Inspected is 315, but the sampling plan has 500 gloves for watertight and visual.",
          path: ["sizes", "M", "minor", "inspected"],
        }),
      ]);
      expect(output.computed.sizes.M.minor).toMatchObject({ codeLetter: "M", accept: 21, result: "pass" });
    });
  });

  describe("defects and their wording", () => {
    it("counts a defect listed in two classes apart, each under its own class's wording", () => {
      const output = calcVisual(
        input({ M: inspectedAll(500, { major: { bead_defective: 1 }, minor: { bead_defective: 3 } }) }),
      );
      expect([output.computed.sizes.M.major?.total, output.computed.sizes.M.minor?.total]).toEqual([1, 3]);
      expect(output.result.perSize?.M?.summary).toContain("Major Defects 1 / 500 (Defective Bead 1)");
      expect(output.result.perSize?.M?.summary).toContain("Minor Defects 3 / 500 (Defective Beads 3)");
    });

    it("lets a template reword a defect for one class or everywhere without rewriting the list", () => {
      const bead = { code: "bead_defective", label: "Defective Bead" };
      expect(defectLabel({ "minor.bead_defective": "Bead defect" }, "minor", bead)).toBe("Bead defect");
      expect(defectLabel({ "minor.bead_defective": "Bead defect" }, "major", bead)).toBe("Defective Bead");
      expect(defectLabel({ bead_defective: "Bead flaw" }, "major", bead)).toBe("Bead flaw");
      expect(defectLabel({ "major.bead_defective": " " }, "major", bead)).toBe("Defective Bead");
      expect(defectLabel({}, "major", bead)).toBe("Defective Bead");
      expect(classLabel({ ...VISUAL_LABELS, majorCounts: "Major Defect" }, "major")).toBe("Major Defect");
    });

    it("counts a one-off defect and flags it for an admin; one at 0 counts nothing", () => {
      const output = calcVisual(
        input({
          M: {
            ...inspectedAll(500),
            minor: { inspected: 500, unmapped: [{ label: "Faint print", count: 2 }, { label: "Removed", count: 0 }] },
          },
        }),
      );
      expect(output.computed.sizes.M.minor).toMatchObject({ total: 2, unmapped: [{ label: "Faint print", count: 2, hand: null }] });
      expect(output.issues).toEqual([
        {
          level: "warning",
          code: "defect_unmapped",
          message:
            'Size M, Minor Defects: "Faint print" (2) is not in the template\'s defect list. It counts towards the total; an admin maps it to a defect code.',
          size: "M",
          path: ["sizes", "M", "minor", "unmapped", 0],
        },
      ]);
    });

    it("counts defects under a code the class does not list, with a warning", () => {
      const output = calcVisual(input({ M: inspectedAll(500, { major: { powder_mark: 2 } }) }));
      expect(output.computed.sizes.M.major).toMatchObject({ total: 2, counts: { powder_mark: 2 } });
      expect(output.issues).toEqual([
        expect.objectContaining({ code: "defect_not_listed", path: ["sizes", "M", "major", "counts", "powder_mark"] }),
      ]);
    });
  });

  describe("hand split (surgical templates)", () => {
    const config: VisualConfig = { ...VISUAL_DEFAULT_CONFIG, handSplit: true };
    const context = makeTestContext({
      sizes: ["7.0"],
      templateSizes: [{ value: "7.0", label: "7.0" }],
      sampling: { "7.0": makeSampling({ watertightVisual: 125 }) },
    });

    it("counts both hands of a class against one limit per size and class", () => {
      const output = calcVisual(
        input(
          {
            "7.0": {
              ...inspectedAll(125),
              R: { major: { counts: { thin_spot: 4 } }, minor: { unmapped: [{ label: "Faint print", count: 1 }] } },
              L: { major: { counts: { thin_spot: 2, stain: 1 } } },
            },
          },
          { config, context },
        ),
      );
      expect(output.computed.sizes["7.0"].major).toMatchObject({
        codeLetter: "K",
        accept: 7,
        reject: 8,
        total: 7,
        counts: { thin_spot: 6, stain: 1 },
        hands: { R: { total: 4 }, L: { total: 3 } },
        result: "pass",
      });
      expect(output.computed.sizes["7.0"].minor).toMatchObject({ total: 1, unmapped: [{ label: "Faint print", count: 1, hand: "R" }] });
      expect(output.issues).toEqual([
        expect.objectContaining({ code: "defect_unmapped", path: ["sizes", "7.0", "R", "minor", "unmapped", 0] }),
      ]);
    });

    it("leaves out defects saved in the shape the template does not use, and says so", () => {
      const split = calcVisual(input({ "7.0": inspectedAll(125, { major: { thin_spot: 30 } }) }, { config, context }));
      expect(split.computed.sizes["7.0"].major?.total).toBe(0);
      expect(codesOf(split.issues)).toEqual(["hand_split_mismatch"]);
      const plain = calcVisual(
        input({ "7.0": { ...inspectedAll(125), L: { major: { counts: { thin_spot: 30 } } } } }, { context }),
      );
      expect(plain.computed.sizes["7.0"].major).toMatchObject({ total: 0, hands: null });
      expect(plain.issues).toEqual([expect.objectContaining({ code: "hand_split_mismatch", path: ["sizes", "7.0", "L"] })]);
    });
  });

  describe("through the engine", () => {
    it("shows only ordered sizes and keeps the rest out of results (6.2 rule 4)", () => {
      const template = makeTestTemplate(MODULE_REGISTRY, ["visual"]);
      const data = {
        modules: { visual: { sizes: { M: inspectedAll(500, { major: { thin_spot: 5 } }), XL: inspectedAll(200) } } },
        custom: {},
      };
      const visual = evaluateInspection({ template, data, context: M_500() }, MODULE_REGISTRY).modules.find(
        (entry) => entry.key === "visual",
      );
      expect(visual?.result).toMatchObject({ status: "pass", perSize: { M: { status: "pass" } } });
      expect(Object.keys(visual?.result.perSize ?? {})).toEqual(["M"]);
      expect(visual?.issues.map((issue) => [issue.code, issue.size])).toEqual([["size_not_ordered", "XL"]]);
    });

    it("reports text in a count as invalid data instead of reading it (6.2 rule 1)", () => {
      const template = makeTestTemplate(MODULE_REGISTRY, ["visual"]);
      const data = { modules: { visual: { sizes: { M: { major: { inspected: 500, counts: { thin_spot: "8/500" } } } } } }, custom: {} };
      const visual = evaluateInspection({ template, data, context: M_500() }, MODULE_REGISTRY).modules.find(
        (entry) => entry.key === "visual",
      );
      expect(visual?.result.status).toBe("not_done");
      expect(visual?.issues).toEqual([
        expect.objectContaining({ level: "error", code: "invalid_data", path: ["sizes", "M", "major", "counts", "thin_spot"] }),
      ]);
    });
  });

  describe("seed templates (lib/coverage)", () => {
    // Every other module as a placeholder, so this checks this module's schema only.
    const registry = Object.fromEntries(
      Object.values(MODULE_REGISTRY).map((entry) => [
        entry.key,
        entry.key === "visual"
          ? definition
          : stubModule({
              key: entry.key,
              title: entry.title,
              perSize: entry.perSize,
              handSplit: entry.handSplit,
              dependsOn: entry.dependsOn,
              requiredForSubmit: entry.requiredForSubmit,
            }),
      ]),
    ) as unknown as ModuleRegistry;

    const seed = (code: TemplateCode) => {
      const spec = TEMPLATES[code];
      return {
        code,
        name: spec.name,
        ...(spec.extends ? { extends: spec.extends } : {}),
        scope: { productType: spec.scope.productType, standard: spec.scope.standard },
        unit: spec.unit,
        sizes: spec.sizes.map((size) => ({ ...size })),
        modules: seedModuleConfigs(code),
      };
    };
    const getBase = lookupFrom([{ definition: seed("STD_EG"), version: 1 }]);
    const visualOf = (code: TemplateCode) => {
      const resolution = resolveTemplate(seed(code), { getBase, registry });
      if (!resolution.ok) throw new Error(JSON.stringify(resolution.problems));
      const found = resolution.template.modules.find((entry) => entry.key === "visual");
      if (!found) throw new Error(`${code} has no visual`);
      return found;
    };

    it.each(["STD_EG", "SAFEDON_EG", "STD_SG"] as const)("%s resolves to the dictionary's config and wording", (code) => {
      const resolved = visualOf(code);
      expect(resolved.config).toEqual(moduleConfig(code, "visual"));
      expect(resolved.title).toBe(moduleTitle(code, "visual"));
      expect(resolved.labels).toEqual({ ...defaultLabels("visual"), ...labelOverrides(code, "visual") });
    });

    it("STD_SG words its classes as the SG form does and splits hands", () => {
      const resolved = visualOf("STD_SG");
      expect(resolved.labels).toMatchObject({ majorCounts: "Major Defect", majorTotal: "Total Major", heading: "Visual Inspection" });
      expect(resolved.config.handSplit).toBe(true);
    });
  });
});
