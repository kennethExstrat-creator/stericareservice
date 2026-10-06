import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  emptyInspectionData,
  InspectionDataSchema,
  parseModuleData,
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

  it("gives Capture every saved size, so writing back its change keeps sizes no longer ordered (6.2 rule 4)", () => {
    const definition = {
      dataSchema: perSizeData(z.strictObject({ values: z.array(z.number()) })),
      emptyData: () => ({ sizes: {} }),
    };
    // L was ordered when it was weighed, then removed from the order.
    const saved: InspectionData = { modules: { weight: { sizes: { M: { values: [2.9] }, L: { values: [3.4] } } } }, custom: {} };
    const parsed = parseModuleData(definition, readModuleEntry(saved, "modules", "weight"));
    if (!parsed.success) throw new Error("expected saved data to parse");
    expect(parsed.data.sizes).toEqual({ M: { values: [2.9] }, L: { values: [3.4] } });

    // The inspector edits M, the only ordered size; Capture hands back the whole value.
    const next = { ...parsed.data, sizes: { ...parsed.data.sizes, M: { values: [2.9, 2.8] } } };
    expect(writeModuleData(saved, "modules", "weight", next).modules.weight).toEqual({
      sizes: { M: { values: [2.9, 2.8] }, L: { values: [3.4] } },
    });

    expect(parseModuleData(definition, readModuleEntry(emptyInspectionData(), "modules", "weight"))).toEqual({
      success: true,
      data: { sizes: {} },
    });
    const broken: InspectionData = { modules: { weight: { sizes: { M: { values: ["2 42"] } } } }, custom: {} };
    expect(parseModuleData(definition, readModuleEntry(broken, "modules", "weight")).success).toBe(false);
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
