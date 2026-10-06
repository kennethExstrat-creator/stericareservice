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
} from "@/tests/fixtures/examples";
import { aqlCaption, calcWatertight, fillCaption, listCodeLetters } from "./calc";
import { WATERTIGHT_DEFAULT_CONFIG, WATERTIGHT_LABELS, WATERTIGHT_TITLE, WatertightConfigSchema, type WatertightConfig } from "./config";
import { definition } from "./index";
import { WatertightDataSchema, type WatertightData } from "./schema";

type Input = CalcInput<WatertightData, WatertightConfig>;

function input(
  sizes: Record<string, unknown>,
  {
    config = WATERTIGHT_DEFAULT_CONFIG,
    context = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ watertightVisual: 500 }) } }),
    labels = WATERTIGHT_LABELS,
  }: { config?: WatertightConfig; context?: InspectionContext; labels?: Input["labels"] } = {},
): Input {
  return {
    data: WatertightDataSchema.parse({ sizes }),
    config,
    title: WATERTIGHT_TITLE,
    labels,
    context,
    results: {},
    hasData: true,
  };
}

/** An example report's watertight section in this module's data shape, with its template's config and wording. */
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
    Object.entries(example.watertight.perSize).map(([size, entry]) => [size, { tested: entry.tested, holes: { ...entry.holes } }]),
  );
  return {
    ...input(data, {
      config: WatertightConfigSchema.parse(moduleConfig(code, "watertight")),
      context,
      labels: { ...WATERTIGHT_LABELS, ...labelOverrides(code, "watertight") },
    }),
    title: moduleTitle(code, "watertight"),
  };
}

const codesOf = (issues: readonly { code: string }[]) => issues.map((issue) => issue.code);

