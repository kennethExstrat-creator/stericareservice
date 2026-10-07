import { describe, expect, it } from "vitest";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import { MODULE_KEYS } from "@/lib/schemas/module-result";
import { LABELLING_CHECK_LISTS, SAFEDON_DISPENSING_DEFECTS, VISUAL_DEFECTS, WATERTIGHT_LOCATIONS } from "./defects";
import { moduleSpec } from "./fields";
import { DEFECT_CLASSES, LABELLING_LEVELS } from "./keys";
import { SOURCE_FIELDS } from "./sources";
import { TEMPLATES } from "./templates";
import { TEMPLATE_CODES, type LabelOverrides } from "./types";
import { appWording, sameWording } from "./wording";

/** What the app fills into each placeholder, as a report prints it: the label as shown. */
const SAMPLE: Readonly<Record<string, string>> = {
  size: "M",
  codeLetters: "K, L & M",
  aql: "1.5",
  minLayeringPct: "70",
  minDispensingPct: "80",
  standardLabel: "ASTM D6319",
};

function shown(label: string): string {
  return label.replace(/\{(\w+)\}/g, (placeholder, name: string) => SAMPLE[name] ?? placeholder);
}

const withOverrides = (label: string, overrides: LabelOverrides | undefined) => [label, ...Object.values(overrides ?? {})];

/**
 * Every label lib/coverage gives the app and the report: module titles, data
 * field labels, class and level wording, captions, each with the other
 * templates' wording; custom module titles and fields; the report titles;
 * and the coded lists the screens show as row labels (defects, hole
 * locations, labelling checks, the Safedon dispensing defects). Not the
 * stickiness legend and the Safedon definitions: those are sentences.
 */
function appLabels(): { where: string; label: string }[] {
  const labels: { where: string; label: string }[] = [];
  const add = (where: string, texts: readonly string[]) => {
    for (const label of texts) labels.push({ where, label });
  };
  for (const key of MODULE_KEYS) {
    const spec = moduleSpec(key);
    add(`${key} title`, withOverrides(spec.title, spec.titles));
    for (const field of spec.data) {
      add(`${key}.${field.key}`, withOverrides(field.label, field.labels));
      for (const [group, wording] of Object.entries(field.groupLabels ?? {})) {
        add(`${key}.${field.key}[${group}]`, withOverrides(wording.label, wording.labels));
      }
    }
    for (const caption of spec.labels) add(`${key} caption ${caption.key}`, withOverrides(caption.label, caption.labels));
  }
  for (const code of TEMPLATE_CODES) {
    const template = TEMPLATES[code];
    add(`${code} report title`, template.report.titleLines ?? []);
    for (const custom of template.customModules) {
      add(`${code} custom ${custom.key}`, [custom.title, ...custom.fields.map((field) => field.label)]);
    }
    for (const cls of DEFECT_CLASSES) add(`${code} ${cls} defects`, VISUAL_DEFECTS[code][cls].map((item) => item.label));
    add(`${code} hole locations`, WATERTIGHT_LOCATIONS[code].map((item) => item.label));
  }
  for (const [code, levels] of Object.entries(LABELLING_CHECK_LISTS)) {
    for (const level of LABELLING_LEVELS) add(`${code} ${level} checks`, levels[level].map((item) => item.label));
  }
  add("Safedon dispensing defects", SAFEDON_DISPENSING_DEFECTS.map((item) => item.label));
  return labels;
}

describe("the app's wording (Kenneth, 8 October 2026)", () => {
  it("writes every label in lib/coverage in Title Case (docs/DESIGN.md, Capitalisation)", () => {
    const labels = appLabels();
    expect(labels.length).toBeGreaterThan(300);
    for (const { where, label } of labels) expect(lowerCaseWords(shown(label)), `${where}: ${label}`).toEqual([]);
  });

  it("fills every placeholder a caption holds, so the check reads the label as shown", () => {
    for (const { where, label } of appLabels()) expect(shown(label), where).not.toMatch(/\{\w+\}/);
  });
});

