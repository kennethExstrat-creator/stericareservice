import { describe, expect, it } from "vitest";
import type { ModuleOverrides } from "@/lib/schemas/template";
import { MODULE_SHORT_TITLES, SHORT_TITLE_MAX } from "@/lib/templates";
import type { ValidationIssue } from "@/lib/validation";
import { emptyData, filledData, TEST_ADMIN_ID, TEST_META, TEST_REGISTRY, testTemplate } from "./__fixtures__/capture";
import { evaluateCapture } from "./evaluate";
import { issueCorpus } from "./__fixtures__/issue-corpus";
import {
  blockedSubmitMessage,
  countIssues,
  describePending,
  groupIssues,
  issueKey,
  issueTarget,
  neededSectionCount,
  pendingCounts,
  pendingTasks,
  summariseIssues,
  taskName,
  unseenIssues,
  type TaskContext,
} from "./issues";
import { capturePages, captureSections } from "./sections";

function evaluated(overrides: ModuleOverrides = {}, data = filledData()) {
  const evaluation = evaluateCapture({ template: testTemplate(), overrides, data, meta: TEST_META }, TEST_REGISTRY);
  const sections = captureSections(evaluation.template, evaluation.report, data);
  return { ...evaluation, sections, pages: capturePages(sections) };
}

