import { describe, expect, it } from "vitest";
import type { CustomModule, ModuleOverrides, ResolvedTemplate } from "@/lib/schemas/template";
import { makeTestTemplate } from "@/modules/_framework/testing";
import {
  emptyData,
  filledData,
  SITE_NOTES,
  SIZE_TABLE,
  TEST_ADMIN_ID,
  TEST_META,
  TEST_REGISTRY,
  testTemplate,
} from "./__fixtures__/capture";
import { evaluateCapture } from "./evaluate";
import {
  capturePages,
  captureSections,
  findPage,
  findSection,
  initialSectionKey,
  leadPagesFirst,
  neighbours,
  pageProgress,
  pageSectionKeys,
  pageStatus,
  progressOf,
  progressSteps,
  progressSummary,
  SHOWN_WITH,
  type CapturePage,
  type CaptureSection,
  type IncludedSection,
} from "./sections";

const OFF: ModuleOverrides = {
  packing_config: { reason: "Not in this order.", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" },
};

function sectionsFor(data = filledData(), overrides: ModuleOverrides = {}, template: ResolvedTemplate = testTemplate()) {
  const evaluated = evaluateCapture({ template, overrides, data, meta: TEST_META }, TEST_REGISTRY);
  return captureSections(evaluated.template, evaluated.report, data);
}

function pagesFor(data = filledData(), overrides: ModuleOverrides = {}, template: ResolvedTemplate = testTemplate()) {
  return capturePages(sectionsFor(data, overrides, template));
}

/** The order filled in, as filledData has it, with packing's three counts. */
function withPacking(packing: Record<string, number | null>) {
  const filled = filledData();
  return { ...filled, modules: { ...filled.modules, packing_config: packing } };
}

function titleOf(sections: readonly CaptureSection[], key: string): string {
  const section = findSection(sections, key);
  if (!section) throw new Error(`No section ${key}.`);
  return section.title;
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

  it("marks packing configuration as shown with the order, and nothing else", () => {
    const sections = sectionsFor();
    expect(SHOWN_WITH).toEqual({ packing_config: "order_lots" });
    expect(findSection(sections, "packing_config")).toMatchObject({ kind: "module", shownWith: "order_lots" });
    expect(sections.filter((section) => section.kind === "module" && section.shownWith !== undefined)).toHaveLength(1);
  });

  it("keeps a module an admin switched off in its place, marked off with the override", () => {
    const sections = sectionsFor(filledData(), OFF);
    const off = findSection(sections, "packing_config");
    expect(off).toEqual({
      kind: "excluded",
      key: "packing_config",
      title: titleOf(sectionsFor(), "packing_config"),
      shortTitle: "Packing Configuration",
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

  it("shows the conclusion's HOLD as On Hold, and done, while its module result stays a warning", () => {
    const filled = filledData();
    const data = { ...filled, modules: { ...filled.modules, conclusion: { finalResult: "hold", remark: null } } };
    const { template, report } = evaluateCapture({ template: testTemplate(), overrides: {}, data, meta: TEST_META }, TEST_REGISTRY);
    const sections = captureSections(template, report, data);
    // The pill and the chip say On Hold, as the review and the final result do.
    expect(findSection(sections, "conclusion")).toMatchObject({ status: "hold", progress: "done" });
    const pages = capturePages(sections);
    expect(progressSteps(pages).at(-1)).toEqual({
      key: "conclusion",
      label: "Conclusion",
      title: "Conclusion",
      state: "done",
      result: "hold",
    });
    expect(progressSummary(pages).done).toBe(progressSummary(pagesFor()).done + 1);
    // The module records a warning (a module status has no hold): the suggestion and submit read that.
    expect(report.modules.find((entry) => entry.key === "conclusion")?.result.status).toBe("warn");

    for (const finalResult of ["pass", "fail"] as const) {
      const decided = sectionsFor({ ...filled, modules: { ...filled.modules, conclusion: { finalResult, remark: null } } });
      expect(findSection(decided, "conclusion")).toMatchObject({ status: finalResult, progress: "done" });
    }
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

  it("names each section by its short name too, whatever its title says (lib/templates/short-titles.ts)", () => {
    const optional: CustomModule = { ...SITE_NOTES, key: "yard_notes", title: "Yard Notes (Optional)", after: "weight" };
    const dispensing: CustomModule = {
      ...SITE_NOTES,
      key: "safedon_dispensing_notes",
      title: "Glove Dispensing Inspection: Onsite Notes",
      after: "weight",
    };
    const template = makeTestTemplate(TEST_REGISTRY, ["glove_info", "order_lots", "packing_config", "weight"], {
      customModules: [SITE_NOTES, optional, dispensing],
    });
    const named = (sections: readonly CaptureSection[]) => sections.map((section) => [section.key, section.title, section.shortTitle]);
    expect(named(sectionsFor(filledData(), OFF, template))).toEqual([
      ["header", "Manufacturer Information", "Manufacturer"],
      ["glove_info", "Glove Information", "Glove Information"],
      ["site_notes", "Site notes", "Site notes"],
      ["order_lots", "Order", "Order"],
      // Switched off, it keeps one for its row and its notice.
      ["packing_config", "Packing configuration", "Packing Configuration"],
      ["weight", "Weight (g)", "Weight"],
      // A custom module: listed, else its own title without a trailing note in brackets.
      ["yard_notes", "Yard Notes (Optional)", "Yard Notes"],
      ["safedon_dispensing_notes", "Glove Dispensing Inspection: Onsite Notes", "Dispensing Notes"],
      ["conclusion", "Conclusion", "Conclusion"],
    ]);
  });
});

describe("pages", () => {
  it("shows packing configuration on the order's page, below it, under the order's title, with no step of its own", () => {
    const sections = sectionsFor();
    const pages = capturePages(sections);
    expect(pages.map((page) => pageSectionKeys(page))).toEqual([
      ["header"],
      ["glove_info"],
      ["site_notes"],
      ["order_lots", "packing_config"],
      ["weight"],
      ["size_checks"],
      ["conclusion"],
    ]);
    const order = findPage(pages, "order_lots");
    expect(order).toMatchObject({ kind: "included", key: "order_lots", title: titleOf(sections, "order_lots"), shortTitle: "Order" });
    // Each module keeps its own result and title on its frame.
    expect(order?.kind === "included" && order.sections.map((section) => [section.key, section.title, section.status])).toEqual([
      ["order_lots", titleOf(sections, "order_lots"), "info"],
      ["packing_config", titleOf(sections, "packing_config"), "not_done"],
    ]);
    const steps = progressSteps(pages);
    expect(steps.map((step) => step.key)).not.toContain("packing_config");
    expect(steps.find((step) => step.key === "order_lots")).toEqual({
      key: "order_lots",
      label: "Order",
      title: titleOf(sections, "order_lots"),
      state: "in_progress",
      result: "not_done",
    });
    expect(steps.map((step) => step.label)).not.toContain("Packing Configuration");
    expect(steps.map((step) => step.title)).not.toContain(titleOf(sections, "packing_config"));
  });

  it("opens the order's page for packing configuration (?module=, issue links, a landing)", () => {
    const pages = pagesFor();
    expect(findPage(pages, "packing_config")?.key).toBe("order_lots");
    expect(findPage(pages, "order_lots")?.key).toBe("order_lots");
    expect(findPage(pages, "weight")?.key).toBe("weight");
    expect(findPage(pages, "nothing")).toBeUndefined();
    expect(findPage(pages, null)).toBeUndefined();
  });

  it("gives every module a page of its own in a template without packing configuration, or without the order", () => {
    for (const keys of [
      ["glove_info", "order_lots", "weight"],
      ["glove_info", "packing_config", "weight"],
    ] as const) {
      const template = makeTestTemplate(TEST_REGISTRY, keys);
      const sections = sectionsFor(filledData(), {}, template);
      const pages = capturePages(sections);
      expect(pages.map((page) => pageSectionKeys(page))).toEqual(sections.map((section) => [section.key]));
      expect(sections.some((section) => section.kind === "module" && section.shownWith !== undefined)).toBe(false);
    }
  });

  it("gives packing configuration a switched-off page of its own while it is switched off, the order's page holding the order alone", () => {
    const pages = pagesFor(filledData(), OFF);
    expect(findPage(pages, "packing_config")).toMatchObject({ kind: "excluded", key: "packing_config" });
    expect(pageSectionKeys(findPage(pages, "order_lots")!)).toEqual(["order_lots"]);
    expect(findPage(pages, "order_lots")).toMatchObject({ status: "info", progress: "done" });
  });

  it("follows the order's page with the custom modules after the order, then those after packing configuration, wherever the template lists packing", () => {
    const afterOrder: CustomModule = { ...SITE_NOTES, key: "carton_marks", title: "Carton marks", after: "order_lots" };
    const afterPacking: CustomModule = { ...SITE_NOTES, key: "pallet_notes", title: "Pallet notes", after: "packing_config" };
    const customModules = [SITE_NOTES, afterPacking, afterOrder, SIZE_TABLE];
    const listed = {
      below: makeTestTemplate(TEST_REGISTRY, ["glove_info", "order_lots", "packing_config", "weight"], { customModules }),
      // Packing listed before the order still shows below it, and its custom module with it.
      above: makeTestTemplate(TEST_REGISTRY, ["glove_info", "packing_config", "order_lots", "weight"], { customModules }),
    };
    for (const template of Object.values(listed)) {
      const pages = pagesFor(filledData(), {}, template);
      expect(pages.map((page) => pageSectionKeys(page))).toEqual([
        ["header"],
        ["glove_info"],
        ["site_notes"],
        ["order_lots", "packing_config"],
        ["carton_marks"],
        ["pallet_notes"],
        ["weight"],
        ["size_checks"],
        ["conclusion"],
      ]);
    }
    // Switched off, packing stays where the template lists it, its custom module after it.
    expect(pagesFor(filledData(), OFF, listed.above).map((page) => `${page.kind}:${page.key}`)).toEqual([
      "included:header",
      "included:glove_info",
      "included:site_notes",
      "excluded:packing_config",
      "included:pallet_notes",
      "included:order_lots",
      "included:carton_marks",
      "included:weight",
      "included:size_checks",
      "included:conclusion",
    ]);
  });

  it("never gives Glove Type a page of its own: first on Glove Information's page, else after the header (11 and 12 October 2026)", () => {
    const gloveType: CustomModule = { ...SITE_NOTES, key: "glove_type", title: "Glove Type", after: "header" };
    const withInfo = makeTestTemplate(TEST_REGISTRY, ["glove_info", "order_lots"], { customModules: [gloveType] });
    const pages = pagesFor(filledData(), {}, withInfo);
    expect(pages.map((page) => pageSectionKeys(page))).toEqual([["header"], ["glove_type", "glove_info"], ["order_lots"], ["conclusion"]]);
    // The page is Glove Information's, named as it is, though Glove Type leads it.
    expect(pages[1]).toMatchObject({ key: "glove_info", title: "Glove Information", shortTitle: "Glove Information" });
    const withoutInfo = makeTestTemplate(TEST_REGISTRY, ["order_lots"], { customModules: [gloveType] });
    expect(pagesFor(filledData(), {}, withoutInfo).map((page) => pageSectionKeys(page))[0]).toEqual(["header", "glove_type"]);
  });

  it("takes the worst result of the page's modules, On Hold between a warning and not done, and is done once every module is", () => {
    const page = (data = filledData()) => findPage(pagesFor(data), "order_lots");
    // The order filled in, packing not started: not done yet, in progress.
    expect(page()).toMatchObject({ status: "not_done", progress: "in_progress" });
    // Packing filled in but not adding up: a warning, and done.
    expect(page(withPacking({ glovesPerInner: 100, innersPerCase: 10, glovesPerCase: 999 }))).toMatchObject({
      status: "warn",
      progress: "done",
    });
    expect(page(withPacking({ glovesPerInner: 100, innersPerCase: 10, glovesPerCase: 1000 }))).toMatchObject({
      status: "info",
      progress: "done",
    });
    // Nothing entered on either: not started.
    expect(page(emptyData())).toMatchObject({ status: "not_done", progress: "not_started" });

    const part = (status: IncludedSection["status"], progress: IncludedSection["progress"]): IncludedSection => ({
      kind: "module",
      key: "order_lots",
      title: "Order",
      shortTitle: "Order",
      status,
      summary: "",
      progress,
      stub: false,
      errors: 0,
      warnings: 0,
    });
    // A failed module beside one not done: failed, and still in progress.
    expect(pageStatus([part("fail", "done"), part("not_done", "not_started")])).toBe("fail");
    expect(pageProgress([part("fail", "done"), part("not_done", "not_started")])).toBe("in_progress");
    expect(pageStatus([part("info", "done"), part("not_done", "in_progress")])).toBe("not_done");
    expect(pageStatus([part("info", "done"), part("warn", "done")])).toBe("warn");
    expect(pageStatus([part("pass", "done"), part("info", "done")])).toBe("pass");
    expect(pageStatus([part("warn", "done"), part("hold", "done")])).toBe("hold");
    expect(pageStatus([part("hold", "done"), part("not_done", "in_progress")])).toBe("not_done");
    expect(pageProgress([part("not_done", "not_started"), part("not_done", "not_started")])).toBe("not_started");
    expect(pageProgress([part("not_done", "in_progress"), part("not_done", "not_started")])).toBe("in_progress");
    expect(pageProgress([part("info", "done"), part("warn", "done")])).toBe("done");
  });
});

describe("navigation helpers", () => {
  it("opens the section asked for, else the first one", () => {
    const sections = sectionsFor();
    expect(initialSectionKey(sections, "weight")).toBe("weight");
    expect(initialSectionKey(sections, "site_notes")).toBe("site_notes");
    expect(initialSectionKey(sections, "packing_config")).toBe("packing_config");
    expect(initialSectionKey(sections, "visual")).toBe("header");
    expect(initialSectionKey(sections, null)).toBe("header");
  });

  it("steps over switched-off pages with Previous and Next", () => {
    const pages = pagesFor(filledData(), OFF);
    expect(neighbours(pages, "order_lots")).toMatchObject({ previous: { key: "site_notes" }, next: { key: "weight" } });
    expect(neighbours(pages, "header").previous).toBeNull();
    expect(neighbours(pages, "conclusion").next).toBeNull();
    // From a switched-off page, the buttons go to the pages around it.
    expect(neighbours(pages, "packing_config")).toMatchObject({ previous: { key: "order_lots" }, next: { key: "weight" } });
    // An unknown key starts at the first page.
    expect(neighbours(pages, "nothing")).toMatchObject({ previous: null, next: { key: "header" } });
  });

  it("goes by page: from the order's page, packing configuration included, Next is the page after both", () => {
    const pages = pagesFor();
    for (const key of ["order_lots", "packing_config"]) {
      expect(neighbours(pages, key)).toMatchObject({ previous: { key: "site_notes" }, next: { key: "weight" } });
    }
    expect(neighbours(pages, "weight").previous?.key).toBe("order_lots");
  });

  it("gives the progress tracker the included pages with their results", () => {
    const pages = pagesFor(filledData(), OFF);
    const steps = progressSteps(pages);
    expect(steps.map((step) => step.key)).not.toContain("packing_config");
    // Named by its short name, its full title for the hover.
    expect(steps[0]).toEqual({ key: "header", label: "Manufacturer", title: "Manufacturer Information", state: "done", result: "info" });
    // A switched-off page has no step, but a short name of its own.
    expect(findPage(pages, "packing_config")).toMatchObject({ kind: "excluded", shortTitle: "Packing Configuration" });
    expect(progressSummary(pages)).toEqual({ done: 3, total: 7 });
    // With packing on the order's page there are as many steps, the order's done only once packing is.
    expect(progressSummary(pagesFor())).toEqual({ done: 2, total: 7 });
    expect(progressSummary(pagesFor(withPacking({ glovesPerInner: 100, innersPerCase: 10, glovesPerCase: 1000 })))).toEqual({
      done: 3,
      total: 7,
    });
  });

  it("counts a section done once it has a result, in progress while something is entered", () => {
    expect(progressOf("pass", true)).toBe("done");
    expect(progressOf("info", false)).toBe("done");
    expect(progressOf("hold", true)).toBe("done");
    expect(progressOf("not_done", true)).toBe("in_progress");
    expect(progressOf("not_done", false)).toBe("not_started");
  });
});

describe("leadPagesFirst", () => {
  const page = (key: string) =>
    ({ kind: "included", key, title: key, shortTitle: key, sections: [], status: "not_done", progress: "not_started" }) as unknown as CapturePage;
  // A switched-off page: only its kind and key matter here.
  const off = (key: string) => ({ kind: "excluded", key, title: key, shortTitle: key }) as unknown as CapturePage;

  it("puts the order, the sampling plan and the box/carton numbers first, in that order (Kenneth, 26 October 2026)", () => {
    const pages = [page("header"), page("glove_info"), page("carton_sampling"), page("order_lots"), page("visual"), page("sampling_plan"), page("conclusion")];
    expect(leadPagesFirst(pages).map((entry) => entry.key)).toEqual([
      "order_lots",
      "sampling_plan",
      "carton_sampling",
      "header",
      "glove_info",
      "visual",
      "conclusion",
    ]);
  });

  it("leaves a switched-off lead page where it was, and an inspection without them as it is", () => {
    const pages = [page("header"), off("carton_sampling"), page("order_lots"), page("conclusion")];
    expect(leadPagesFirst(pages).map((entry) => entry.key)).toEqual(["order_lots", "header", "carton_sampling", "conclusion"]);
    const surgical = [page("header"), page("visual"), page("conclusion")];
    expect(leadPagesFirst(surgical)).toEqual(surgical);
  });
});
