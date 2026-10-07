import { describe, expect, it } from "vitest";
import type { ModuleOverrides } from "@/lib/schemas/template";
import { filledData, TEST_ADMIN_ID, TEST_META, TEST_REGISTRY, testTemplate } from "./__fixtures__/capture";
import { evaluateCapture } from "./evaluate";
import { groupIssues, pendingCounts, pendingTasks, taskName } from "./issues";
import {
  mergeRefusedEntries,
  NO_REFUSED_ENTRIES,
  REFUSED_ENTRY_CODE,
  refusedEntriesFrom,
  refusedEntryKey,
  refusedEntryStatus,
  refusedTaskIssues,
  sectionRefusedEntries,
  settledRefusedKeys,
  withoutRefusedKeys,
  withRefusedEntry,
  type RefusedEntry,
} from "./refused";
import { captureSections } from "./sections";

const LENGTH_3 = { namespace: "modules", section: "weight", path: ["sizes", "M", "values", 2] } as const;
const REFUSED = { raw: "2 42", error: "One number per cell." };

function evaluated(overrides: ModuleOverrides = {}, data = filledData()) {
  const evaluation = evaluateCapture({ template: testTemplate(), overrides, data, meta: TEST_META }, TEST_REGISTRY);
  return { ...evaluation, data, sections: captureSections(evaluation.template, evaluation.report, data) };
}

describe("keeping refused entries", () => {
  it("keeps one per section and path, and lets it go", () => {
    const kept = withRefusedEntry(NO_REFUSED_ENTRIES, LENGTH_3, REFUSED, "Weight, No. 3");
    expect([...kept.values()]).toEqual([
      { namespace: "modules", section: "weight", path: ["sizes", "M", "values", 2], raw: "2 42", error: "One number per cell.", label: "Weight, No. 3" },
    ]);
    expect(kept.has(refusedEntryKey(LENGTH_3))).toBe(true);
    // Paths are told apart by value, not by object.
    expect(withRefusedEntry(kept, { ...LENGTH_3, path: ["sizes", "M", "values", 2] }, null).size).toBe(0);
    // A custom module's field of the same path is another entry.
    expect(withRefusedEntry(kept, { ...LENGTH_3, namespace: "custom" }, REFUSED).size).toBe(2);
  });

  it("hands back the same map when nothing changes, so nothing is written", () => {
    const kept = withRefusedEntry(NO_REFUSED_ENTRIES, LENGTH_3, REFUSED, "Weight, No. 3");
    expect(withRefusedEntry(kept, LENGTH_3, REFUSED, "Weight, No. 3")).toBe(kept);
    // A field that reports again without its name keeps the name it had.
    expect(withRefusedEntry(kept, LENGTH_3, REFUSED)).toBe(kept);
    expect(withRefusedEntry(NO_REFUSED_ENTRIES, LENGTH_3, null)).toBe(NO_REFUSED_ENTRIES);
    const retyped = withRefusedEntry(kept, LENGTH_3, { raw: "2,42,", error: "One number per cell." });
    expect(retyped).not.toBe(kept);
    expect(retyped.get(refusedEntryKey(LENGTH_3))).toMatchObject({ raw: "2,42,", label: "Weight, No. 3" });
  });

  it("puts what was refused since the screen opened over what the device kept", () => {
    const stored = refusedEntriesFrom([
      { ...LENGTH_3, ...REFUSED },
      { ...LENGTH_3, path: ["sizes", "L", "values", 0], raw: "abc", error: "Numbers only." },
    ]);
    const since = withRefusedEntry(NO_REFUSED_ENTRIES, LENGTH_3, { raw: "9 9", error: "One number per cell." });
    const merged = mergeRefusedEntries(stored, since);
    expect([...merged.values()].map((entry) => entry.raw)).toEqual(["abc", "9 9"]);
    expect(mergeRefusedEntries(NO_REFUSED_ENTRIES, since)).toBe(since);
    expect(mergeRefusedEntries(stored, NO_REFUSED_ENTRIES)).toBe(stored);
  });

  it("gives each section's fields their own entries by issue path", () => {
    const kept = refusedEntriesFrom([
      { ...LENGTH_3, ...REFUSED },
      { namespace: "custom", section: "size_checks", path: ["sizes", "M", "requirement"], raw: "x", error: "e" },
    ]);
    const weight = sectionRefusedEntries(kept, "modules", "weight");
    expect([...weight.keys()]).toEqual([JSON.stringify(["sizes", "M", "values", 2])]);
    expect(sectionRefusedEntries(kept, "custom", "weight").size).toBe(0);
  });

  it("lets an entry go once a value lands at its path, however it got there", () => {
    const kept = refusedEntriesFrom([
      { ...LENGTH_3, ...REFUSED },
      { ...LENGTH_3, path: ["sizes", "L", "values", 0], raw: "abc", error: "Numbers only." },
      { namespace: "custom", section: "site_notes", path: ["weather"], raw: "x", error: "e" },
    ]);
    const before = filledData();
    expect(settledRefusedKeys(kept, before)).toEqual([]);
    const data = {
      modules: { ...before.modules, weight: { sizes: { M: { values: [2.4, null, 2.42] }, L: { values: [null] } } } },
      custom: { site_notes: { weather: "" } },
    };
    const settled = settledRefusedKeys(kept, data);
    expect(settled).toEqual([refusedEntryKey(LENGTH_3)]);
    expect([...withoutRefusedKeys(kept, settled).values()].map((entry) => entry.raw)).toEqual(["abc", "x"]);
    expect(withoutRefusedKeys(kept, [])).toBe(kept);
  });
});

