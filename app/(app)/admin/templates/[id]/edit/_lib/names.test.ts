// The problem list names each place by the labels the admin sees on the way
// there (BUILD_SPEC 6.2: each problem with a link), never by schema keys:
// a weight setting is "Gloves weighed", not "n"; a custom field's lowest
// value is "Lowest value", not "Min". Real modules, real seed template.
import { describe, expect, it } from "vitest";
import type { CustomModule } from "@/lib/schemas/template";
import { lookupFrom } from "@/lib/templates";
import { STD_EG_SEED } from "@/lib/templates/definitions";
import { MODULE_REGISTRY } from "@/modules/registry";
import { inheritanceOf } from "./inheritance";
import { setConfig, setLabel, type Draft, type EditorContext } from "./model";
import { customFieldName, customPathLabels, placeLabels, type NamingScope } from "./names";
import { collectProblems, serverProblem, type ProblemPlace } from "./problems";

const SIZES = [
  { value: "S", label: "S" },
  { value: "M", label: "Medium (M)" },
];

const getBase = lookupFrom([]);

function scopeOf(draft: Draft): NamingScope {
  const context: EditorContext = { inheritance: inheritanceOf(draft, getBase), registry: MODULE_REGISTRY };
  return { draft, context, sizes: SIZES, shapeOk: true };
}

/** Every problem of a draft, named as the problem list names it. */
function named(draft: Draft): string[] {
  const scope = scopeOf(draft);
  const { problems } = collectProblems(draft, scope.context, { code: draft.code, getBase });
  return problems.map((problem) => placeLabels(problem.place, scope).join(" › "));
}

const stdEg = () => STD_EG_SEED.definition() as Draft;

