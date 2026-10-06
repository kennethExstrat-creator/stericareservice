import { describe, expect, it } from "vitest";
import { canSwitchModules, captureAccess, isEditableStatus } from "./access";

const INSPECTOR = "00000000-0000-4000-8000-000000000101";
const OTHER = "00000000-0000-4000-8000-000000000102";

describe("captureAccess", () => {
  it("lets the inspector edit their own draft and reopened inspections", () => {
    for (const status of ["draft", "reopened"] as const) {
      expect(captureAccess({ status, role: "inspector", userId: INSPECTOR, inspectorId: INSPECTOR })).toEqual({
        editable: true,
        readOnlyReason: null,
        canSwitchModules: false,
      });
    }
  });

  it("lets an admin edit anyone's draft and switch its modules", () => {
    expect(captureAccess({ status: "draft", role: "admin", userId: OTHER, inspectorId: INSPECTOR })).toEqual({
      editable: true,
      readOnlyReason: null,
      canSwitchModules: true,
    });
  });

  it("keeps a submitted inspection read-only here, for admins too, who may still switch modules", () => {
    expect(captureAccess({ status: "submitted", role: "inspector", userId: INSPECTOR, inspectorId: INSPECTOR })).toEqual({
      editable: false,
      readOnlyReason: "submitted",
      canSwitchModules: false,
    });
    expect(captureAccess({ status: "submitted", role: "admin", userId: OTHER, inspectorId: INSPECTOR })).toEqual({
      editable: false,
      readOnlyReason: "submitted",
      canSwitchModules: true,
    });
  });

  it("keeps an approved inspection read-only for everyone, overrides included", () => {
    expect(captureAccess({ status: "approved", role: "admin", userId: OTHER, inspectorId: INSPECTOR })).toEqual({
      editable: false,
      readOnlyReason: "approved",
      canSwitchModules: false,
    });
  });

  it("never lets an inspector edit another inspector's inspection", () => {
    expect(captureAccess({ status: "draft", role: "inspector", userId: OTHER, inspectorId: INSPECTOR })).toMatchObject({
      editable: false,
      readOnlyReason: "not_yours",
    });
  });
});

describe("isEditableStatus and canSwitchModules", () => {
  it("edits drafts and reopened inspections only", () => {
    expect(["draft", "submitted", "approved", "reopened"].filter((status) => isEditableStatus(status as never))).toEqual([
      "draft",
      "reopened",
    ]);
  });

  it("lets only admins switch modules, until approval", () => {
    expect(canSwitchModules({ status: "reopened", role: "admin" })).toBe(true);
    expect(canSwitchModules({ status: "approved", role: "admin" })).toBe(false);
    expect(canSwitchModules({ status: "draft", role: "inspector" })).toBe(false);
  });
});
