import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Constants } from "@/lib/supabase/database.types";
import {
  addLabReports,
  FILE_KINDS,
  FileIdCellSchema,
  foldLabReport,
  heldFileState,
  LabReportEntrySchema,
  LabReportsSchema,
  labReportSizesText,
  labReportsState,
  missingFileMessage,
  moduleFileState,
  readingLabReports,
  sortLabReports,
  withoutLabReportFile,
} from "./files";
import { makeTestContext } from "./testing";

const REPORT = "00000000-0000-4000-8000-000000000402";
const OTHER = "00000000-0000-4000-8000-000000000403";

describe("the file channel", () => {
  it("knows the kinds inspection_files takes", () => {
    expect([...FILE_KINDS]).toEqual([...Constants.public.Enums.inspection_file_kind]);
  });

  it("keeps a file as its inspection_files id, never a name or a path", () => {
    expect(FileIdCellSchema.parse(undefined)).toBeNull();
    expect(FileIdCellSchema.parse(REPORT)).toBe(REPORT);
    for (const value of ["tensile-report.pdf", "inspection-files/abc.pdf", 7]) {
      expect(FileIdCellSchema.safeParse(value).success).toBe(false);
    }
  });

  it("takes a kept file as attached while the inspection's files are not known", () => {
    expect(heldFileState(makeTestContext(), null)).toBe("none");
    expect(heldFileState(makeTestContext(), REPORT)).toBe("attached");
    // A context built before files existed.
    expect(heldFileState({}, REPORT)).toBe("attached");
  });

  it("tells a kept file that has since been deleted once the inspection's files are known", () => {
    const context = makeTestContext({ files: [{ id: REPORT, moduleKey: "tensile", kind: "lab_report" }] });
    expect(heldFileState(context, REPORT)).toBe("attached");
    expect(heldFileState(context, OTHER)).toBe("missing");
    expect(heldFileState(makeTestContext({ files: [] }), REPORT)).toBe("missing");
    expect(heldFileState(context, null)).toBe("none");
  });

  it("counts any file of the module and kind once the inspection's files are known: one added in the gallery keeps no id", () => {
    const tensile = { moduleKey: "tensile", kind: "lab_report" } as const;
    const gallery = makeTestContext({ files: [{ id: OTHER, moduleKey: "tensile", kind: "lab_report" }] });
    expect(moduleFileState(gallery, { ...tensile, fileId: null })).toBe("attached");
    // The kept one was deleted, another lab report of the module is still there.
    expect(moduleFileState(gallery, { ...tensile, fileId: REPORT })).toBe("attached");
    // Another module's file, or another kind, attaches nothing.
    expect(moduleFileState(gallery, { moduleKey: "force_at_break", kind: "lab_report", fileId: null })).toBe("none");
    expect(moduleFileState(gallery, { ...tensile, kind: "certificate", fileId: REPORT })).toBe("missing");
    expect(moduleFileState(makeTestContext({ files: [] }), { ...tensile, fileId: REPORT })).toBe("missing");
    expect(moduleFileState(makeTestContext({ files: [] }), { ...tensile, fileId: null })).toBe("none");
    // Files not known: the kept id alone, as heldFileState.
    expect(moduleFileState(makeTestContext(), { ...tensile, fileId: REPORT })).toBe("attached");
    expect(moduleFileState(makeTestContext(), { ...tensile, fileId: null })).toBe("none");
  });

  it("words a missing file for both reasons it can be missing", () => {
    expect(missingFileMessage("Lab report")).toBe(
      "Lab report: the file linked here is not among this inspection's files. It may still be uploading from another device; if it was deleted, upload it again on Source Documents.",
    );
    expect(missingFileMessage("ISO 13485", "certificate")).toMatch(/^ISO 13485: the certificate linked here /);
  });
});