describe("placeLabels", () => {
  it("names a module's settings by the labels of its form, not by schema keys", () => {
    const draft = stdEg();
    const { context } = scopeOf(draft);
    const broken = setConfig(draft, context, "weight", { n: 0, warnThresholdPct: -1 });
    expect(named(broken)).toEqual([
      "Weight (g) - average of 13 gloves per size › Settings › Gloves Weighed",
      "Weight (g) - average of 13 gloves per size › Settings › Warn Threshold %",
    ]);
  });

  it("names list items by position and nested settings by their labels", () => {
    const draft = stdEg();
    const scope = scopeOf(draft);
    const title = (key: "watertight" | "labeling") =>
      placeLabels({ area: "module", moduleKey: key, part: "title", path: [] }, scope)[0];
    const at = (place: ProblemPlace) => placeLabels(place, scope);
    expect(at({ area: "module", moduleKey: "watertight", part: "config", path: ["locations", 1, "label"] })).toEqual([
      title("watertight"),
      "Settings",
      "Locations",
      "Location 2",
      "Label",
    ]);
    // labelling's boxes per level: "n" in the schema, named for the admin.
    expect(at({ area: "module", moduleKey: "labeling", part: "config", path: ["levels", "inner", "n"] })).toEqual([
      title("labeling"),
      "Settings",
      "Levels",
      "Inner",
      "Boxes to Inspect",
    ]);
    expect(at({ area: "module", moduleKey: "dye_leak", part: "config", path: ["n"] }).at(-1)).toBe("Pouches to Test");
    expect(at({ area: "module", moduleKey: "force_at_break", part: "config", path: ["n"] }).at(-1)).toBe("Gloves Tested");
  });

  it("names a label by the wording it replaces, and the module's switch and heading by their fields", () => {
    const draft = stdEg();
    const { context } = scopeOf(draft);
    const relabelled = setLabel(draft, context, "header", "poNo", "");
    const scope = scopeOf(relabelled);
    const header = placeLabels({ area: "module", moduleKey: "header", part: "title", path: [] }, scope)[0];
    expect(placeLabels({ area: "module", moduleKey: "header", part: "labels", path: ["poNo"] }, scope)).toEqual([
      header,
      "Labels",
      MODULE_REGISTRY.header.labels.poNo,
    ]);
    expect(placeLabels({ area: "module", moduleKey: "order_lots", part: "include", path: [] }, scope).slice(1)).toEqual([
      "Include This Module",
    ]);
    expect(placeLabels({ area: "module", moduleKey: "header", part: "title", path: [] }, scope).slice(1)).toEqual(["Heading"]);
  });

  it("names a custom module's parts as its form does", () => {
    const custom: CustomModule = {
      key: "glove_type",
      title: "Glove type",
      after: "header",
      layout: "grid",
      fields: [
        { key: "gloveType", label: "Glove type", type: "text" },
        { key: "cuffLength", label: "Cuff length", type: "number", min: 5, max: 2 },
      ],
      grid: { columns: { label: "Box #", default: 13, addable: true } },
    };
    const draft: Draft = { ...stdEg(), customModules: [custom] };
    const scope = scopeOf(draft);
    const where = (path: (string | number)[]) =>
      placeLabels({ area: "custom", index: 0, customKey: "glove_type", path }, scope).join(" › ");
    expect(where(["fields", 1, "min"])).toBe("Custom Module Glove type › Fields › 2. Cuff length › Lowest Value");
    expect(where(["fields", 0, "mapsTo"])).toBe("Custom Module Glove type › Fields › 1. Glove type › Shows a Module's Value");
    expect(where(["grid", "columns", "default"])).toBe("Custom Module Glove type › Repeated Columns › Columns to Start With");
    expect(where(["grid", "repeatPer"])).toBe("Custom Module Glove type › Repeated Columns › One Grid for Each Ordered Size");
    expect(where(["after"])).toBe("Custom Module Glove type › Comes After");
    expect(where([])).toBe("Custom Module Glove type");
    // A field without a label yet is named by its place, as its form heads it.
    expect(customFieldName({ label: " " }, 2)).toBe("3. Field 3");
    expect(customPathLabels(undefined, ["fields", 4, "label"])).toEqual(["Fields", "5. Field 5", "Label"]);
  });

  it("names the template's own fields as the Details tab does, and the rest by tab", () => {
    const scope = scopeOf(stdEg());
    const where = (path: (string | number)[]) => placeLabels({ area: "template", path }, scope).join(" › ");
    expect(where(["scope", "clientId"])).toBe("Details › Where It Applies › Client");
    expect(where(["ai", "reviewOnSubmit"])).toBe("Details › AI Second Opinion on Submit");
    expect(where(["sizes", 1, "label"])).toBe("Details › Sizes › Size 2 › Shown As");
    expect(where(["report", "showClientLogo"])).toBe("Details › AI Report › Show the Client's Logo");
    expect(where(["unit"])).toBe("Details › Counted In");
    expect(where(["extends"])).toBe("Details › Base Template");
    expect(where(["json"])).toBe("JSON Tab");
    expect(where(["sourceFile"])).toBe("Template › Source File");
  });

  it("names every problem of a broken draft without a bare schema key", () => {
    const draft = stdEg();
    const { context } = scopeOf(draft);
    let broken = setConfig(draft, context, "weight", { n: 0 });
    broken = setConfig(broken, scopeOf(broken).context, "force_at_break", { n: -2 });
    broken = { ...broken, name: " ", customModules: [{ key: "x", title: "X", after: "header", layout: "fields", fields: [{ key: "a", label: "A", type: "number", min: 3, max: 1 }] }] };
    const names = named(broken);
    expect(names.length).toBeGreaterThanOrEqual(3);
    for (const name of names) expect(name.split(" › ")).not.toContain("n");
    expect(names).toEqual(expect.arrayContaining([expect.stringMatching(/› Gloves Weighed$/), expect.stringMatching(/› Gloves Tested$/), "Details › Name"]));
  });
});

describe("serverProblem", () => {
  it("names what the save action found as the problem list does, never by schema keys", () => {
    const draft = stdEg();
    const scope = scopeOf(draft);
    const where = (problem: { template: string; path: (string | number)[]; message: string }) => {
      const found = serverProblem(draft, problem, draft.code);
      return [placeLabels(found.place, scope).join(" › "), found.message];
    };
    const weight = "Weight (g) - average of 13 gloves per size › Settings › Gloves Weighed";
    // A definition that did not parse: TemplateDefinitionSchema's path, modules by position.
    const at = draft.modules.findIndex((entry) => entry.key === "weight");
    expect(where({ template: "", path: ["modules", at, "config", "n"], message: "Must be 1 or more." })).toEqual([
      weight,
      "Must be 1 or more.",
    ]);
    // The resolver's: modules by key, in this template...
    expect(where({ template: draft.code, path: ["modules", "weight", "config", "n"], message: "Must be 1 or more." })).toEqual([
      weight,
      "Must be 1 or more.",
    ]);
    // ...or in a base, which the admin changes through the base template.
    expect(where({ template: "BASE_EG", path: ["modules", "visual", "config"], message: "Unknown defect." })).toEqual([
      "Details › Base Template",
      "In base template BASE_EG: Unknown defect.",
    ]);
  });
});
