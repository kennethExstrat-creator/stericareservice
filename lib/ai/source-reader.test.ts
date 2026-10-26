import { describe, expect, it } from "vitest";
import { fileLinkTarget } from "@/lib/inspections/source-documents";
import { DOCUMENTS_DEFAULT_CONFIG } from "@/modules/documents/config";
import { PAPER_FORM_GUIDE, WEIGHT_GUIDE } from "./reading-guide";
import { attachTargets, attachToText, parseSourceAnswer, SOURCE_READER_SYSTEM_PROMPT } from "./source-reader";

describe("the reading's system prompt", () => {
  it("puts a box/carton number into its test and into Box/Carton Numbers, as the paper form guide says (Kenneth, 14 October 2026)", () => {
    const lines = SOURCE_READER_SYSTEM_PROMPT.split("\n");
    const at = lines.findIndex((line) => line.startsWith("- A box/carton number goes into"));
    expect(lines[at]).toBe(
      "- A box/carton number goes into its own test's field and also into carton_sampling's list for its size (the paper form guide below).",
    );
    // One of the rules, after the per-size one, and before the rule that leaves out what the current data holds.
    expect(at).toBe(lines.findIndex((line) => line.startsWith("- Per-size data goes under that size")) + 1);
    expect(at).toBeLessThan(lines.findIndex((line) => line.startsWith("- Leave out fields that already hold a value in the current data")));
    expect(SOURCE_READER_SYSTEM_PROMPT).toContain(PAPER_FORM_GUIDE);
    expect(SOURCE_READER_SYSTEM_PROMPT).toContain("- So each box/carton number a document gives for a size's boxes");
  });

  it("reads weight as one average per size from a dimension sheet, after the lab report guide (Kenneth, 26 October 2026)", () => {
    expect(SOURCE_READER_SYSTEM_PROMPT.endsWith(`\n\n${WEIGHT_GUIDE}`)).toBe(true);
  });
});

describe("parseSourceAnswer", () => {
  const answer = (extra: Record<string, unknown>) =>
    parseSourceAnswer(`Here it is:\n${JSON.stringify({ summary: "Lab test report.", modules: { tensile: { sizes: {} } }, ...extra })}`);

  it("reads where the file itself belongs, once each, dropping what is not a module key or documents row", () => {
    const parsed = answer({ attachTo: ["tensile", " documents.labTestReports ", "tensile", 42, "drop table", ""] });
    expect(parsed?.attachTo).toEqual(["tensile", "documents.labTestReports"]);
    expect(parsed?.proposals).toEqual({ tensile: { sizes: {} } });
  });

  it("attaches nowhere when the answer has no attachTo, or something else there", () => {
    expect(answer({})?.attachTo).toEqual([]);
    expect(answer({ attachTo: "tensile" })?.attachTo).toEqual([]);
    expect(answer({ attachTo: null })?.summary).toBe("Lab test report.");
  });
});

describe("attachTargets", () => {
  it("names where a document itself is filed in the template's words: each step's lab report, each row on the checklist", () => {
    const targets = attachTargets([
      { key: "header", title: "Manufacturer Information", config: {} },
      { key: "force_at_break", title: "Force at Break in Newton (Refer to Attached Where Applicable)", config: {} },
      { key: "tensile", title: "Physical Properties Average", config: {} },
      {
        key: "documents",
        title: "Supporting Documents",
        config: {
          items: [
            { key: "certificateOfAnalysis", include: true, required: true },
            { key: "labTestReports", include: true, required: false },
            { key: "iso13485", include: false, required: false },
          ],
        },
        labels: { certificateOfAnalysis: "COA" },
      },
    ]);
    expect(targets).toEqual([
      {
        link: "force_at_break",
        what: 'the lab report of "Force at Break in Newton (Refer to Attached Where Applicable)": a laboratory test report with force at break results',
      },
      {
        link: "tensile",
        what: 'the lab report of "Physical Properties Average": a laboratory test report with tensile strength or elongation at break results',
      },
      { link: "documents.certificateOfAnalysis", what: '"COA" on "Supporting Documents": the certificate or record itself' },
      { link: "documents.labTestReports", what: '"Lab Test Reports" on "Supporting Documents": the laboratory test report itself' },
    ]);
  });

  it("names only places the file can be linked to (linkSourceFile)", () => {
    const targets = attachTargets([
      { key: "tensile", title: "Tensile", config: {} },
      { key: "force_at_break", title: "Force at Break", config: {} },
      { key: "documents", title: "Documents", config: DOCUMENTS_DEFAULT_CONFIG },
    ]);
    expect(targets).toHaveLength(8);
    for (const target of targets) expect(fileLinkTarget(target.link, "00000000-0000-4000-8000-000000000701"), target.link).not.toBeNull();
  });

  it("lists no row for documents settings that do not read, and says when there is nowhere to file a document", () => {
    expect(attachTargets([{ key: "documents", title: "Documents", config: { items: "all" } }])).toEqual([]);
    expect(attachToText([])).toBe('This inspection files no document itself: leave "attachTo" out.');
    expect(attachToText([{ link: "tensile", what: "the lab report" }])).toBe(
      'Where this inspection files a document itself (the answer\'s "attachTo"):\n- "tensile": the lab report.',
    );
  });
});
