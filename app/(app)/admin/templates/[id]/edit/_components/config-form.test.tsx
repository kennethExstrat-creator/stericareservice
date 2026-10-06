// A module's settings form, server-rendered against modules shaped like the
// real ones: defect codes get the code list and a note when unmapped (4.2
// rule 4), other codes do not; numbers say their range; a module without
// settings says so.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ModuleKey } from "@/lib/schemas/module-result";
import { defineModule, type ModuleRegistry } from "@/modules/_framework";
import { TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { NO_INHERITANCE } from "../_lib/inheritance";
import { moduleView, type Draft, type EditorContext } from "../_lib/model";
import { ConfigForm } from "./config-form";
import type { EditorApi } from "./editor-api";

const DefectCode = z.string().regex(/^[a-z][a-z0-9_]*$/, { error: "Defect codes are snake case." });
const notDone = () => ({ result: { status: "not_done" as const, summary: "" }, computed: {}, issues: [] });

const watertight = defineModule({
  key: "watertight",
  title: "Freedom from Holes by watertight test",
  labels: {},
  dataSchema: z.strictObject({}),
  emptyData: () => ({}),
  configSchema: z.strictObject({
    locations: z.array(z.strictObject({ code: DefectCode.describe("Defect code (defect_codes)"), label: z.string().min(1) })),
    stickinessCodes: z.array(z.strictObject({ code: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/), pass: z.boolean() })),
    aql: z.number().min(0).max(10),
  }),
  defaultConfig: {
    locations: [
      { code: "hole_finger", label: "Finger" },
      { code: "pin_hole", label: "Pin hole" },
    ],
    stickinessCodes: [{ code: "b1", pass: true }],
    aql: 1.5,
  },
  calc: notDone,
});

const cartonSampling = defineModule({
  key: "carton_sampling",
  title: "Finished Goods Sampling Information (carton number)",
  labels: {},
  dataSchema: z.strictObject({}),
  emptyData: () => ({}),
  configSchema: z.strictObject({}).describe("No settings: cartons are checked the same way in every template."),
  defaultConfig: {},
  calc: notDone,
});

const dimensions = defineModule({
  key: "dimensions",
  title: "Dimension",
  // "statistic" is the report's row label; the config's "statistic" is the choice of median or average.
  labels: { length: "Length", statistic: "Median" },
  dataSchema: z.strictObject({}),
  emptyData: () => ({}),
  configSchema: z.strictObject({
    statistic: z.enum(["median", "average"]),
    decimals: z.strictObject({ length: z.number().int().min(0).max(10) }),
  }),
  defaultConfig: { statistic: "median", decimals: { length: 0 } },
  calc: notDone,
});

const registry = { ...TEST_REGISTRY, watertight, carton_sampling: cartonSampling, dimensions } as ModuleRegistry;

const draft: Draft = {
  code: "E2E_FORM",
  name: "Form",
  scope: { productType: "examination", standard: "EN455" },
  unit: "pcs",
  sizes: [{ value: "M" }],
  modules: [
    { key: "header", include: true },
    { key: "watertight", include: true },
    { key: "carton_sampling", include: true },
    { key: "dimensions", include: true },
    { key: "conclusion", include: true },
  ],
};

function render(key: ModuleKey) {
  const context: EditorContext = { inheritance: NO_INHERITANCE, registry };
  const api: EditorApi = {
    draft,
    context,
    problems: [],
    editable: true,
    update: () => {},
    reportDraftError: () => {},
    sizes: [{ value: "M", label: "M" }],
    defectCodes: [{ code: "hole_finger", name: "Finger", active: true }],
    scopeOptions: { clients: [], manufacturers: [] },
    resetLabel: "Use default",
  };
  return renderToStaticMarkup(<ConfigForm api={api} view={moduleView(draft, context, key)} />);
}

describe("ConfigForm", () => {
  it("offers the defect codes on defect code fields only, and flags a code that is not one of them", () => {
    const html = render("watertight");
    expect(html).toContain('list="config-watertight-locations-0-code-suggestions"');
    expect(html).toContain('<option value="hole_finger">Finger</option>');
    expect(html).not.toContain("config-watertight-stickinessCodes-0-code-suggestions");
    // pin_hole is not a defect code; the stickiness code b1 is no defect code at all.
    expect(html.match(/Not one of the defect codes/g)).toHaveLength(1);
  });

  it("says what a number accepts", () => {
    expect(render("watertight")).toContain('<p id="config-watertight-aql-range" class="text-sm text-muted-foreground">0 to 10.</p>');
  });

  it("names settings in the module's words, but not a choice after a row label", () => {
    const html = render("dimensions");
    expect(html).toMatch(/for="config-dimensions-decimals-length"[^>]*>Length</);
    expect(html).toMatch(/for="config-dimensions-statistic"[^>]*>Statistic</);
  });

  it("says when a module has no settings, in the module's own words", () => {
    const html = render("carton_sampling");
    expect(html).toContain("No settings: cartons are checked the same way in every template.");
    expect(html).not.toContain('data-slot="schema-form"');
  });
});
