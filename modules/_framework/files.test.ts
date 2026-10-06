import { describe, expect, it } from "vitest";
import { Constants } from "@/lib/supabase/database.types";
import { FILE_KINDS, FileIdCellSchema, heldFileState } from "./files";
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
});
