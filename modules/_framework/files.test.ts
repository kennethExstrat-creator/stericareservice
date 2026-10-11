import { describe, expect, it } from "vitest";
import { Constants } from "@/lib/supabase/database.types";
import { FILE_KINDS, FileIdCellSchema, heldFileState, missingFileMessage, moduleFileState } from "./files";
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
