import { describe, expect, it } from "vitest";
import {
  CaptureDataSchema,
  readSectionParam,
  SaveInputSchema,
  SubmitInputSchema,
  SwitchOffInputSchema,
  SwitchOnInputSchema,
} from "./schemas";

const ID = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";

describe("CaptureDataSchema", () => {
  it("takes modules and custom modules, every one optional", () => {
    expect(CaptureDataSchema.safeParse({ modules: {}, custom: {} }).success).toBe(true);
    expect(CaptureDataSchema.safeParse({ modules: { glove_info: { colour: "Blue" } }, custom: {} }).success).toBe(true);
  });

  it("refuses anything else at the top level, and values that are not JSON", () => {
    expect(CaptureDataSchema.safeParse({ modules: {}, custom: {}, extra: 1 }).success).toBe(false);
    expect(CaptureDataSchema.safeParse({ modules: {} }).success).toBe(false);
    expect(CaptureDataSchema.safeParse({ modules: { a: Number.NaN }, custom: {} }).success).toBe(false);
  });
});

describe("action inputs", () => {
  it("checks the autosave request", () => {
    expect(
      SaveInputSchema.safeParse({ inspectionId: ID, data: { modules: {}, custom: {} }, baseUpdatedAt: "2026-10-06T09:14:03.123456+00:00" })
        .success,
    ).toBe(true);
    expect(SaveInputSchema.safeParse({ inspectionId: "INS-1", data: { modules: {}, custom: {} }, baseUpdatedAt: "x" }).success).toBe(
      false,
    );
  });

  it("checks the submit request: an id and a data hash", () => {
    expect(SubmitInputSchema.safeParse({ inspectionId: ID, dataHash: "0123456789abcdef" }).success).toBe(true);
    expect(SubmitInputSchema.safeParse({ inspectionId: ID, dataHash: "nope" }).success).toBe(false);
  });

  it("needs a reason to switch a module off, at most 500 characters, trimmed", () => {
    const parsed = SwitchOffInputSchema.safeParse({ inspectionId: ID, moduleKey: "weight", reason: "  Not ordered.  " });
    expect(parsed.success && parsed.data.reason).toBe("Not ordered.");
    const blank = SwitchOffInputSchema.safeParse({ inspectionId: ID, moduleKey: "weight", reason: "   " });
    expect(blank.success).toBe(false);
    expect(blank.error?.issues[0].message).toBe("Say why this section is switched off.");
    expect(SwitchOffInputSchema.safeParse({ inspectionId: ID, moduleKey: "weight", reason: "x".repeat(501) }).success).toBe(false);
    expect(SwitchOffInputSchema.safeParse({ inspectionId: ID, moduleKey: "nope", reason: "x" }).success).toBe(false);
  });

  it("switches back on by module key", () => {
    expect(SwitchOnInputSchema.safeParse({ inspectionId: ID, moduleKey: "weight" }).success).toBe(true);
    expect(SwitchOnInputSchema.safeParse({ inspectionId: ID, moduleKey: "Weight" }).success).toBe(false);
  });
});

describe("readSectionParam", () => {
  it("reads a module or custom module key, the first of several", () => {
    expect(readSectionParam("glove_info")).toBe("glove_info");
    expect(readSectionParam(["weight", "visual"])).toBe("weight");
    expect(readSectionParam(undefined)).toBeNull();
    expect(readSectionParam("../admin")).toBeNull();
    expect(readSectionParam("Glove")).toBeNull();
  });
});
