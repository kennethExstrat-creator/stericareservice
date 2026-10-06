import { describe, expect, it } from "vitest";
import { isModuleKey, MODULE_KEYS } from "@/lib/schemas/module-result";
import { SAFEDON_DISPENSING_DEFECTS, VISUAL_DEFECTS } from "./defects";
import { captionLabel, dataField, fieldLabel, moduleSpec } from "./fields";
import { DEFECT_CLASSES, LABELLING_CHECKS, LABELLING_LEVELS } from "./keys";
import { slug, SOURCE_DOCUMENTS, SOURCE_FIELDS, sourceFields } from "./sources";
import { fieldShown, moduleConfig, templateModuleKeys, templateOfSource, TEMPLATES } from "./templates";
import {
  isConfigTarget,
  isCustomTarget,
  isFieldTarget,
  isLabelTarget,
  isLayoutTarget,
  isTemplateTarget,
  SOURCE_IDS,
  TEMPLATE_PROPERTIES,
  type SourceField,
  type SourceId,
  type SourceInput,
  type SourceTarget,
  type TemplateCode,
} from "./types";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `{name}` in a template label matches whatever the source printed there. */
function matchesLabel(printed: string, label: string): boolean {
  if (!/\{\w+\}/.test(label)) return printed === label;
  const pattern = label.split(/\{\w+\}/).map(escapeRegExp).join(".+?");
  return new RegExp(`^${pattern}$`).test(printed);
}

/** The label a list entry (defect, location, check) has in the template's config. */
function listItemLabel(template: TemplateCode, target: SourceTarget): string | undefined {
  if (!isFieldTarget(target) || target.key === undefined) return undefined;
  const { module, group, key } = target;
  if (module === "watertight") return moduleConfig(template, "watertight")?.locations.find((item) => item.code === key)?.label;
  if (module === "visual" && group) {
    const classes = moduleConfig(template, "visual")?.classes;
    return classes?.[group as (typeof DEFECT_CLASSES)[number]]?.defects.find((item) => item.code === key)?.label;
  }
  if (module === "labeling" && group) {
    const levels = moduleConfig(template, "labeling")?.levels;
    return levels?.[group as (typeof LABELLING_LEVELS)[number]]?.checks.find((item) => item.code === key)?.label;
  }
  if (module === "dispensing_safedon") {
    return moduleConfig(template, "dispensing_safedon")?.defects.find((item) => item.code === key)?.label;
  }
  return undefined;
}

/** What the template shows for a target, or undefined when the target has no single label. */
function templateLabelOf(template: TemplateCode, target: SourceTarget): string | undefined {
  if (isFieldTarget(target)) {
    return target.key === undefined
      ? fieldLabel(template, target.module, target.field, target.group)
      : listItemLabel(template, target);
  }
  if (isLabelTarget(target)) return captionLabel(template, target.module, target.label);
  if (isConfigTarget(target) && target.key !== undefined) {
    if (target.module === "dispensing_packing" && target.config === "stickinessCodes") {
      const code = moduleConfig(template, "dispensing_packing")?.stickinessCodes.find((item) => item.code === target.key);
      return code && `${code.code} = ${code.label} (${code.pass ? "Passed" : "Failed"})`;
    }
    if (target.module === "dispensing_safedon" && target.config === "defects") {
      const defect = SAFEDON_DISPENSING_DEFECTS.find((item) => item.code === target.key);
      return defect && (defect.correctedHint ?? defect.printedHint);
    }
  }
  if (isCustomTarget(target)) {
    const customModule = TEMPLATES[template].customModules.find((item) => item.key === target.custom);
    return customModule?.fields.find((field) => field.key === target.field)?.label;
  }
  return undefined;
}

/** Sources whose wording is the template's: the reports for their templates, the SG form for STD_SG. */
const WORDING_SOURCES: Partial<Record<SourceId, TemplateCode>> = {
  report_STD_EG: "STD_EG",
  report_SAFEDON_EG: "SAFEDON_EG",
  onsite_SG: "STD_SG",
};

const LABELLED_INPUTS = new Set<SourceInput>([
  "text",
  "number",
  "date",
  "select",
  "computed",
  "fixed",
  "heading",
  "label",
  "handwritten_rows",
  "repeat",
]);

const TYPOS = [/\bFactrory\b/, /\bpackaing\b/, /\bEmbeded\b/, /\bsickiness\b/, /\bThin batch\b/, /\bideallly\b/, /\bould\b/];

/** Cells someone writes in, ticks or picks on the source. */
const WRITTEN_INPUTS = new Set<SourceInput>(["text", "number", "date", "select", "signature", "handwritten_rows", "blank"]);

