import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  emptyInspectionData,
  InspectionDataSchema,
  perSizeData,
  readModuleEntry,
  writeModuleComment,
  writeModuleData,
  type InspectionData,
} from "./data";

const data: InspectionData = {
  modules: {
    glove_info: { colour: "Blue", comment: "Colour checked against the spec sheet." },
    weight: { comment: "Scale being calibrated." },
    header: "corrupt",
  },
  custom: {},
};

describe("inspection data", () => {
  it("has the shape the database stores, keeping keys it does not know", () => {
    expect(InspectionDataSchema.parse(emptyInspectionData())).toEqual({ modules: {}, custom: {} });
    expect(InspectionDataSchema.parse({ modules: {}, custom: {}, version: 2 })).toEqual({ modules: {}, custom: {}, version: 2 });
    expect(InspectionDataSchema.safeParse({ modules: [] }).success).toBe(false);
  });

  it("reads a module's values apart from its inspector comment", () => {
    expect(readModuleEntry(data, "modules", "glove_info")).toEqual({
      value: { colour: "Blue" },
      comment: "Colour checked against the spec sheet.",
      hasData: true,
    });
    // A comment alone is not data: the module is still not done.
    expect(readModuleEntry(data, "modules", "weight")).toEqual({
      value: {},
      comment: "Scale being calibrated.",
      hasData: false,
    });
    expect(readModuleEntry(data, "modules", "dimensions")).toEqual({ value: undefined, comment: null, hasData: false });
    expect(readModuleEntry(data, "modules", "header")).toEqual({ value: "corrupt", comment: null, hasData: true });
  });

  it("writes values and keeps the comment, writes the comment and keeps the values", () => {
    const next = writeModuleData(data, "modules", "glove_info", { colour: "Green", comment: "ignored" });
    expect(next.modules.glove_info).toEqual({ colour: "Green", comment: "Colour checked against the spec sheet." });
    expect(data.modules.glove_info).toEqual({ colour: "Blue", comment: "Colour checked against the spec sheet." });

    const commented = writeModuleComment(next, "modules", "glove_info", "Second look.");
    expect(commented.modules.glove_info).toEqual({ colour: "Green", comment: "Second look." });
    expect(writeModuleComment(commented, "modules", "glove_info", " ").modules.glove_info).toEqual({ colour: "Green" });
    expect(writeModuleComment(emptyInspectionData(), "custom", "notes", "Seen.").custom.notes).toEqual({ comment: "Seen." });
  });

  it("keeps per-size data under sizes, empty by default", () => {
    const schema = perSizeData(z.strictObject({ values: z.array(z.number()) }));
    expect(schema.parse({})).toEqual({ sizes: {} });
    expect(schema.parse({ sizes: { M: { values: [2.9] } } })).toEqual({ sizes: { M: { values: [2.9] } } });
    expect(schema.safeParse({ sizes: { M: { values: ["2 42"] } } }).success).toBe(false);
    expect(schema.extend({ labReportFileId: z.string().nullable().default(null) }).parse({})).toEqual({
      sizes: {},
      labReportFileId: null,
    });
  });
});