describe("refused entries in the Pending panel", () => {
  const entry = (overrides: Partial<RefusedEntry>): RefusedEntry => ({ ...LENGTH_3, ...REFUSED, label: "Weight, No. 3", ...overrides });

  it("words one entry with its field, and falls back to the text alone when that is long", () => {
    expect(refusedEntryStatus({ raw: "2 42", label: "Length, No. 3" })).toBe("Length, No. 3: “2 42” to retype");
    expect(refusedEntryStatus({ raw: " 2 42 " })).toBe("“2 42” to retype");
    expect(refusedEntryStatus({ raw: "2 42", label: "Finger Thickness at the middle finger, No. 12" })).toBe("“2 42” to retype");
    expect(refusedEntryStatus({ raw: "twelve point four two", label: "Length, No. 3" })).toBe("Length, No. 3: “twelve poin…” to retype");
  });

  it("lists entries of sections on screen and ordered sizes, in screen order, as warnings that link to the field", () => {
    const { sections, context } = evaluated();
    expect(context.sizes).toEqual(["M", "L"]);
    const kept = refusedEntriesFrom([
      entry({ path: ["sizes", "L", "values", 0], label: "Weight, No. 1", raw: "abc" }),
      entry({ section: "glove_info", path: ["indicativeWeight"], label: "Indicative weight", raw: "3,5,1" }),
      entry({ path: ["sizes", "M", "values", 10], label: "Weight, No. 11", raw: "x" }),
      entry({ path: ["sizes", "M", "values", 2] }),
      // A size no longer ordered, a section that is not there, the wrong data for the section: kept, not listed.
      entry({ path: ["sizes", "XL", "values", 0] }),
      entry({ section: "nowhere" }),
      entry({ namespace: "custom" }),
    ]);
    const issues = refusedTaskIssues(kept, sections, context.sizes);
    expect(issues.map((issue) => [issue.moduleKey, issue.size, issue.path.join("/"), issue.message])).toEqual([
      ["glove_info", undefined, "indicativeWeight", "Indicative weight: “3,5,1” to retype"],
      ["weight", "M", "sizes/M/values/2", "Weight, No. 3: “2 42” to retype"],
      ["weight", "M", "sizes/M/values/10", "Weight, No. 11: “x” to retype"],
      ["weight", "L", "sizes/L/values/0", "Weight, No. 1: “abc” to retype"],
    ]);
    expect(issues.every((issue) => issue.level === "warning" && issue.code === REFUSED_ENTRY_CODE)).toBe(true);
  });

  it("lists a packing configuration entry right after the order's, as the order's page shows them", () => {
    const { sections, context } = evaluated();
    const kept = refusedEntriesFrom([
      entry({ path: ["sizes", "M", "values", 0], label: "Weight, No. 1" }),
      entry({ section: "packing_config", path: ["glovesPerCase"], label: "# gloves per case", raw: "1 000" }),
      entry({ section: "order_lots", path: ["lots", 0, "qtyCases"], label: "Qty (cases), Size M", raw: "1o" }),
    ]);
    expect(refusedTaskIssues(kept, sections, context.sizes).map((issue) => issue.moduleKey)).toEqual([
      "order_lots",
      "packing_config",
      "weight",
    ]);
  });

  it("leaves out the entries of a section switched off", () => {
    const { sections, context } = evaluated({
      weight: { reason: "Not ordered.", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" },
    });
    expect(refusedTaskIssues(refusedEntriesFrom([entry({})]), sections, context.sizes)).toEqual([]);
  });

  it("names the field first in its section's row and links there, without making the section needed", () => {
    const { report, sections, context } = evaluated();
    const before = pendingTasks(groupIssues(report.issues, sections), sections, report.modules);
    const refused = refusedTaskIssues(refusedEntriesFrom([entry({})]), sections, context.sizes);
    const tasks = pendingTasks(groupIssues([...report.issues, ...refused], sections), sections, report.modules);

    const weight = tasks.find((task) => task.key === "weight");
    expect(weight).toMatchObject({ status: "Weight, No. 3: “2 42” to retype", sizes: ["M"] });
    expect(weight?.first).toMatchObject({ code: REFUSED_ENTRY_CODE, path: ["sizes", "M", "values", 2] });
    // Its other open items are counted as more; whether submit needs the section is the module's call.
    const weightBefore = before.find((task) => task.key === "weight");
    expect(weight?.more).toBe((weightBefore?.more ?? -1) + 1);
    expect(weight?.needed).toBe(weightBefore?.needed);
    expect(taskName(weight!)).toBe(
      `Weight (g): Weight, No. 3: “2 42” to retype: M, and ${weight!.more} more.${weight!.needed ? " Needed before you submit." : ""}`,
    );
    // The same rows otherwise, in the same order.
    expect(tasks.map((task) => task.key)).toEqual(before.map((task) => task.key));
    expect(pendingCounts(tasks)).toEqual(pendingCounts(before));
  });

  it("adds a row in its place in capture order for a section with nothing else open, and counts several", () => {
    const { report, sections, context } = evaluated();
    const refused = refusedTaskIssues(
      refusedEntriesFrom([
        entry({ section: "header", path: ["poNo"], label: "PO No." }),
        entry({ section: "header", path: ["lots", 0, "qty"], label: "Qty" }),
      ]),
      sections,
      context.sizes,
    );
    const before = pendingTasks(groupIssues(report.issues, sections), sections, report.modules);
    expect(before.some((task) => task.key === "header")).toBe(false);
    const tasks = pendingTasks(groupIssues([...report.issues, ...refused], sections), sections, report.modules);
    const header = tasks.find((task) => task.key === "header");
    expect(header).toMatchObject({ status: "2 entries to retype", needed: false, more: 0, linkable: true });
    expect(header?.first.path).toEqual(["lots", 0, "qty"]);
    // Not needed for submit: among the rest, first in capture order.
    const rest = tasks.filter((task) => !task.needed).map((task) => task.key);
    expect(rest[0]).toBe("header");
    expect(pendingCounts(tasks)).toEqual({ total: pendingCounts(before).total + 1, needed: pendingCounts(before).needed });
  });
});