describe("sameWording: the form's words, the rule's capitals", () => {
  it.each([
    ["Packing configuration", "Packing Configuration"],
    ["Total # carton", "Total # Carton"],
    ["# glove per inner box", "# Glove per Inner Box"],
    ["Qty (cases)", "Qty (Cases)"],
    ["Weight (g) - average of 13 gloves per size", "Weight (g) - Average of 13 Gloves per Size"],
    ["Force At Break in Newton (Refer to attached where applicable)", "Force at Break in Newton (Refer to Attached Where Applicable)"],
    ["Non-removable dirt", "Non-Removable Dirt"],
    ["**Glove stickiness Code", "**Glove Stickiness Code"],
    ["Inspected by", "Inspected By"],
  ])("finds %j in %j", (printed, label) => {
    expect(sameWording(printed, label)).toBe(true);
  });

  it("matches what a form printed in a placeholder's place", () => {
    expect(
      sameWording(
        "Freedom from Holes by watertight test (Single sampling code letter k, L & M, AQL 1.5)",
        "Freedom From Holes by Watertight Test (Single Sampling Code Letter {codeLetters}, AQL {aql})",
      ),
    ).toBe(true);
    expect(sameWording("Dimension - Size <size>", "Dimension - Size {size}")).toBe(true);
    expect(sameWording("Spec. (ASTM D6319)", "Spec. ({standardLabel})")).toBe(true);
  });

  it.each([
    ["Total # carton", "Total # Cartons"],
    ["Packing configuration", "Packing Config"],
    ["PO / SO Number", "Po / So Number"],
    ["Weight (g)", "Weight (G)"],
    ["Inner Box", "Inner Pack"],
  ])("tells %j from %j: more than the first letters changed", (printed, label) => {
    expect(sameWording(printed, label)).toBe(false);
  });
});

describe("appWording: the coverage matrix's App wording", () => {
  const field = (id: string) => {
    const found = SOURCE_FIELDS.find((item) => item.id === id);
    if (!found) throw new Error(`No source field ${id}`);
    return found;
  };

  it("gives the label the template shows, in Title Case, [sic] fixed", () => {
    expect(appWording(field("report_STD_EG:page-1-packing-configuration:packing-configuration"))).toBe("Packing Configuration");
    expect(appWording(field("report_STD_EG:page-1-order-table:total-carton"))).toBe("Total # Carton");
    expect(appWording(field("report_STD_EG:page-1-manufacturer-information:factrory-glove-code"))).toBe("Factory Glove Code");
    expect(appWording(field("report_SAFEDON_EG:page-1-packing-configuration:glove-per-plastic-pack"))).toBe(
      "# Glove per Plastic Pack",
    );
  });

  it("names every target of a box the template splits, and the hint shown for a Safedon definition", () => {
    expect(appWording(field("onsite_EG:1-purchase-order-shipment-information:mfg-exp-date"))).toBe(
      "Manufacturing Date; Expiry Date",
    );
    expect(appWording(field("onsite_SG:1-purchase-order-shipment-information:mfg-exp-date"))).toBe("Mfg Date; Exp Date");
    expect(appWording(field("onsite_EG:2-inspected-by:name"))).toBe("Inspected By");
    const [noCuff] = SAFEDON_DISPENSING_DEFECTS;
    expect(appWording(field("report_SAFEDON_EG:page-3-glove-dispensing-inspection:cuff-should-ideallly-be-at-least-2-cm-out"))).toBe(
      noCuff.hint,
    );
  });

  it("has no label for the size list or the report layout", () => {
    expect(appWording(field("report_STD_EG:page-1-order-table:size"))).toBeUndefined();
    expect(appWording(field("report_STD_EG:all-pages:page-n-of-4"))).toBeUndefined();
  });
});
