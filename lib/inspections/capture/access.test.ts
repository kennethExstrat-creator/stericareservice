import { describe, expect, it } from "vitest";
import { builtInGrant, type RoleGrant } from "@/lib/auth/permissions";
import { canSwitchModules, captureAccess, isEditableStatus } from "./access";

const INSPECTOR = "00000000-0000-4000-8000-000000000101";
const OTHER = "00000000-0000-4000-8000-000000000102";

/** What the built-in roles allow, as made: Steri-AI reading for everyone, reopening for admins. */
const AS_INSPECTOR = { aiReading: true, canReopen: false };
const AS_ADMIN = { aiReading: true, canReopen: true };

describe("captureAccess", () => {
  it("lets the inspector edit their own draft and reopened inspections", () => {
    for (const status of ["draft", "reopened"] as const) {
      expect(captureAccess({ status, role: "inspector", userId: INSPECTOR, inspectorId: INSPECTOR })).toEqual({
        editable: true,
        readOnlyReason: null,
        canSwitchModules: false,
        own: true,
        ...AS_INSPECTOR,
      });
    }
  });

  it("lets an admin edit anyone's draft and switch its modules", () => {
    expect(captureAccess({ status: "draft", role: "admin", userId: OTHER, inspectorId: INSPECTOR })).toEqual({
      editable: true,
      readOnlyReason: null,
      canSwitchModules: true,
      own: false,
      ...AS_ADMIN,
    });
  });

  it("keeps a submitted inspection read-only here, for admins too, who may still switch modules", () => {
    expect(captureAccess({ status: "submitted", role: "inspector", userId: INSPECTOR, inspectorId: INSPECTOR })).toEqual({
      editable: false,
      readOnlyReason: "submitted",
      canSwitchModules: false,
      own: true,
      ...AS_INSPECTOR,
    });
    expect(captureAccess({ status: "submitted", role: "admin", userId: OTHER, inspectorId: INSPECTOR })).toEqual({
      editable: false,
      readOnlyReason: "submitted",
      canSwitchModules: true,
      own: false,
      ...AS_ADMIN,
    });
  });

  it("keeps an approved inspection read-only for everyone, overrides included", () => {
    expect(captureAccess({ status: "approved", role: "admin", userId: OTHER, inspectorId: INSPECTOR })).toEqual({
      editable: false,
      readOnlyReason: "approved",
      canSwitchModules: false,
      own: false,
      ...AS_ADMIN,
    });
  });

  it("never lets an inspector edit another inspector's inspection", () => {
    expect(captureAccess({ status: "draft", role: "inspector", userId: OTHER, inspectorId: INSPECTOR })).toMatchObject({
      editable: false,
      readOnlyReason: "not_yours",
    });
  });

  // A lead inspector reads their team's inspections (migration 20261007170000),
  // as an inspector who does not own them: read-only, in every status.
  it("shows a lead inspector their team's inspections read-only, and lets them switch no module", () => {
    const LEAD = "00000000-0000-4000-8000-000000000103";
    for (const status of ["draft", "reopened"] as const) {
      expect(captureAccess({ status, role: "inspector", userId: LEAD, inspectorId: INSPECTOR })).toEqual({
        editable: false,
        readOnlyReason: "not_yours",
        canSwitchModules: false,
        own: false,
        ...AS_INSPECTOR,
      });
    }
    // Submitted, it is read-only for everyone; it is still not the lead's own (the notice names whose it is).
    expect(captureAccess({ status: "submitted", role: "inspector", userId: LEAD, inspectorId: INSPECTOR })).toMatchObject({
      editable: false,
      readOnlyReason: "submitted",
      canSwitchModules: false,
      own: false,
    });
    // Their own draft is theirs to edit, like any inspector's.
    expect(captureAccess({ status: "draft", role: "inspector", userId: LEAD, inspectorId: LEAD }).editable).toBe(true);
  });

  // Roles and permissions (migration 20261027150000): what someone sees stays with `role`; what they may do is the role's.
  it("follows the role's switches: steps, Steri-AI reading and reopening", () => {
    const desk: RoleGrant = { builtIn: null, access: "all", permissions: ["create_inspections"] };
    expect(captureAccess({ status: "draft", role: "admin", userId: OTHER, inspectorId: INSPECTOR, grant: desk })).toEqual({
      editable: true,
      readOnlyReason: null,
      canSwitchModules: false,
      own: false,
      aiReading: false,
      canReopen: false,
    });
    const supervisor: RoleGrant = { ...desk, permissions: ["switch_steps", "ai_reading", "approve_inspections"] };
    expect(captureAccess({ status: "submitted", role: "admin", userId: OTHER, inspectorId: INSPECTOR, grant: supervisor })).toMatchObject({
      canSwitchModules: true,
      aiReading: true,
      canReopen: true,
    });
    // An Inspector role whose Steri-AI Reading is switched off edits as before, without Steri-AI.
    const quiet: RoleGrant = { ...builtInGrant("inspector"), permissions: ["create_inspections", "delete_drafts"] };
    expect(captureAccess({ status: "draft", role: "inspector", userId: INSPECTOR, inspectorId: INSPECTOR, grant: quiet })).toMatchObject({
      editable: true,
      aiReading: false,
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

  it("needs every inspection in sight and the role's Switch Inspection Steps On or Off", () => {
    const steps: RoleGrant = { builtIn: null, access: "all", permissions: ["switch_steps"] };
    expect(canSwitchModules({ status: "draft", role: "admin", grant: steps })).toBe(true);
    expect(canSwitchModules({ status: "draft", role: "admin", grant: { ...steps, permissions: [] } })).toBe(false);
    // Stored on a role that sees only its own inspections, the switch does nothing.
    expect(canSwitchModules({ status: "draft", role: "inspector", grant: { ...steps, access: "own" } })).toBe(false);
  });
});