/** A target that keeps a value as written: an entered or recorded field, a custom field, or the size list. */
function keepsValue(target: SourceTarget): boolean {
  if (isFieldTarget(target)) return dataField(target.module, target.field)?.entry !== "computed";
  if (isCustomTarget(target)) return true;
  return isTemplateTarget(target) && target.template === "sizes";
}

const where = (field: SourceField) => `${field.id} (${field.label})`;

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe("the inventory", () => {
  it("lists fields for every source document, and only for those", () => {
    expect(Object.keys(SOURCE_DOCUMENTS)).toEqual([...SOURCE_IDS]);
    for (const source of SOURCE_IDS) expect(sourceFields(source).length, source).toBeGreaterThan(0);
    for (const field of SOURCE_FIELDS) expect(SOURCE_IDS, field.id).toContain(field.source);
  });

  it("keeps every field: the count per document only changes on purpose", () => {
    expect(Object.fromEntries(SOURCE_IDS.map((source) => [source, sourceFields(source).length]))).toEqual({
      report_STD_EG: 150,
      report_SAFEDON_EG: 158,
      onsite_EG: 43,
      onsite_SG: 42,
      onsite_SAFEDON_EG: 54,
    });
  });

  it("gives every field a unique, stable id", () => {
    const ids = SOURCE_FIELDS.map((field) => field.id);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    for (const field of SOURCE_FIELDS) {
      expect(field.id).toBe(`${field.source}:${slug(field.section)}:${slug(field.label)}`);
      expect(field.label.trim(), field.id).toBe(field.label);
      expect(field.label, field.id).not.toBe("");
    }
  });
});

describe("every source field has a target (rule 4.2.2: nothing lost)", () => {
  it("maps every field somewhere", () => {
    for (const field of SOURCE_FIELDS) expect(field.targets.length, where(field)).toBeGreaterThan(0);
  });

  it("maps to modules that exist in ModuleKey and are switched on in the source's template", () => {
    for (const field of SOURCE_FIELDS) {
      const template = templateOfSource(field.source);
      for (const target of field.targets) {
        if (!("module" in target)) continue;
        expect(isModuleKey(target.module), where(field)).toBe(true);
        expect(templateModuleKeys(template), `${where(field)} -> ${target.module}`).toContain(target.module);
      }
    }
  });

  it("maps to fields, config keys, captions, custom fields and template properties that exist", () => {
    for (const field of SOURCE_FIELDS) {
      const template = templateOfSource(field.source);
      for (const target of field.targets) {
        const name = `${where(field)} -> ${JSON.stringify(target)}`;
        if (isFieldTarget(target)) {
          const spec = dataField(target.module, target.field);
          expect(spec, name).toBeDefined();
          if (target.group !== undefined) {
            expect(moduleSpec(target.module).groups ?? [], name).toContain(target.group);
            expect(spec?.per ?? [], name).toEqual(expect.arrayContaining([target.module === "visual" ? "class" : "level"]));
          }
          if (target.key !== undefined) {
            expect(spec?.type, name).toBe("count_map");
            expect(listItemLabel(template, target), name).toBeDefined();
          }
        } else if (isConfigTarget(target)) {
          expect(moduleSpec(target.module).config.map((config) => config.key), name).toContain(target.config);
          if (target.key !== undefined && target.config === "classes") expect(DEFECT_CLASSES, name).toContain(target.key);
          if (target.key !== undefined && target.config === "levels") expect(LABELLING_LEVELS, name).toContain(target.key);
          if (target.key !== undefined && ["stickinessCodes", "defects"].includes(target.config)) {
            expect(templateLabelOf(template, target), name).toBeDefined();
          }
        } else if (isLabelTarget(target)) {
          expect(captionLabel(template, target.module, target.label), name).toBeDefined();
        } else if (isCustomTarget(target)) {
          expect(templateLabelOf(template, target), name).toBeDefined();
        } else if (isTemplateTarget(target)) {
          expect(TEMPLATE_PROPERTIES, name).toContain(target.template);
        } else {
          expect(isLayoutTarget(target), name).toBe(true);
          if (isLayoutTarget(target)) expect(target.layout, name).not.toBe("");
        }
      }
    }
  });

  it("reaches every module of every template from its sources, except STD_SG's planned-only dimensions and dye leak", () => {
    for (const template of Object.keys(TEMPLATES) as TemplateCode[]) {
      const reached = new Set(
        SOURCE_FIELDS.filter((field) => templateOfSource(field.source) === template).flatMap((field) =>
          field.targets.flatMap((target) => ("module" in target ? [target.module] : [])),
        ),
      );
      const missing = templateModuleKeys(template).filter((key) => !reached.has(key));
      expect(missing, template).toEqual(template === "STD_SG" ? ["dimensions", "dye_leak"] : []);
    }
  });

  it("holds what no module holds in a custom module: Glove Type, and the Safedon sheet's free text", () => {
    const customs = SOURCE_FIELDS.flatMap((field) =>
      field.targets.filter(isCustomTarget).map((target) => `${field.source}: ${field.label} -> ${target.custom}.${target.field}`),
    );
    expect(customs).toEqual([
      "onsite_EG: Glove Type -> glove_type.gloveType",
      "onsite_SG: Glove Type -> glove_type.gloveType",
      "onsite_SAFEDON_EG: Glove Type -> glove_type.gloveType",
      "onsite_SAFEDON_EG: Specification / Requirement -> safedon_dispensing_notes.specRequirement",
      "onsite_SAFEDON_EG: Conclusion -> safedon_dispensing_notes.conclusion",
    ]);
  });

  it("keeps what is written: every cell filled in on a source lands on an entered, recorded or custom field", () => {
    const notKept = SOURCE_FIELDS.filter((field) => WRITTEN_INPUTS.has(field.input) && !field.targets.some(keepsValue));
    // Only a count the reports print that the app derives from what is entered (rule 6.2.2):
    // the carton grid's Sampling Quantity is the number of carton numbers.
    expect(notKept.map((field) => field.id)).toEqual([
      "report_STD_EG:page-1-finished-goods-sampling-information-carton-number:sampling-quantity",
      "report_SAFEDON_EG:page-1-finished-goods-sampling-information-carton-number:sampling-quantity",
    ]);
  });

  it("lands only on fields the template shows: none is switched off in its config", () => {
    const hidden = SOURCE_FIELDS.flatMap((field) =>
      field.targets
        .filter(isFieldTarget)
        .filter((target) => !fieldShown(templateOfSource(field.source), target))
        .map((target) => `${field.id} -> ${target.module}.${target.field}${target.group ? `[${target.group}]` : ""}`),
    );
    expect(hidden).toEqual([]);
  });
});

