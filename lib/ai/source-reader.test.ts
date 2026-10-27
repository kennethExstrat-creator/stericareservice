import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./document-reader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./document-reader")>()),
  createMessage: vi.fn(),
}));

import { fileLinkTarget } from "@/lib/inspections/source-documents";
import { MODULE_REGISTRY } from "@/modules";
import { DOCUMENTS_DEFAULT_CONFIG } from "@/modules/documents/config";
import { createMessage } from "./document-reader";
import { LAB_REPORT_GUIDE, PAPER_FORM_GUIDE, SPREADSHEET_NOTE, WEIGHT_GUIDE } from "./reading-guide";
import {
  attachTargets,
  attachToText,
  moduleDataJsonSchema,
  parseSourceAnswer,
  readSourceDocument,
  SOURCE_READER_SYSTEM_PROMPT,
} from "./source-reader";

afterEach(() => {
  vi.resetAllMocks();
});

/** A JSON Schema node, as far as these tests read it. */
type Node = { $schema?: string; description?: string; properties?: Record<string, Node>; additionalProperties?: Node; required?: string[] };

describe("the modules' data as the reading gets it (moduleDataJsonSchema)", () => {
  it("gives the packing check's aged sample per size beside the boxes, without a box/carton number, and says what it is (Kenneth, 26 October 2026)", () => {
    const schema = moduleDataJsonSchema(MODULE_REGISTRY.dispensing_packing.dataSchema) as Node;
    expect(schema.$schema).toBeUndefined();
    const size = schema.properties?.sizes?.additionalProperties;
    expect(Object.keys(size?.properties ?? {})).toEqual(["boxes", "agedSample"]);
    const aged = size?.properties?.agedSample;
    expect(Object.keys(aged?.properties ?? {})).toEqual(["layeringPct", "dispensingPct", "stickiness", "note"]);
    expect(aged?.description).toContain("The size's aged sample: the packing row marked as aged");
    expect(aged?.description).toContain("never one of the boxes");
    expect(size?.properties?.boxes?.description).toContain("Never the aged sample: that is agedSample.");
    // The input shape: nothing is required, so a reading gives only what it read.
    expect(size?.required ?? []).toEqual([]);
    expect(aged?.required ?? []).toEqual([]);
  });

  it("tells the sampling plan's inner boxes in all from those per case, which only a document stating them fills (Kenneth, 27 October 2026)", () => {
    const schema = moduleDataJsonSchema(MODULE_REGISTRY.sampling_plan.dataSchema) as Node;
    const size = schema.properties?.sizes?.additionalProperties;
    expect(Object.keys(size?.properties ?? {}).slice(0, 3)).toEqual(["cases", "innerUnitsPerCase", "innerUnits"]);
    expect(size?.properties?.innerUnits?.description).toContain("the total a document gives, as the paper form's Sampling Plan does (Inner Box)");
    expect(size?.properties?.innerUnits?.description).toContain("The app works it out from cases and innerUnitsPerCase when both are entered.");
    expect(size?.properties?.innerUnitsPerCase?.description).toContain("only where a document states the count per case");
    expect(size?.properties?.innerUnitsPerCase?.description).toContain("Never derived from a total: a total goes into innerUnits.");
    expect(size?.required ?? []).toEqual([]);
  });

  it("describes each size's code letter, which a document stating it fills, and never the reason it was lowered (Kenneth, 27 October 2026)", () => {
    const schema = moduleDataJsonSchema(MODULE_REGISTRY.sampling_plan.dataSchema) as Node;
    const size = schema.properties?.sizes?.additionalProperties;
    expect(size?.properties?.codeLetter?.description).toContain("ISO 2859-1 sample size code letter (A to R, no I or O)");
    expect(size?.properties?.codeLetter?.description).toContain('only where a document states it for the size, such as "Code Letter M"');
    expect(size?.properties?.codeLetter?.description).toContain("Never work it out from the lot size, the sample size or the inspection level.");
    expect(size?.properties?.codeLetterReason?.description).toContain("Never set from a document.");
    expect(size?.required ?? []).toEqual([]);
  });

  it("writes every module's data, so no module is left out of a reading", () => {
    for (const [key, definition] of Object.entries(MODULE_REGISTRY)) expect(moduleDataJsonSchema(definition.dataSchema), key).not.toBeNull();
  });
});