describe("watertight", () => {
  it("satisfies the module contract", () => {
    expect(checkModuleContract(definition)).toEqual([]);
    expect(definition).toMatchObject({ perSize: true, handSplit: true, stub: false });
  });

  it("takes its title and labels from the data dictionary (STD_EG's wording)", () => {
    expect(WATERTIGHT_TITLE).toBe(moduleTitle("STD_EG", "watertight"));
    expect(WATERTIGHT_LABELS).toEqual(defaultLabels("watertight"));
  });

  describe("expected results (docs/examples/expected-results.md)", () => {
    it("B. STD_EG M: n 500 is code N, limit 14 / 15, 1 hole (finger), passed", () => {
      const expected = STD_EG_EXPECTED.watertight.M;
      const output = calcWatertight(fromExample(STD_EG_EXAMPLE));
      expect(output.computed.sizes.M).toMatchObject({
        tested: expected?.n,
        codeLetter: expected?.codeLetter,
        usedLetter: "N",
        accept: expected?.accept,
        reject: expected?.reject,
        totalDefects: expected?.found,
        holes: { hole_crotch: 0, hole_palm: 0, hole_finger: 1, hole_cuff: 0, hole_other: 0 },
        result: expected?.status,
      });
      expect(output.result).toEqual({
        status: "pass",
        summary: "Size M: 1 / 500 (Finger 1), Defect Limit 14 / 15: Passed.",
        perSize: { M: { status: "pass", summary: "1 / 500 (Finger 1), Defect Limit 14 / 15: Passed." } },
      });
      expect(output.issues).toEqual([]);
    });

    it("B. corrects the original report: code letter N in the heading, not 'k, L & M', and 14 / 15, not 10 / 11", () => {
      const printed = STD_EG_EXAMPLE.watertight.perSize.M?.printedLimit;
      const output = calcWatertight(fromExample(STD_EG_EXAMPLE));
      expect(STD_EG_EXAMPLE.watertight.printedTitle).toContain("k, L & M");
      expect(output.computed.heading).toBe(
        "Freedom from Holes by watertight test (Single sampling code letter N, AQL 1.5)",
      );
      expect(printed).toEqual({ accept: 10, reject: 11 });
      expect([output.computed.sizes.M.accept, output.computed.sizes.M.reject]).toEqual([14, 15]);
    });

    it("A. SAFEDON_EG: XS 1 / 80 limit 3 / 4, S and M 0 / 200 limit 7 / 8, L 1 / 80 (glove burst) limit 3 / 4, all passed", () => {
      const output = calcWatertight(fromExample(SAFEDON_EG_EXAMPLE));
      for (const [size, expected] of Object.entries(SAFEDON_EG_EXPECTED.watertight)) {
        expect(output.computed.sizes[size], size).toMatchObject({
          tested: expected.n,
          codeLetter: expected.codeLetter,
          accept: expected.accept,
          reject: expected.reject,
          totalDefects: expected.found,
          result: expected.status,
        });
        for (const [code, count] of Object.entries(expected.byLocation)) {
          expect(output.computed.sizes[size].holes[code], `${size} ${code}`).toBe(count);
        }
        expect(output.result.perSize?.[size]?.status).toBe(expected.status);
      }
      expect(output.result.status).toBe("pass");
      expect(output.computed.codeLetters).toBe("J & L");
      expect(output.computed.heading).toBe(
        "Freedom from Holes by watertight test (Sampling code letter J & L; AQL=1.5)",
      );
      expect(output.result.perSize?.L?.summary).toBe("1 / 80 (Glove burst 1), Defect Limit 3 / 4: Passed.");
      expect(output.issues).toEqual([]);
    });

    it("A. computes the XS total as a count, 1 of 80, where the original report showed a date", () => {
      const example = SAFEDON_EG_EXAMPLE.watertight.perSize.XS;
      expect(example?.printedTotal).toBe("Jan-80");
      const output = calcWatertight(fromExample(SAFEDON_EG_EXAMPLE));
      expect(output.computed.sizes.XS.totalDefects).toBe(1);
      expect(output.result.perSize?.XS?.summary).toBe("1 / 80 (Finger 1), Defect Limit 3 / 4: Passed.");
      // A total is never data: it cannot be typed, let alone typed as a date.
      expect(WatertightDataSchema.safeParse({ sizes: { XS: { tested: 80, totalDefects: "1/80" } } }).success).toBe(false);
    });
  });

  describe("not done until complete (6.2 rule 5)", () => {
    it("is not done for a size until the gloves tested are entered, offering the sampling plan's n", () => {
      const output = calcWatertight(input({ M: { holes: { hole_finger: 1 } } }));
      expect(output.result).toEqual({
        status: "not_done",
        summary: "Size M: not done, No. of sample tested missing (sampling plan: 500).",
        perSize: { M: { status: "not_done", summary: "Missing: No. of sample tested (sampling plan: 500)." } },
      });
      expect(output.computed.sizes.M).toMatchObject({ tested: null, planned: 500, totalDefects: 1, result: "not_done" });
      expect(output.issues).toEqual([]);
    });

    it("never passes an ordered size with nothing entered, even when another size passed", () => {
      const context = makeTestContext({
        sizes: ["S", "M"],
        sampling: { S: makeSampling({ watertightVisual: 200 }), M: makeSampling({ watertightVisual: 500 }) },
      });
      const output = calcWatertight(input({ M: { tested: 500 } }, { context }));
      expect(output.result.perSize).toEqual({
        S: { status: "not_done", summary: "Missing: No. of sample tested (sampling plan: 200)." },
        M: { status: "pass", summary: "0 / 500, Defect Limit 14 / 15: Passed." },
      });
      expect(output.result.status).toBe("not_done");
    });

    it("is not done with no sizes ordered", () => {
      const output = calcWatertight(input({}, { context: makeTestContext() }));
      expect(output.result).toEqual({ status: "not_done", summary: "No sizes ordered yet.", perSize: {} });
    });

    it("is not done while the sample is too small for the AQL (an arrow down), and fails once holes reach Re", () => {
      // AQL 0.65 at n 50 (code H) points down to code J: n 80, Accept 1 / Reject 2.
      const config = { ...WATERTIGHT_DEFAULT_CONFIG, aql: 0.65 as const };
      const context = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ watertightVisual: 50 }) } });
      const short = calcWatertight(input({ M: { tested: 50, holes: { hole_palm: 1 } } }, { config, context }));
      expect(short.computed.sizes.M).toMatchObject({
        codeLetter: "H",
        usedLetter: "J",
        n: 80,
        arrow: "down",
        accept: 1,
        reject: 2,
        decision: "incomplete",
        result: "not_done",
      });
      expect(short.result.perSize?.M).toEqual({
        status: "not_done",
        summary: "1 / 50 (Palm 1): 50 gloves are too few for AQL 0.65, which needs 80 (Accept 1, Reject 2).",
      });
      expect(short.issues).toEqual([
        expect.objectContaining({ level: "warning", code: "sample_too_small", size: "M", path: ["sizes", "M", "tested"] }),
      ]);
      const failed = calcWatertight(input({ M: { tested: 50, holes: { hole_palm: 2 } } }, { config, context }));
      expect(failed.result.perSize?.M?.status).toBe("fail");
    });
  });

  describe("limits from the AQL engine (BUILD_SPEC 7, 6.2 rules 2 and 8)", () => {
    it("rejects a size at Re holes and accepts at Ac", () => {
      const at = (holes: number) =>
        calcWatertight(input({ M: { tested: 500, holes: { hole_finger: holes } } })).result.perSize?.M?.status;
      expect(at(14)).toBe("pass");
      expect(at(15)).toBe("fail");
      const output = calcWatertight(input({ M: { tested: 500, holes: { hole_finger: 10, hole_cuff: 5 } } }));
      expect(output.result).toMatchObject({
        status: "fail",
        summary: "Size M: 15 / 500 (Finger 10, Cuff 5), Defect Limit 14 / 15: Failed.",
      });
    });

    it("reads a non-standard sample as the standard size below it, with a warning", () => {
      const context = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ watertightVisual: 100 }) } });
      const output = calcWatertight(input({ M: { tested: 100 } }, { context }));
      expect(output.computed.sizes.M).toMatchObject({ codeLetter: "J", n: 80, accept: 3, reject: 4, result: "pass" });
      expect(output.issues).toEqual([
        expect.objectContaining({ level: "warning", code: "nonstandard_sample", path: ["sizes", "M", "tested"] }),
      ]);
    });

    it("refuses a sample of fewer than 2 gloves with an error linked to the field", () => {
      const output = calcWatertight(input({ M: { tested: 1 } }));
      expect(output.result.perSize?.M).toEqual({ status: "not_done", summary: "No. of sample tested must be at least 2." });
      expect(output.issues).toEqual([
        expect.objectContaining({ level: "error", code: "tested_too_small", size: "M", path: ["sizes", "M", "tested"] }),
      ]);
    });

    it("warns when the gloves tested differ from the sampling plan", () => {
      const output = calcWatertight(input({ M: { tested: 315 } }));
      expect(output.computed.sizes.M).toMatchObject({ tested: 315, planned: 500, codeLetter: "M", accept: 10 });
      expect(output.issues).toEqual([
        {
          level: "warning",
          code: "tested_not_planned",
          message: "Size M: No. of sample tested is 315, but the sampling plan has 500 gloves for watertight and visual.",
          size: "M",
          path: ["sizes", "M", "tested"],
        },
      ]);
    });

    it("uses the template's AQL, else the client's, else 1.5", () => {
      const limitsWith = (config: WatertightConfig, context: InspectionContext) => {
        const { accept, reject } = calcWatertight(input({ M: { tested: 500 } }, { config, context })).computed.sizes.M;
        return [accept, reject];
      };
      const plain = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ watertightVisual: 500 }) } });
      const client = { ...plain, aql: { ...plain.aql, watertight: 2.5 } };
      expect(limitsWith(WATERTIGHT_DEFAULT_CONFIG, plain)).toEqual([14, 15]);
      expect(limitsWith(WATERTIGHT_DEFAULT_CONFIG, client)).toEqual([21, 22]);
      expect(limitsWith({ ...WATERTIGHT_DEFAULT_CONFIG, aql: 1.0 }, client)).toEqual([10, 11]);
      expect(calcWatertight(input({ M: { tested: 500 } }, { context: client })).computed.aql).toBe(2.5);
    });

    it("sets no limits for an AQL outside Table 2-A, with an error", () => {
      const plain = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ watertightVisual: 500 }) } });
      const context = { ...plain, aql: { ...plain.aql, watertight: 1.2 } };
      const output = calcWatertight(input({ M: { tested: 500 } }, { context }));
      expect(output.result.status).toBe("not_done");
      expect(codesOf(output.issues)).toEqual(["aql_invalid"]);
      expect(output.computed.heading).toContain("AQL 1.2");
    });
  });

  describe("hand split (surgical templates)", () => {
    const config: WatertightConfig = { ...WATERTIGHT_DEFAULT_CONFIG, handSplit: true };
    const context = makeTestContext({
      sizes: ["7.0"],
      templateSizes: [{ value: "7.0", label: "7.0" }],
      sampling: { "7.0": makeSampling({ watertightVisual: 125 }) },
    });

    it("counts both hands against one limit per size", () => {
      const output = calcWatertight(
        input(
          { "7.0": { tested: 125, R: { holes: { hole_palm: 2 } }, L: { holes: { hole_palm: 1, hole_cuff: 3 } } } },
          { config, context },
        ),
      );
      expect(output.computed.sizes["7.0"]).toMatchObject({
        codeLetter: "K",
        accept: 5,
        reject: 6,
        totalDefects: 6,
        holes: { hole_palm: 3, hole_cuff: 3 },
        hands: { R: { total: 2, holes: { hole_palm: 2 } }, L: { total: 4, holes: { hole_palm: 1, hole_cuff: 3 } } },
        result: "fail",
      });
    });

    it("leaves out holes saved in the shape the template does not use, and says so", () => {
      const split = calcWatertight(
        input({ "7.0": { tested: 125, holes: { hole_palm: 9 }, R: { holes: { hole_palm: 1 } } } }, { config, context }),
      );
      expect(split.computed.sizes["7.0"].totalDefects).toBe(1);
      expect(split.issues).toEqual([
        expect.objectContaining({ code: "hand_split_mismatch", path: ["sizes", "7.0", "holes"] }),
      ]);
      const plain = calcWatertight(
        input({ "7.0": { tested: 125, R: { holes: { hole_palm: 9 } } } }, { config: WATERTIGHT_DEFAULT_CONFIG, context }),
      );
      expect(plain.computed.sizes["7.0"]).toMatchObject({ totalDefects: 0, hands: null });
      expect(plain.issues).toEqual([expect.objectContaining({ code: "hand_split_mismatch", path: ["sizes", "7.0", "R"] })]);
    });
  });

  describe("defects outside the list", () => {
    it("counts a one-off label and flags it for an admin; a one-off at 0 counts nothing", () => {
      const output = calcWatertight(
        input({
          M: {
            tested: 500,
            holes: { hole_finger: 1 },
            unmapped: [
              { label: "Near the thumb", count: 2 },
              { label: "Added by mistake", count: 0 },
            ],
          },
        }),
      );
      expect(output.computed.sizes.M).toMatchObject({
        totalDefects: 3,
        unmapped: [{ label: "Near the thumb", count: 2, hand: null }],
      });
      expect(output.result.perSize?.M?.summary).toBe("3 / 500 (Finger 1, Near the thumb 2), Defect Limit 14 / 15: Passed.");
      expect(output.issues).toEqual([
        {
          level: "warning",
          code: "hole_unmapped",
          message:
            'Size M: "Near the thumb" (2) is not in the template\'s list of hole locations. It counts towards the total; an admin maps it to a defect code.',
          size: "M",
          path: ["sizes", "M", "unmapped", 0],
        },
      ]);
    });

    it("counts holes under a code the template does not list, with a warning", () => {
      const output = calcWatertight(input({ M: { tested: 500, holes: { glove_burst: 1 } } }));
      expect(output.computed.sizes.M.totalDefects).toBe(1);
      expect(output.computed.sizes.M.holes.glove_burst).toBe(1);
      expect(output.issues).toEqual([
        expect.objectContaining({ code: "hole_location_not_listed", path: ["sizes", "M", "holes", "glove_burst"] }),
      ]);
    });

    it("asks where the holes under 'Other :' were", () => {
      const missing = calcWatertight(input({ M: { tested: 500, holes: { hole_other: 1 } } }));
      expect(missing.issues).toEqual([
        expect.objectContaining({
          code: "hole_other_undescribed",
          message: 'Size M: 1 hole under "Other :" without saying where.',
          path: ["sizes", "M", "otherDescription"],
        }),
      ]);
      const described = calcWatertight(
        input({ M: { tested: 500, holes: { hole_other: 1 }, otherDescription: "Wrist" } }),
      );
      expect(described.issues).toEqual([]);
      expect(described.result.perSize?.M?.summary).toBe("1 / 500 (Other: Wrist 1), Defect Limit 14 / 15: Passed.");
    });

    it("warns when more holes are counted than gloves tested", () => {
      const context = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ watertightVisual: 13 }) } });
      const output = calcWatertight(input({ M: { tested: 13, holes: { hole_palm: 14 } } }, { context }));
      expect(codesOf(output.issues)).toContain("holes_exceed_tested");
      expect(output.result.perSize?.M?.status).toBe("fail");
    });
  });

  it("words summaries and messages in the template's labels", () => {
    const labels = { ...WATERTIGHT_LABELS, tested: "Gloves tested", defectLimit: "Limit", hole_finger: "Fingertip" };
    const output = calcWatertight(input({ M: { tested: 500, holes: { hole_finger: 1 } } }, { labels }));
    expect(output.result.perSize?.M?.summary).toBe("1 / 500 (Fingertip 1), Limit 14 / 15: Passed.");
    expect(output.computed.locations.find((location) => location.code === "hole_finger")?.label).toBe("Fingertip");
    expect(calcWatertight(input({ M: {} }, { labels })).result.perSize?.M?.summary).toBe(
      "Missing: Gloves tested (sampling plan: 500).",
    );
  });

  it("formats the heading's code letters and AQL as the reports print them", () => {
    expect(listCodeLetters([])).toBe("–");
    expect(listCodeLetters(["N", null, "N"])).toBe("N");
    expect(listCodeLetters(["L", "J", "L"])).toBe("J & L");
    expect(listCodeLetters(["M", "K", "L"])).toBe("K, L & M");
    expect([aqlCaption(0), aqlCaption(1.5), aqlCaption(4), aqlCaption(0.65)]).toEqual(["0.0", "1.5", "4.0", "0.65"]);
    expect(fillCaption("Holes (code {codeLetters}; AQL={aql}) {other}", { codeLetters: "N", aql: "1.5" })).toBe(
      "Holes (code N; AQL=1.5) {other}",
    );
  });

  describe("through the engine", () => {
    it("shows only ordered sizes and keeps the rest out of results (6.2 rule 4)", () => {
      const template = makeTestTemplate(MODULE_REGISTRY, ["watertight"]);
      const context = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ watertightVisual: 500 }) } });
      const data = {
        modules: {
          watertight: {
            sizes: { M: { tested: 500, holes: { hole_finger: 1 } }, XS: { tested: 80, holes: { hole_palm: 9 } } },
            comment: "One pinhole at the index finger.",
          },
        },
        custom: {},
      };
      const evaluation = evaluateInspection({ template, data, context }, MODULE_REGISTRY);
      const watertight = evaluation.modules.find((entry) => entry.key === "watertight");
      expect(watertight).toMatchObject({
        result: { status: "pass", perSize: { M: { status: "pass" } } },
        comment: "One pinhole at the index finger.",
      });
      expect(Object.keys(watertight?.result.perSize ?? {})).toEqual(["M"]);
      expect(Object.keys((watertight?.computed as { sizes: object }).sizes)).toEqual(["M"]);
      expect(watertight?.issues.map((issue) => [issue.code, issue.size])).toEqual([["size_not_ordered", "XS"]]);
    });

    it("reports text in a count as invalid data instead of reading it (6.2 rule 1)", () => {
      const template = makeTestTemplate(MODULE_REGISTRY, ["watertight"]);
      const context = makeTestContext({ sizes: ["XS"], sampling: { XS: makeSampling({ watertightVisual: 80 }) } });
      const data = { modules: { watertight: { sizes: { XS: { tested: "1/80" } } } }, custom: {} };
      const watertight = evaluateInspection({ template, data, context }, MODULE_REGISTRY).modules.find(
        (entry) => entry.key === "watertight",
      );
      expect(watertight?.result.status).toBe("not_done");
      expect(watertight?.issues).toEqual([
        expect.objectContaining({ level: "error", code: "invalid_data", path: ["sizes", "XS", "tested"] }),
      ]);
    });
  });

  describe("seed templates (lib/coverage)", () => {
    // Every other module as a placeholder, so this checks this module's schema only.
    const registry = Object.fromEntries(
      Object.values(MODULE_REGISTRY).map((entry) => [
        entry.key,
        entry.key === "watertight"
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
    const watertightOf = (code: TemplateCode) => {
      const resolution = resolveTemplate(seed(code), { getBase, registry });
      if (!resolution.ok) throw new Error(JSON.stringify(resolution.problems));
      const found = resolution.template.modules.find((entry) => entry.key === "watertight");
      if (!found) throw new Error(`${code} has no watertight`);
      return found;
    };

    it.each(["STD_EG", "SAFEDON_EG", "STD_SG"] as const)("%s resolves to the dictionary's config and wording", (code) => {
      const resolved = watertightOf(code);
      expect(resolved.config).toEqual(moduleConfig(code, "watertight"));
      expect(resolved.title).toBe(moduleTitle(code, "watertight"));
      expect(resolved.labels).toEqual({ ...defaultLabels("watertight"), ...labelOverrides(code, "watertight") });
    });

    it("SAFEDON_EG words the holes 'Holes' and adds Glove burst; STD_SG splits hands", () => {
      expect(watertightOf("SAFEDON_EG").labels.holes).toBe("Holes");
      expect(watertightOf("SAFEDON_EG").config.locations).toContainEqual({ code: "glove_burst", label: "Glove burst" });
      expect(watertightOf("STD_SG").config.handSplit).toBe(true);
    });
  });
});