describe("[sic] corrections", () => {
  const corrected = SOURCE_FIELDS.filter((field) => field.corrected !== undefined);

  it("corrects every printed typo, and only typos and mislabelled lines", () => {
    for (const field of SOURCE_FIELDS) {
      const typo = TYPOS.some((pattern) => pattern.test(field.label));
      if (typo) expect(field.corrected, where(field)).toBeDefined();
      if (field.corrected !== undefined) {
        expect(field.corrected, where(field)).not.toBe(field.label);
        for (const pattern of TYPOS) expect(field.corrected, where(field)).not.toMatch(pattern);
      }
    }
  });

  it("covers each [sic] the source documents mark, on both reports", () => {
    const fixes = new Set(corrected.map((field) => `${field.source}: ${field.label} -> ${field.corrected}`));
    for (const fix of [
      "report_STD_EG: Factrory glove code -> Factory glove code",
      "report_STD_EG: # inner box for packaing & dispensing inspection -> # inner box for packaging & dispensing inspection",
      "report_STD_EG: Embeded Insects -> Embedded Insects",
      "report_STD_EG: Embeded metal debris -> Embedded metal debris",
      "report_STD_EG: Disposition - Visual Minor (Passed / Failed) -> Disposition - Visual Critical (Passed / Failed)",
      "report_STD_EG: Disposition - Inner Box (Passed / Failed) -> Disposition - Carton Box (Passed / Failed)",
      "report_STD_EG: B1 = A mix of non sticky to light sickiness at the bead (Passed) -> B1 = A mix of non sticky to light stickiness at the bead (Passed)",
      "report_SAFEDON_EG: # inner packs for packaing & dispensing inspection -> # inner packs for packaging & dispensing inspection",
      "report_SAFEDON_EG: Embeded Insects -> Embedded Insects",
      "report_SAFEDON_EG: Embeded metal debris -> Embedded metal debris",
      "report_SAFEDON_EG: Disposition - Visual Minor (Passed / Failed) -> Disposition - Visual Critical (Passed / Failed)",
      "report_SAFEDON_EG: Thin batch / area (body) -> Thin patch / area (body)",
      "report_SAFEDON_EG: Cuff should ideallly be at least 2 cm out -> Cuff should ideally be at least 2 cm out",
      "report_SAFEDON_EG: Glove ould not be dispensed or very difficult to dispense -> Glove could not be dispensed or very difficult to dispense",
      "onsite_SAFEDON_EG: Cuff should ideallly be at least 2 cm out -> Cuff should ideally be at least 2 cm out",
      "onsite_SAFEDON_EG: Glove ould not be dispensed or very difficult to dispense -> Glove could not be dispensed or very difficult to dispense",
    ]) {
      expect(fixes, fix).toContain(fix);
    }
    // 7 per report, plus the two printed definition typos of the Safedon onsite sheet.
    expect(corrected).toHaveLength(16);
  });

  it("keeps the printed visual defect labels in defects.ts", () => {
    for (const field of corrected) {
      const [target] = field.targets;
      if (!isFieldTarget(target) || target.module !== "visual" || target.key === undefined || !target.group) continue;
      const template = templateOfSource(field.source);
      const defect = VISUAL_DEFECTS[template][target.group as (typeof DEFECT_CLASSES)[number]].find(
        (item) => item.code === target.key,
      );
      expect(defect?.printed, where(field)).toBe(field.label);
      expect(defect?.label, where(field)).toBe(field.corrected);
    }
  });
});