describe("the reading's system prompt", () => {
  it("tells the reader where an aged sample goes, as the paper form guide says (Kenneth, 26 October 2026)", () => {
    expect(SOURCE_READER_SYSTEM_PROMPT).toContain("- An aged sample is not a box: a dispensing or packing row marked as one");
  });

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

  it("files every lab report, also beside one a step already lists, and never writes the list itself (Kenneth, 26 October 2026)", () => {
    const lines = SOURCE_READER_SYSTEM_PROMPT.split("\n");
    const attach = lines.find((line) => line.startsWith('List in "attachTo"')) ?? "";
    expect(attach).toContain(
      "File every lab report, also when the current data already lists another one for that step: a lab often issues one report per size.",
    );
    expect(lines).toContain('- Never write a file field (labReports, a documents item\'s file): the app fills it from "attachTo".');
    expect(SOURCE_READER_SYSTEM_PROMPT).toContain(LAB_REPORT_GUIDE);
    const guide = LAB_REPORT_GUIDE.split("\n");
    expect(guide.find((line) => line.startsWith("- Do both:"))).toContain(
      "File it even when the step already has another size's report: each report is linked with the sizes it gives results for.",
    );
    // Its results come with every size it reports, entered or not, so a report read again is linked with its sizes.
    const leaveOut = lines.find((line) => line.startsWith("- Leave out fields that already hold a value in the current data")) ?? "";
    expect(leaveOut).toContain("So are a lab report's results: give them for every size it reports (the lab report guide below).");
    expect(guide.at(-1)).toBe(
      "- Give the results of every size the report holds, also where the current data already holds them: the app keeps what is entered, and links the report with the sizes it gives results for.",
    );
  });
});

describe("an Excel or CSV file's reading (Kenneth, 26 October 2026)", () => {
  it("tells the reader how a spreadsheet comes, in the prompt every file shares", () => {
    expect(SOURCE_READER_SYSTEM_PROMPT).toContain(`Read every page, tables and handwriting included. ${SPREADSHEET_NOTE}\n`);
    expect(SPREADSHEET_NOTE).toContain('each sheet as CSV under a line "Sheet: <name>"');
  });

  it("sends the spreadsheet's text as a plain-text document after the cached modules, read like any document", async () => {
    vi.mocked(createMessage).mockResolvedValue({
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ summary: "Packing list for PO-0001.", modules: { order: { sizes: { M: { qtyCases: 20 } } } } }) }],
    } as never);

    const outcome = await readSourceDocument(
      {
        defectLibrary: [],
        glossary: [],
        attachTargets: [],
        file: { mediaType: "text/plain", text: "Sheet: Packing\nSize,Cases\nM,20", name: "Packing list.xlsx" },
        modules: [{ key: "order", title: "PO Info", config: {}, schema: {} }],
        sizes: [{ value: "M", label: "M" }],
        unit: "pcs",
        current: {},
      },
      { ANTHROPIC_API_KEY: "sk-ant-test-key-0000000000" },
    );

    expect(outcome).toMatchObject({ ok: true, summary: "Packing list for PO-0001.", proposals: { order: { sizes: { M: { qtyCases: 20 } } } } });
    const params = vi.mocked(createMessage).mock.calls[0][1];
    expect(params.system).toBe(SOURCE_READER_SYSTEM_PROMPT);
    const content = params.messages[0].content;
    expect(Array.isArray(content) && content.length).toBe(3);
    if (!Array.isArray(content)) return;
    expect(content[0]).toMatchObject({ type: "text", cache_control: { type: "ephemeral" } });
    expect(content[1]).toEqual({
      type: "document",
      source: { type: "text", media_type: "text/plain", data: "Sheet: Packing\nSize,Cases\nM,20" },
      title: "Packing list.xlsx",
    });
    expect(content[2]).toMatchObject({ type: "text", text: expect.stringContaining('Read the document above ("Packing list.xlsx")') });
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
        what: 'the lab reports of "Force at Break in Newton (Refer to Attached Where Applicable)": each laboratory test report with force at break results',
      },
      {
        link: "tensile",
        what: 'the lab reports of "Physical Properties Average": each laboratory test report with tensile strength or elongation at break results',
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
