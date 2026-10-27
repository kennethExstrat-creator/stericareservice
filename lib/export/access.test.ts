// Who may export an inspection (BUILD_SPEC 9.1): its inspector, their lead
// inspector (Kenneth, 27 October 2026: "Can lead inspectors download
// reports?" "Yes") or an admin, from who they are, never from what a read
// returned.
import { describe, expect, it } from "vitest";
import { canExportInspection, type ExportViewer } from "./access";

const INSPECTOR = "00000000-0000-4000-8000-000000000101";
const OTHER_INSPECTOR = "00000000-0000-4000-8000-000000000102";
const LEAD = "00000000-0000-4000-8000-000000000201";
const OTHER_LEAD = "00000000-0000-4000-8000-000000000202";
const ADMIN = "00000000-0000-4000-8000-000000000301";

const lead = (id: string): ExportViewer => ({ id, role: "inspector", isLead: true });

/** INSPECTOR's inspection; INSPECTOR is in LEAD's team. */
const TEAM_INSPECTION = { inspectorId: INSPECTOR, inspectorLeadId: LEAD };

describe("canExportInspection", () => {
  it("lets a lead inspector export a team member's inspection", () => {
    expect(canExportInspection(lead(LEAD), TEAM_INSPECTION)).toBe(true);
  });

  it("refuses a lead inspector another lead's team", () => {
    expect(canExportInspection(lead(OTHER_LEAD), TEAM_INSPECTION)).toBe(false);
  });

  it("lets a lead inspector export their own inspection, like any inspector", () => {
    // A lead inspector is in no team of their own.
    expect(canExportInspection(lead(LEAD), { inspectorId: LEAD, inspectorLeadId: null })).toBe(true);
  });

  it("refuses an inspector someone else's inspection, and gives them their own", () => {
    expect(canExportInspection({ id: OTHER_INSPECTOR, role: "inspector" }, TEAM_INSPECTION)).toBe(false);
    expect(canExportInspection({ id: INSPECTOR, role: "inspector" }, TEAM_INSPECTION)).toBe(true);
  });

  it("lets an admin export any inspection", () => {
    expect(canExportInspection({ id: ADMIN, role: "admin" }, TEAM_INSPECTION)).toBe(true);
    expect(canExportInspection({ id: ADMIN, role: "admin" }, { inspectorId: OTHER_INSPECTOR })).toBe(true);
  });

  it("refuses a lead inspector when the inspection does not name the inspector's lead", () => {
    expect(canExportInspection(lead(LEAD), { inspectorId: INSPECTOR })).toBe(false);
    expect(canExportInspection(lead(LEAD), { inspectorId: INSPECTOR, inspectorLeadId: null })).toBe(false);
  });

  it("refuses the inspector's lead when the viewer is not flagged a lead inspector", () => {
    // Absent, as Steri-AI's viewers are, or false, the level taken away since.
    expect(canExportInspection({ id: LEAD, role: "inspector" }, TEAM_INSPECTION)).toBe(false);
    expect(canExportInspection({ id: LEAD, role: "inspector", isLead: false }, TEAM_INSPECTION)).toBe(false);
  });
});