describe("a step's lab reports (Kenneth, 26 October 2026: one per size)", () => {
  const S = "00000000-0000-4000-8000-000000000411";
  const M = "00000000-0000-4000-8000-000000000412";
  const L = "00000000-0000-4000-8000-000000000413";
  const STEP = { moduleKey: "tensile", kind: "lab_report" } as const;
  const DataSchema = readingLabReports(z.strictObject({ sizes: z.record(z.string(), z.number()).default({}), labReports: LabReportsSchema }));

  it("keeps each report as its file id and the sizes it gives results for", () => {
    expect(LabReportEntrySchema.parse({ fileId: S })).toEqual({ fileId: S, sizes: [] });
    expect(LabReportsSchema.parse(undefined)).toEqual([]);
    for (const entry of [{ fileId: "lab-report.pdf" }, { fileId: S, sizes: "S" }, { fileId: S, sizes: [""] }, { fileId: S, name: "x.pdf" }]) {
      expect(LabReportEntrySchema.safeParse(entry).success, JSON.stringify(entry)).toBe(false);
    }
  });

  it("reads data saved with one lab report as a list of it, with no sizes, so nothing saved fails to parse", () => {
    expect(foldLabReport({ sizes: {}, labReport: S })).toEqual({ sizes: {}, labReports: [{ fileId: S, sizes: [] }] });
    expect(foldLabReport({ sizes: {}, labReport: null })).toEqual({ sizes: {} });
    expect(DataSchema.parse({ labReport: S })).toEqual({ sizes: {}, labReports: [{ fileId: S, sizes: [] }] });
    expect(DataSchema.parse({ labReport: null })).toEqual({ sizes: {}, labReports: [] });
    expect(DataSchema.parse({ labReport: S, labReports: [{ fileId: M, sizes: ["M"] }] }).labReports).toEqual([
      { fileId: M, sizes: ["M"] },
      { fileId: S, sizes: [] },
    ]);
    expect(DataSchema.parse({ labReport: S, labReports: [{ fileId: S, sizes: ["S"] }] }).labReports).toEqual([{ fileId: S, sizes: ["S"] }]);
    // Anything else is left to the schema: no file id, or a list that is no list.
    expect(foldLabReport({ labReport: "lab-report.pdf" })).toEqual({ labReport: "lab-report.pdf" });
    expect(foldLabReport({ labReport: S, labReports: "x" })).toEqual({ labReport: S, labReports: "x" });
    expect(foldLabReport(null)).toBeNull();
    expect(DataSchema.safeParse({ labReport: "lab-report.pdf" }).success).toBe(false);
    // Steri-AI reads the list's shape, never the old field.
    const json = JSON.stringify(z.toJSONSchema(DataSchema, { io: "input", unrepresentable: "any" }));
    expect(json).toContain('"labReports"');
    expect(json).not.toContain('"labReport"');
  });

  it("attaches the step while one report is among the inspection's files, each read on its own", () => {
    const reports = [
      { fileId: S, sizes: ["S"] },
      { fileId: M, sizes: ["M"] },
    ];
    const one = labReportsState(makeTestContext({ files: [{ id: M, moduleKey: "source_documents", kind: "lab_report" }] }), "tensile", reports);
    expect(one.state).toBe("attached");
    expect(one.reports.map((report) => report.state)).toEqual(["missing", "attached"]);
    expect(labReportsState(makeTestContext({ files: [] }), "tensile", reports).state).toBe("missing");
    expect(labReportsState(makeTestContext({ files: [] }), "tensile", []).state).toBe("none");
    // Files not known: kept reports count, as heldFileState.
    expect(labReportsState(makeTestContext(), "tensile", reports).state).toBe("attached");
    // A lab report uploaded on the step before 12 October 2026 counts without a link, as moduleFileState.
    const gallery = makeTestContext({ files: [{ id: L, ...STEP }] });
    expect(labReportsState(gallery, "tensile", []).state).toBe("attached");
    expect(labReportsState(gallery, "tensile", reports)).toMatchObject({ state: "attached", reports: [{ state: "missing" }, { state: "missing" }] });
    expect(labReportsState(gallery, "force_at_break", []).state).toBe("none");
  });

  it("adds a report once, last, and gives one listed the sizes it lacked, never replacing another", () => {
    const held = [{ fileId: S, sizes: [] }];
    expect(addLabReports(held, [{ fileId: M, sizes: ["M"] }])).toEqual({
      reports: [
        { fileId: S, sizes: [] },
        { fileId: M, sizes: ["M"] },
      ],
      changed: 1,
    });
    expect(addLabReports(held, [{ fileId: S, sizes: ["L", "S"] }])).toEqual({ reports: [{ fileId: S, sizes: ["S", "L"] }], changed: 1 });
    expect(addLabReports([{ fileId: S, sizes: ["S"] }], [{ fileId: S, sizes: ["S"] }, { fileId: S, sizes: [] }])).toEqual({
      reports: [{ fileId: S, sizes: ["S"] }],
      changed: 0,
    });
    expect(held).toEqual([{ fileId: S, sizes: [] }]);
  });

  it("unlinks one report, the others staying, and gives the same data back for a file not listed", () => {
    const data = { sizes: {}, labReports: [{ fileId: S, sizes: ["S"] }, { fileId: M, sizes: ["M"] }] };
    expect(withoutLabReportFile(data, S)).toEqual({ sizes: {}, labReports: [{ fileId: M, sizes: ["M"] }] });
    expect(withoutLabReportFile(data, L)).toBe(data);
  });

  it("orders the reports by the template's sizes, a report that names none last, and names their sizes", () => {
    const reports = [
      { fileId: L, sizes: [] },
      { fileId: M, sizes: ["XL", "M"] },
      { fileId: S, sizes: ["S"] },
    ];
    expect(sortLabReports(reports, ["XS", "S", "M", "L", "XL"]).map((report) => report.fileId)).toEqual([S, M, L]);
    expect(labReportSizesText(["S"])).toBe("Size S");
    expect(labReportSizesText(["XS", "S"], (size) => `${size}!`)).toBe("Sizes XS!, S!");
    expect(labReportSizesText([])).toBeNull();
  });
});
