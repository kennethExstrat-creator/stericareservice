// Every real module's settings form (BUILD_SPEC 10: "a config form per
// module, generated from its config schema"), walking MODULE_REGISTRY:
// each config schema draws as a form of real controls; every setting is
// named by a label, never by its schema key; each seed template's settings
// show in the form and go back unchanged; a value out of range gets the
// schema's own limit, in plain words, on its field.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MODULE_KEYS, type ModuleKey } from "@/lib/schemas/module-result";
import type { TemplateDefinition } from "@/lib/schemas/template";
import { lookupFrom, type TemplateLookup } from "@/lib/templates";
import { SEED_TEMPLATES } from "@/lib/templates/definitions";
import { deepEqual, fieldLabel, getAt, setAt, type FormNode, type FormPath } from "@/lib/zod-form";
import { fieldId } from "@/lib/zod-form/schema-form";
import { resolveTemplate } from "@/modules";
import { MODULE_REGISTRY } from "@/modules/registry";
import { inheritanceOf } from "../_lib/inheritance";
import { moduleView, setConfig, type Draft, type EditorContext } from "../_lib/model";
import { collectProblems, type EditorProblem } from "../_lib/problems";
import { configNodeOf, settingNaming } from "../_lib/settings";
import { ConfigForm, configFieldPrefix } from "./config-form";
import type { EditorApi } from "./editor-api";

const SIZES = ["XS", "S", "M", "L", "XL"].map((value) => ({ value, label: value }));

/** A template of its own that lists every module, each with its defaults. */
function everyModuleDraft(): Draft {
  return {
    code: "EVERY_EG",
    name: "Every module",
    scope: { productType: "examination", standard: "EN455" },
    unit: "pcs",
    sizes: SIZES.map(({ value }) => ({ value })),
    modules: MODULE_KEYS.map((key) => ({ key, include: true })),
  };
}

function contextFor(draft: Draft, getBase: TemplateLookup = lookupFrom([])): EditorContext {
  return { inheritance: inheritanceOf(draft, getBase), registry: MODULE_REGISTRY };
}

function render(draft: Draft, context: EditorContext, key: ModuleKey, problems: EditorProblem[] = []): string {
  const api: EditorApi = {
    draft,
    context,
    problems,
    editable: true,
    update: () => {},
    reportDraftError: () => {},
    draftFor: () => undefined,
    sizes: SIZES,
    defectCodes: [{ code: "hole_finger", name: "Finger", active: true }],
    scopeOptions: { clients: [], manufacturers: [] },
    resetLabel: "Use default",
  };
  return renderToStaticMarkup(<ConfigForm api={api} view={moduleView(draft, context, key)} />);
}

type Setting = { path: FormPath; key: string; node: FormNode };

/** Every named setting of a form tree, nested ones too (inside objects, list items and union variants). */
function settingsOf(node: FormNode, path: FormPath = []): Setting[] {
  switch (node.kind) {
    case "object":
      return node.properties.flatMap((property) => [
        { path: [...path, property.key], key: property.key, node: property.node },
        ...settingsOf(property.node, [...path, property.key]),
      ]);
    case "array":
      return settingsOf(node.items, [...path, 0]);
    case "record":
      return settingsOf(node.value, [...path, "*"]);
    case "nullable":
      return settingsOf(node.inner, path);
    case "union":
      return node.variants.flatMap((variant) => settingsOf(variant.node, path));
    default:
      return [];
  }
}

function hasJson(node: FormNode): boolean {
  switch (node.kind) {
    case "json":
      return true;
    case "object":
      return node.properties.some((property) => hasJson(property.node));
    case "array":
      return hasJson(node.items);
    case "record":
      return hasJson(node.value);
    case "nullable":
      return hasJson(node.inner);
    case "union":
      return node.variants.some((variant) => hasJson(variant.node));
    default:
      return false;
  }
}

/** The number settings outside lists and records, with the lowest value each takes. */
function boundedNumbers(node: FormNode, path: FormPath = []): { path: FormPath; minimum: number }[] {
  if (node.kind === "nullable") return boundedNumbers(node.inner, path);
  if (node.kind === "number" && node.minimum !== undefined) return [{ path, minimum: node.minimum }];
  if (node.kind !== "object") return [];
  return node.properties.flatMap((property) => boundedNumbers(property.node, [...path, property.key]));
}

/** Each seed template's definition, in seed order (bases first), with a lookup of the ones before it. */
function seedDefinitions(): { definition: TemplateDefinition; getBase: TemplateLookup }[] {
  const versions: { definition: TemplateDefinition; version: number }[] = [];
  return SEED_TEMPLATES.map((seed) => {
    const definition = seed.definition("20000000-0000-4000-8000-000000000001");
    const getBase = lookupFrom([...versions]);
    versions.push({ definition, version: 1 });
    return { definition, getBase };
  });
}

