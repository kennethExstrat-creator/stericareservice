import { describe, expect, it } from "vitest";
import type { ModuleOverrides } from "@/lib/schemas/template";
import { emptyData, filledData, TEST_ADMIN_ID, TEST_META, TEST_REGISTRY, testTemplate } from "./__fixtures__/capture";
import { evaluateCapture } from "./evaluate";
import {
  captureSections,
  findSection,
  initialSectionKey,
  neighbours,
  progressOf,
  progressSteps,
  progressSummary,
} from "./sections";

const OFF: ModuleOverrides = {
  packing_config: { reason: "Not in this order.", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" },
};

function sectionsFor(data = filledData(), overrides: ModuleOverrides = {}) {
  const { template, report } = evaluateCapture({ template: testTemplate(), overrides, data, meta: TEST_META }, TEST_REGISTRY);
  return captureSections(template, report, data);
}

describe("captureSections", () => {
  it("lists the included modules in template order, each custom module after the one it follows", () => {
    expect(sectionsFor().map((section) => `${section.kind}:${section.key}`)).toEqual([
      "module:header",
      "module:glove_info",
      "custom:site_notes",
      "module:order_lots",
      "module:packing_config",
      "module:weight",
      "custom:size_checks",
      "module:conclusion",
    ]);
  });

  it("carries each module's result, summary, progress and issue counts", () => {
    const sections = sectionsFor();
    expect(findSection(sections, "header")).toMatchObject({ status: "info", summary: "PO PO-0001.", progress: "done" });
    expect(findSection(sections, "order_lots")).toMatchObject({ status: "info", progress: "done" });
    expect(findSection(sections, "packing_config")).toMatchObject({ status: "not_done", progress: "not_started" });
    expect(findSection(sections, "conclusion")).toMatchObject({ status: "not_done", errors: 1 });
  });

  it("keeps a module an admin switched off in its place, marked off with the override", () => {
    const sections = sectionsFor(filledData(), OFF);
    const off = findSection(sections, "packing_config");
    expect(off).toEqual({
      kind: "excluded",
      key: "packing_config",
      title: "Packing configuration",
      override: OFF.packing_config,
    });
    expect(sections.map((section) => section.key)).toContain("weight");
  });

  it("leaves out modules the template itself switches off", () => {
    const template = testTemplate();
    const withoutWeight = {
      ...template,
      modules: template.modules.map((entry) => (entry.key === "weight" ? { ...entry, include: false } : entry)),
    };
    const data = filledData();
    const { report } = evaluateCapture({ template: withoutWeight, overrides: {}, data, meta: TEST_META }, TEST_REGISTRY);
    expect(captureSections(withoutWeight, report, data).map((section) => section.key)).not.toContain("weight");
  });

  it("shows a custom module as not done until something is entered without errors", () => {
    const blank = sectionsFor(emptyData());
    expect(findSection(blank, "size_checks")).toMatchObject({ status: "not_done", progress: "not_started" });

    const data = filledData();
    const filled = sectionsFor({ ...data, custom: { site_notes: { weather: "Dry", sealIntact: true } } });
    expect(findSection(filled, "site_notes")).toMatchObject({ status: "info", progress: "done", errors: 0 });

    const missing = sectionsFor({ ...data, custom: { site_notes: { weather: "Dry" } } });
    expect(findSection(missing, "site_notes")).toMatchObject({ status: "not_done", progress: "in_progress", errors: 1 });
  });
});

describe("navigation helpers", () => {
  it("opens the section asked for, else the first one", () => {
    const sections = sectionsFor();
    expect(initialSectionKey(sections, "weight")).toBe("weight");
    expect(initialSectionKey(sections, "site_notes")).toBe("site_notes");
    expect(initialSectionKey(sections, "visual")).toBe("header");
    expect(initialSectionKey(sections, null)).toBe("header");
  });

  it("steps over switched-off sections with Previous and Next", () => {
    const sections = sectionsFor(filledData(), OFF);
    expect(neighbours(sections, "order_lots")).toMatchObject({ previous: { key: "site_notes" }, next: { key: "weight" } });
    expect(neighbours(sections, "header").previous).toBeNull();
    expect(neighbours(sections, "conclusion").next).toBeNull();
    // From a switched-off section, the buttons go to the sections around it.
    expect(neighbours(sections, "packing_config")).toMatchObject({ previous: { key: "order_lots" }, next: { key: "weight" } });
    // An unknown key starts at the first section.
    expect(neighbours(sections, "nothing")).toMatchObject({ previous: null, next: { key: "header" } });
  });

  it("gives the progress tracker the included sections with their results", () => {
    const sections = sectionsFor(filledData(), OFF);
    const steps = progressSteps(sections);
    expect(steps.map((step) => step.key)).not.toContain("packing_config");
    expect(steps[0]).toEqual({ key: "header", label: "Manufacturer Information", state: "done", result: "info" });
    expect(progressSummary(sections)).toEqual({ done: 3, total: 7 });
  });

  it("counts a section done once it has a result, in progress while something is entered", () => {
    expect(progressOf("pass", true)).toBe("done");
    expect(progressOf("info", false)).toBe("done");
    expect(progressOf("not_done", true)).toBe("in_progress");
    expect(progressOf("not_done", false)).toBe("not_started");
  });
});