const OFF: ModuleOverrides = {
  packing_config: { reason: "n/a", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" },
};

describe("groupIssues", () => {
  it("groups issues under their section's title in screen order, errors apart from warnings", () => {
    const { report, sections } = evaluated();
    const groups = groupIssues(report.issues, sections);
    expect(groups.map((group) => group.key)).toEqual(["site_notes", "packing_config", "weight", "size_checks", "conclusion"]);
    const conclusion = groups.find((group) => group.key === "conclusion");
    expect(conclusion).toMatchObject({ title: "Conclusion", linkable: true, warnings: [] });
    expect(conclusion?.errors[0]).toMatchObject({ code: "module_not_done", level: "error" });
    expect(groups.find((group) => group.key === "packing_config")?.warnings[0].code).toBe("module_not_done");
  });

  it("marks issues of a section that is not on screen as not linkable", () => {
    const { sections } = evaluated({
      packing_config: { reason: "n/a", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" },
    });
    const stray: ValidationIssue[] = [
      { level: "warning", moduleKey: "packing_config", code: "x", message: "Old.", path: [] },
      { level: "error", moduleKey: "nowhere", code: "y", message: "Lost.", path: [] },
    ];
    expect(groupIssues(stray, sections)).toEqual([
      expect.objectContaining({ key: "packing_config", title: "Packing configuration", linkable: false }),
      expect.objectContaining({ key: "nowhere", title: "nowhere", linkable: false }),
    ]);
  });
});

describe("counts and links", () => {
  it("counts errors and warnings", () => {
    const { report } = evaluated();
    const counts = countIssues(report.issues);
    expect(counts.errors).toBeGreaterThan(0);
    expect(counts.errors + counts.warnings).toBe(report.issues.length);
  });

  it("links an issue to its section and path, with a stable key", () => {
    const issue: ValidationIssue = {
      level: "error",
      moduleKey: "weight",
      code: "carton_duplicate",
      message: "Carton 578 twice.",
      size: "M",
      path: ["sizes", "M", 3],
    };
    const { pages } = evaluated();
    expect(issueTarget(issue, pages)).toEqual({ pageKey: "weight", sectionKey: "weight", path: ["sizes", "M", 3] });
    expect(issueKey(issue)).toBe(issueKey({ ...issue }));
    expect(issueKey(issue)).not.toBe(issueKey({ ...issue, path: ["sizes", "M", 4] }));
  });

  it("links a packing configuration issue to the order's page, at packing's own field", () => {
    const issue: ValidationIssue = {
      level: "warning",
      moduleKey: "packing_config",
      code: "gloves_per_case_mismatch",
      message: "Gloves per case is not inner x per case.",
      path: ["glovesPerCase"],
    };
    expect(issueTarget(issue, evaluated().pages)).toEqual({
      pageKey: "order_lots",
      sectionKey: "packing_config",
      path: ["glovesPerCase"],
    });
    // Switched off, packing is a page of its own (its issues have no link then: groupIssues).
    expect(issueTarget(issue, evaluated(OFF).pages).pageKey).toBe("packing_config");
  });
});

describe("Pending on the order's page", () => {
  it("keeps one row per module, packing configuration's right after the order's", () => {
    const filled = filledData();
    // Packing filled in but not adding up: a warning of its own.
    const data = {
      ...filled,
      modules: { ...filled.modules, packing_config: { glovesPerInner: 100, innersPerCase: 10, glovesPerCase: 999 } },
    };
    const { report, sections } = evaluated({}, data);
    // A warning of the order's, listed after packing's: the rows still follow the screen.
    const issues: ValidationIssue[] = [
      ...report.issues,
      { level: "warning", moduleKey: "order_lots", code: "something_new", message: "Check the lot.", path: [] },
    ];
    const rows = pendingTasks(groupIssues(issues, sections), sections, report.modules).filter((row) => !row.needed);
    const keys = rows.map((row) => row.key);
    expect(keys.filter((key) => key === "order_lots" || key === "packing_config")).toEqual(["order_lots", "packing_config"]);
    expect(keys.indexOf("packing_config")).toBe(keys.indexOf("order_lots") + 1);
    expect(rows.find((row) => row.key === "packing_config")).toMatchObject({
      linkable: true,
      status: "Numbers do not match",
      first: { path: ["glovesPerCase"] },
    });
  });
});

/* ------------------------------------------------------------------ *
 * Pending: one short task per section
 * ------------------------------------------------------------------ */

const ISSUE = (overrides: Partial<ValidationIssue>): ValidationIssue => ({
  level: "warning",
  moduleKey: "weight",
  code: "module_not_done",
  message: "Weight (g) is not done: Not done for size XS, S, M, L.",
  path: [],
  ...overrides,
});

const CONTEXT: TaskContext = { title: "Weight (g)", notStarted: false, sizesNotDone: [] };

describe("pendingTasks on real inspections (the seed templates, empty to full)", () => {
  const corpus = issueCorpus();
  const tasks = corpus.flatMap((entry) => entry.tasks.map((task) => ({ entry, task })));

  it("covers every module of the seed templates and custom sections", () => {
    const keys = new Set(tasks.map(({ task }) => task.key));
    for (const key of [
      "header",
      "glove_info",
      "order_lots",
      "packing_config",
      "sampling_plan",
      "carton_sampling",
      "dimensions",
      "force_at_break",
      "tensile",
      "weight",
      "watertight",
      "visual",
      "dispensing_packing",
      "dispensing_safedon",
      "labeling",
      "dye_leak",
      "conclusion",
      "site_notes",
    ]) {
      expect(keys, key).toContain(key);
    }
  });

  it("gives each section one short status: a few words, no lot sizes, code letters, plans or reasons", () => {
    for (const { entry, task } of tasks) {
      const where = `${entry.name}: ${task.key} "${task.status}"`;
      expect(task.status.length, where).toBeLessThanOrEqual(32);
      expect(task.status, where).toMatch(/^[A-Z0-9]/);
      expect(task.status, where).not.toMatch(/[.;:()]|\d{3,}|\blot \d|\bcode\b|inspection level|Suggested|sampling plan|is not done|must be complete/i);
      expect(taskName(task), where).not.toContain("undefined");
    }
  });

  it("names only ordered sizes in the chips, in the order's order", () => {
    for (const { entry, task } of tasks) {
      const ordered = task.sizes.filter((size) => entry.sizes.includes(size));
      // A size saved but not ordered is named by the status that says so.
      if (task.status !== "Data for a size not ordered") expect(task.sizes, `${entry.name}: ${task.key}`).toEqual(ordered);
      expect([...ordered].sort((a, b) => entry.sizes.indexOf(a) - entry.sizes.indexOf(b))).toEqual(ordered);
    }
  });

  it("names each row by its section's short name: one line, no trailing note in brackets", () => {
    for (const { entry, task } of tasks) {
      const where = `${entry.name}: ${task.key} "${task.title}"`;
      expect(task.title, where).not.toMatch(/\([^()]*\)$/);
      expect(task.title.length, where).toBeLessThanOrEqual(SHORT_TITLE_MAX);
    }
    // STD_EG's and SAFEDON_EG's modules by their short names (STD_SG keeps its own words: lib/templates/short-titles.ts).
    const egTitles = new Map(
      tasks.filter(({ entry }) => !entry.name.startsWith("STD_SG")).map(({ task }) => [task.key, task.title] as const),
    );
    expect(egTitles.get("weight")).toBe(MODULE_SHORT_TITLES.weight);
    expect(egTitles.get("carton_sampling")).toBe("Carton Numbers");
    expect(egTitles.get("tensile")).toBe("Physical Properties");
    expect(egTitles.get("watertight")).toBe("Watertight Test");
  });

  it("lists what submit needs first, then the rest in capture order, one row per section", () => {
    for (const { name, tasks: rows } of corpus) {
      const firstRest = rows.findIndex((task) => !task.needed);
      if (firstRest >= 0) expect(rows.slice(firstRest).every((task) => !task.needed), name).toBe(true);
      expect(new Set(rows.map((task) => task.key)).size, name).toBe(rows.length);
    }
  });

  it("says what Kenneth's screenshot showed in a few words", () => {
    const find = (name: string, key: string) => corpus.find((entry) => entry.name === name)?.tasks.find((task) => task.key === key);
    // The conclusion's reasoning stays in the review: here only what to do.
    expect(find("SAFEDON_EG empty", "conclusion")).toMatchObject({ needed: true, status: "Final result and date", sizes: [] });
    // Four "Size XS, 80 gloves for watertight & Visual: 80 gloves sampled; inspection level I needs 200 (lot …)".
    expect(find("SAFEDON_EG full", "sampling_plan")).toMatchObject({ status: "Sample below plan", sizes: ["XS", "S", "M", "L"] });
    // "Not done for size XS, S, M, L." for a section with nothing in it.
    expect(find("SAFEDON_EG full without weight", "weight")).toMatchObject({ status: "Not started", sizes: [] });
    // "size XS: not done, No. of sample tested missing (sampling plan: …); size S: …" for one size left.
    expect(find("SAFEDON_EG full without size XS", "watertight")).toMatchObject({ status: "1 size not done", sizes: ["XS"] });
    expect(find("SAFEDON_EG full, no lab report", "tensile")).toMatchObject({ status: "Lab report not attached" });
    expect(find("SAFEDON_EG empty", "weight")).toMatchObject({ status: "No sizes ordered yet" });
    expect(find("STD_EG as entered", "carton_sampling")).toMatchObject({ needed: true, status: "Carton entered twice", sizes: ["M"] });
    expect(find("test template empty", "site_notes")).toMatchObject({ needed: true });
  });

  it("counts sections, not issues: the summary line and the refused submit say the same", () => {
    const full = corpus.find((entry) => entry.name === "SAFEDON_EG full")!;
    const counts = pendingCounts(full.tasks);
    expect(counts.total).toBe(full.tasks.length);
    expect(describePending(counts)).toMatch(/^\d+ to do( · \d+ needed before you submit)?$/);
  });
});

describe("summariseIssues", () => {
  it("names one or two missing fields, and counts more", () => {
    const missing = (fields: string) => ISSUE({ moduleKey: "glove_info", message: `Glove Information is not done: Missing: ${fields}.` });
    const context = { ...CONTEXT, title: "Glove Information" };
    expect(summariseIssues([missing("Glove colour")], context).status).toBe("Glove colour");
    expect(summariseIssues([missing("Glove colour, Glove length")], context).status).toBe("Glove colour and glove length");
    // Labels in Title Case are quoted as shown (docs/DESIGN.md): the seed templates' words.
    expect(summariseIssues([missing("Glove Colour, Glove Length")], context).status).toBe("Glove Colour and Glove Length");
    // A one-word label beside one in Title Case is quoted as shown too: STD_SG's header words the date "Date".
    expect(summariseIssues([missing("Product Name, Date")], context).status).toBe("Product Name and Date");
    expect(summariseIssues([missing("Date, Product Name")], context).status).toBe("Date and Product Name");
    expect(summariseIssues([missing("PO / SO Number, Product Name (Brand, code & description), Expiry date")], context).status).toBe(
      "3 fields to fill",
    );
    expect(summariseIssues([missing("Supplier Factory Address / Location, PO / SO Number")], context).status).toBe("2 fields to fill");
    // Nothing entered yet, and more than two fields: Not started.
    expect(summariseIssues([missing("A, B, C")], { ...context, notStarted: true }).status).toBe("Not started");
  });

  it("calls the conclusion's own field the final result", () => {
    const issue = ISSUE({
      level: "error",
      moduleKey: "conclusion",
      message: "Conclusion must be complete before submit: Missing: Conclusion, Date. Suggested result: HOLD (not done: Weight (g)).",
    });
    expect(summariseIssues([issue], { ...CONTEXT, title: "Conclusion", notStarted: true })).toEqual({
      status: "Final result and date",
      sizes: [],
      more: 0,
    });
  });

  it("counts the sizes a per-size module has not done, from its results", () => {
    expect(summariseIssues([ISSUE({})], { ...CONTEXT, sizesNotDone: ["XS", "S", "M", "L"] })).toEqual({
      status: "4 sizes not done",
      sizes: ["XS", "S", "M", "L"],
      more: 0,
    });
    expect(summariseIssues([ISSUE({})], { ...CONTEXT, sizesNotDone: ["7.0"] }).status).toBe("1 size not done");
  });

  it("puts what submit needs first, and counts the other kinds as more", () => {
    const below = (size: string) => ISSUE({ code: "sample_below_plan", size, message: `Size ${size}: 80 gloves sampled; needs 200 (lot 120,000 gloves, code L).` });
    const duplicate = ISSUE({ level: "error", code: "carton_duplicate", size: "M", message: "Size M: Carton 12 is entered twice." });
    expect(summariseIssues([below("XS"), below("S"), duplicate], CONTEXT)).toEqual({ status: "Carton entered twice", sizes: ["M"], more: 1 });
    expect(summariseIssues([below("XS"), below("S")], CONTEXT)).toEqual({ status: "Sample below plan", sizes: ["XS", "S"], more: 0 });
  });

  it("words each kind of check in a few words", () => {
    const status = (code: string, message = "Something long enough that it would never fit on one line of the panel.") =>
      summariseIssues([ISSUE({ code, message })], CONTEXT).status;
    expect(status("final_result_differs")).toBe("Explain the result under Remark");
    expect(status("size_not_ordered")).toBe("Data for a size not ordered");
    expect(status("box_duplicate")).toBe("Box entered twice");
    expect(status("lot_number_duplicate")).toBe("Lot number entered twice");
    expect(status("dye_leak_below_plan")).toBe("Sample below plan");
    expect(status("lab_report_missing")).toBe("Lab report not attached");
    expect(status("expiry_not_after_mfg")).toBe("Dates to check");
    expect(status("defect_not_in_template")).toBe("Not in the list");
    expect(status("holes_exceed_tested")).toBe("More than planned");
    expect(status("gloves_per_case_mismatch")).toBe("Numbers do not match");
    expect(status("weight_not_positive")).toBe("Value to check");
    expect(status("invalid_data")).toBe("Could not be read");
    // A check without words of its own: its message when short and plain, else To check.
    expect(status("something_new", "Seal broken.")).toBe("Seal broken");
    expect(status("something_new")).toBe("To check");
  });

  it("says a custom field is required in its own words, or counts them", () => {
    const required = (field: string) => ISSUE({ moduleKey: "site_notes", code: "required", level: "error", message: `${field} is required.` });
    const context = { ...CONTEXT, title: "Site notes" };
    expect(summariseIssues([required("Container seal intact")], context).status).toBe("Container seal intact is required");
    expect(summariseIssues([required("Seal"), required("Weather")], context).status).toBe("2 required fields");
  });

  it("falls back to Not done yet for a not-done message it cannot read", () => {
    expect(summariseIssues([ISSUE({ message: "Weight (g) is not done." })], CONTEXT).status).toBe("Not done yet");
  });
});

describe("the panel's words", () => {
  it("names each row by its section's short name, a switched-off one too (docs/DESIGN.md, Step Names)", () => {
    const titles = (overrides: ModuleOverrides, data = emptyData()) => {
      const { report, sections } = evaluated(overrides, data);
      const stray: ValidationIssue = { level: "warning", moduleKey: "packing_config", code: "x", message: "Old.", path: [] };
      const issues = overrides.packing_config ? [...report.issues, stray] : report.issues;
      return new Map(pendingTasks(groupIssues(issues, sections), sections, report.modules).map((task) => [task.key, task.title]));
    };
    const empty = titles({});
    // The test registry's titles: "Manufacturer Information", "Weight (g)", "Packing configuration".
    expect(empty.get("header")).toBe("Manufacturer");
    expect(empty.get("weight")).toBe("Weight");
    expect(empty.get("packing_config")).toBe("Packing Configuration");
    expect(empty.get("conclusion")).toBe("Conclusion");
    expect(empty.get("site_notes")).toBe("Site notes");
    expect(titles(OFF).get("packing_config")).toBe("Packing Configuration");
  });

  it("names a section that is not on screen by its title without a trailing note in brackets", () => {
    const { report, sections } = evaluated();
    const issue: ValidationIssue = { level: "error", moduleKey: "old_notes", code: "y", message: "Lost.", path: [] };
    const group = { key: "old_notes", title: "Old Notes (Optional)", linkable: false, errors: [issue], warnings: [] };
    expect(pendingTasks([group], sections, report.modules).map((task) => task.title)).toEqual(["Old Notes"]);
  });

  it("names a task for screen readers with its section, status, sizes and what submit needs", () => {
    expect(taskName({ title: "Weight", status: "4 sizes not done", sizes: ["XS", "S", "M", "L"], more: 0, needed: false })).toBe(
      "Weight: 4 sizes not done: XS, S, M and L.",
    );
    expect(taskName({ title: "Conclusion", status: "Final result and date", sizes: [], more: 1, needed: true })).toBe(
      "Conclusion: Final result and date, and 1 more. Needed before you submit.",
    );
  });

  it("counts sections to do and those submit needs", () => {
    expect(describePending({ total: 0, needed: 0 })).toBe("Nothing pending");
    expect(describePending({ total: 1, needed: 0 })).toBe("1 to do");
    expect(describePending({ total: 10, needed: 1 })).toBe("10 to do · 1 needed before you submit");
    expect(describePending({ total: 3, needed: 2 }, ", ")).toBe("3 to do, 2 needed before you submit");
    const error = (moduleKey: string) => ({ level: "error" as const, moduleKey });
    expect(neededSectionCount([error("weight"), error("weight"), error("conclusion"), { level: "warning", moduleKey: "visual" }])).toBe(2);
    expect(blockedSubmitMessage(1)).toBe("1 item is needed before you can submit.");
    expect(blockedSubmitMessage(3)).toBe("3 items are needed before you can submit.");
  });

  it("builds the rows from the capture test template: one per section, the needed first", () => {
    const { report, sections } = evaluated();
    const rows = pendingTasks(groupIssues(report.issues, sections), sections, report.modules);
    expect(rows.map((row) => row.key)).toEqual([...new Set(rows.map((row) => row.key))]);
    expect(rows[0].needed).toBe(true);
    expect(rows.find((row) => row.key === "conclusion")?.first.code).toBe("module_not_done");
  });
});

describe("unseenIssues", () => {
  it("lists what the server found with a section switched back on elsewhere, and nothing once the screen follows", () => {
    const off = { packing_config: { reason: "n/a", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" } };
    // The screen still has packing switched off; the server checked with it back on.
    const onScreen = evaluated(off).report.issues;
    const found = evaluated().report.issues;
    const unseen = unseenIssues(found, onScreen);
    expect(unseen.length).toBeGreaterThan(0);
    expect(unseen.every((issue) => issue.moduleKey === "packing_config")).toBe(true);
    // Once the screen takes the server's overrides over, it lists them itself.
    expect(unseenIssues(found, evaluated().report.issues)).toEqual([]);
  });

  it("has nothing to add without a refused submit", () => {
    expect(unseenIssues(null, [])).toEqual([]);
    expect(unseenIssues([], evaluated().report.issues)).toEqual([]);
  });
});