describe("every module's settings form (MODULE_REGISTRY)", () => {
  it("draws every config schema as a form of real controls", () => {
    const draft = everyModuleDraft();
    const context = contextFor(draft);
    for (const key of MODULE_KEYS) {
      const definition = MODULE_REGISTRY[key];
      expect(definition.stub, `${key} is still a stub`).toBeFalsy();
      const node = configNodeOf(definition);
      expect(hasJson(node), `${key} leaves a setting to JSON text`).toBe(false);
      const html = render(draft, context, key);
      const settings = settingsOf(node).filter((setting) => !setting.path.includes(0) && !setting.path.includes("*"));
      if (settings.length === 0) {
        // No settings: the module says so, in its own words or the editor's.
        expect(html).toMatch(/No settings|has no settings/);
        continue;
      }
      expect(html, key).toContain('data-slot="schema-form"');
      // Every top-level setting has its field (or its group) on the form, found by the id the problem list links to.
      for (const setting of settingsOf(node).filter((entry) => entry.path.length === 1)) {
        expect(html, `${key}.${setting.key}`).toMatch(new RegExp(`id="${fieldId(configFieldPrefix(key), setting.path)}(-on|-type|-description)?"|>${escape(nameOf(key, setting, context, draft))}<`));
      }
    }
  });

  it("names every setting by a label, never by its schema key", () => {
    const draft = everyModuleDraft();
    const context = contextFor(draft);
    const raw: string[] = [];
    for (const key of MODULE_KEYS) {
      for (const setting of settingsOf(configNodeOf(MODULE_REGISTRY[key]))) {
        const name = nameOf(key, setting, context, draft);
        if (name === setting.key) raw.push(`${key}: ${setting.path.join(".")} reads "${name}"`);
      }
    }
    expect(raw).toEqual([]);
    // The ones the schemas leave untitled, as the admin reads them.
    const html = render(draft, context, "weight");
    expect(html).toMatch(/for="config-weight-n"[^>]*>Gloves weighed</);
    expect(render(draft, context, "force_at_break")).toMatch(/for="config-force_at_break-n"[^>]*>Gloves tested</);
    expect(render(draft, context, "labeling")).toMatch(/for="config-labeling-levels-inner-n"[^>]*>Boxes to inspect</);
    expect(render(draft, context, "dye_leak")).toMatch(/for="config-dye_leak-n"[^>]*>Pouches to test</);
  });

  it("shows each seed template's settings and writes them back unchanged", () => {
    let shown = 0;
    for (const { definition, getBase } of seedDefinitions()) {
      const draft = definition as Draft;
      const context = contextFor(draft, getBase);
      const before = resolveTemplate(definition, getBase);
      if (!before.ok) throw new Error(`${definition.code}: ${JSON.stringify(before.problems)}`);
      for (const entry of before.template.modules) {
        const view = moduleView(draft, context, entry.key);
        // The form shows the config the module runs with: its defaults, the bases', then this template's.
        expect(view.config, `${definition.code} ${entry.key}`).toEqual(entry.config);
        const html = render(draft, context, entry.key);
        for (const { path } of boundedNumbers(configNodeOf(MODULE_REGISTRY[entry.key]))) {
          const value = getAt(view.config, path);
          if (typeof value !== "number") continue;
          expect(html, `${definition.code} ${entry.key}.${path.join(".")}`).toMatch(
            new RegExp(`id="${fieldId(configFieldPrefix(entry.key), path)}"[^>]*value="${value}"|value="${value}"[^>]*id="${fieldId(configFieldPrefix(entry.key), path)}"`),
          );
          shown += 1;
        }
        // An untouched form hands back what it was given: the definition does not change.
        expect(deepEqual(setConfig(draft, context, entry.key, view.config), draft), `${definition.code} ${entry.key}`).toBe(true);
      }
      // ...and it still resolves to the same template.
      const after = resolveTemplate(draft, getBase);
      expect(after.ok && after.template).toEqual(before.template);
    }
    // Weight's n, threshold and decimals, force at break's, tensile's, dispensing's...: dozens, not a handful.
    expect(shown).toBeGreaterThan(20);
  });

  it("shows the unit of every measured setting: the schema's (N, MPa, %), else the canonical unit of a module's specs", () => {
    const draft = everyModuleDraft();
    const context = contextFor(draft);
    const unitAt = (key: ModuleKey, html: string, path: FormPath) => unitOf(html, fieldId(configFieldPrefix(key), path));
    // From the schemas: .meta({ unit }) and the Pct keys (BUILD_SPEC 4.2 rule 5: mm, g, N, MPa and %).
    expect(unitAt("force_at_break", render(draft, context, "force_at_break"), ["specMin"])).toBe("N");
    const tensile = render(draft, context, "tensile");
    expect(unitAt("tensile", tensile, ["tensileMin"])).toBe("MPa");
    expect(unitAt("tensile", tensile, ["elongationMin"])).toBe("%");
    expect(unitAt("dispensing_packing", render(draft, context, "dispensing_packing"), ["minLayeringPct"])).toBe("%");
    expect(unitAt("dispensing_safedon", render(draft, context, "dispensing_safedon"), ["maxRatePct"])).toBe("%");
    expect(unitAt("weight", render(draft, context, "weight"), ["warnThresholdPct"])).toBe("%");
    // Counts have none.
    expect(unitAt("weight", render(draft, context, "weight"), ["n"])).toBeNull();

    // A spec's values, which the shared spec schema cannot mark: STD_EG's dimension specs in mm, a weight spec in g.
    const [{ definition, getBase }] = seedDefinitions();
    const stdEg = definition as Draft;
    const stdContext = contextFor(stdEg, getBase);
    const weighed = setConfig(stdEg, stdContext, "weight", {
      ...(moduleView(stdEg, stdContext, "weight").config as object),
      specs: [{ size: "M", spec: { kind: "range", min: 3, max: 4 } }],
    });
    for (const [key, unit, html] of [
      ["dimensions", "mm", render(stdEg, stdContext, "dimensions")],
      ["weight", "g", render(weighed, contextFor(weighed, getBase), "weight")],
    ] as const) {
      const ids = [...html.matchAll(new RegExp(`id="(config-${key}-specs-[^"]+-(?:min|max|nominal|tolerance))"`, "g"))].map(
        (match) => match[1],
      );
      expect(ids.length, key).toBeGreaterThan(0);
      for (const id of ids) expect(unitOf(html, id), id).toBe(unit);
    }
  });

  it("puts the schema's own limit, in plain words, on the field that breaks it", () => {
    const checked: string[] = [];
    for (const key of MODULE_KEYS) {
      const [number] = boundedNumbers(configNodeOf(MODULE_REGISTRY[key]));
      if (!number) continue;
      const draft = everyModuleDraft();
      const context = contextFor(draft);
      const broken = setConfig(draft, context, key, setAt(moduleView(draft, context, key).config, number.path, number.minimum - 1));
      const { problems } = collectProblems(broken, contextFor(broken), { code: "EVERY_EG", getBase: lookupFrom([]) });
      const mine = problems.filter(
        (problem) =>
          problem.place.area === "module" &&
          problem.place.moduleKey === key &&
          problem.place.part === "config" &&
          deepEqual(problem.place.path, number.path),
      );
      // The schema's limit in plain words; zod's generic "Too small: expected number to be >=1" never reaches the admin.
      expect(mine.map((problem) => problem.message), `${key}.${number.path.join(".")}`).toEqual([
        `Must be ${number.minimum} or more.`,
      ]);
      const html = render(broken, contextFor(broken), key, problems);
      const errorsId = `${fieldId(configFieldPrefix(key), number.path)}-errors`;
      expect(html, key).toContain(`id="${errorsId}"`);
      expect(html.slice(html.indexOf(`id="${errorsId}"`))).toContain(escape(mine[0].message));
      checked.push(key);
    }
    // Most modules have a bounded number at the top: the walk reaches them.
    expect(checked).toEqual(expect.arrayContaining(["weight", "force_at_break", "tensile", "dimensions", "dispensing_packing"]));
  });
});

/** A setting's name as the editor shows it. */
function nameOf(key: ModuleKey, setting: Setting, context: EditorContext, draft: Draft): string {
  const naming = settingNaming(key, moduleView(draft, context, key).labels, SIZES);
  return fieldLabel(setting.node, setting.key, setting.path, naming);
}

/** The unit drawn beside a number field (its input group's addon), or null when it has none. */
function unitOf(html: string, id: string): string | null {
  const start = html.indexOf(`id="${id}"`);
  if (start === -1) throw new Error(`no field ${id}`);
  // The input ends its group: the addon follows before the group's </div>.
  const group = html.slice(start, html.indexOf("</div>", start) + "</div>".length);
  return /data-slot="input-group-addon"[^>]*>([^<]*)</.exec(group)?.[1] ?? null;
}

/** Text as renderToStaticMarkup writes it. */
function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}