describe("their wording, our keys (rule 4.2.3)", () => {
  const checked = SOURCE_FIELDS.filter(
    (field) => WORDING_SOURCES[field.source] && field.templateLabel !== false && LABELLED_INPUTS.has(field.input),
  );

  it("shows each printed label, [sic] fixed, as the template's label of the field it maps to", () => {
    let compared = 0;
    for (const field of checked) {
      const template = WORDING_SOURCES[field.source] as TemplateCode;
      const [target] = field.targets;
      const expected = templateLabelOf(template, target);
      if (expected === undefined) {
        // Only values with no single label of their own: a config value as a whole, the size list,
        // the title block, a legend the AI report draws.
        expect(isConfigTarget(target) || isTemplateTarget(target) || isLayoutTarget(target), where(field)).toBe(true);
        continue;
      }
      compared += 1;
      expect(matchesLabel(field.corrected ?? field.label, expected), `${where(field)}: template shows "${expected}"`).toBe(true);
    }
    expect(compared).toBeGreaterThan(230);
  });

  it("prints the report title from the template and leaves running headers to the AI report", () => {
    let headers = 0;
    for (const field of SOURCE_FIELDS) {
      const template = WORDING_SOURCES[field.source];
      const [target] = field.targets;
      if (!template) continue;
      if (isTemplateTarget(target) && target.template === "report.titleLines") {
        expect(TEMPLATES[template].report.titleLines, where(field)).toContain(field.label);
      }
      if (field.input === "page" && /<PO>/.test(field.label)) {
        headers += 1;
        // BUILD_SPEC 4.3's report settings hold a title and the client logo only.
        expect(field.targets, where(field)).toEqual([{ layout: expect.stringContaining(`'${field.label}'`) }]);
      }
    }
    expect(headers).toBe(2);
  });

  it("maps the six Safedon dispensing rows to their defect codes on the report and the onsite sheet", () => {
    for (const source of ["report_SAFEDON_EG", "onsite_SAFEDON_EG"] as const) {
      const rows = sourceFields(source)
        .map((field) => field.targets[0])
        .filter((target) => isFieldTarget(target) && target.module === "dispensing_safedon" && target.key !== undefined)
        .map((target) => (isFieldTarget(target) ? target.key : undefined));
      expect(rows, source).toEqual(SAFEDON_DISPENSING_DEFECTS.map((defect) => defect.code));
    }
  });

  it("maps every labelling check to a check code of BUILD_SPEC 11", () => {
    for (const field of SOURCE_FIELDS) {
      for (const target of field.targets) {
        if (isFieldTarget(target) && target.module === "labeling" && target.key !== undefined) {
          expect(LABELLING_CHECKS, where(field)).toContain(target.key);
        }
      }
    }
  });
});

describe("onsite forms", () => {
  it("repeats the EG form's sections 1 to 5 on the Safedon EG form, field for field, with the Safedon title", () => {
    const sections = (source: SourceId) =>
      sourceFields(source)
        .filter((field) => /^[1-5]\. /.test(field.section))
        .map((field) => `${field.section} | ${field.label} | ${JSON.stringify(field.targets)}`);
    const eg = sections("onsite_EG");
    const safedon = sections("onsite_SAFEDON_EG");
    expect(safedon).toHaveLength(eg.length);
    const differing = safedon.filter((line, index) => line !== eg[index]);
    expect(differing).toEqual([
      expect.stringContaining("| Purchase Order / Shipment Information (Safedon) |"),
    ]);
  });

  it("splits Mfg / Exp Date into the two header dates on every onsite form", () => {
    for (const source of ["onsite_EG", "onsite_SG", "onsite_SAFEDON_EG"] as const) {
      const field = sourceFields(source).find((item) => item.label === "Mfg / Exp Date");
      expect(field?.targets, source).toEqual([
        { module: "header", field: "mfgDate" },
        { module: "header", field: "expiryDate" },
      ]);
    }
  });

  it("covers the module library: every report module appears in some source", () => {
    const reached = new Set(SOURCE_FIELDS.flatMap((field) => field.targets.flatMap((target) => ("module" in target ? [target.module] : []))));
    const unreached = MODULE_KEYS.filter((key) => !reached.has(key));
    expect(unreached).toEqual(["dye_leak", "documents", "loading"]);
  });
});
