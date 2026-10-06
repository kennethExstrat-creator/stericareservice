// scripts/clean-e2e-data.mts against an in-memory project: what it lists,
// what it keeps and why, and the order it deletes in (Storage objects, then
// the inspection, then the template's source files, then the template).
import { describe, expect, it } from "vitest";
import {
  cleanE2eData,
  describePlan,
  describeResult,
  describeUntouched,
  isTestAccount,
  planCleanup,
  sourceFolder,
  type CleanDatabase,
  type E2eInspection,
  type E2eTemplate,
  type Untouched,
} from "./clean-e2e-data.mjs";

const NOW = new Date("2026-10-07T06:00:00Z");
const HOURS_AGO = "2026-10-07T03:00:00Z";
const MINUTES_AGO = "2026-10-07T05:50:00Z";
const OPTIONS = { now: NOW, minAgeMinutes: 60 };

let nextId = 1;
const uuid = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;

function template(code: string, extra: Partial<E2eTemplate> = {}): E2eTemplate {
  return { id: uuid(), code, version: 1, status: "active", createdAt: HOURS_AGO, ...extra };
}

function inspection(of: E2eTemplate, refNo: string, extra: Partial<E2eInspection> = {}): E2eInspection {
  return {
    id: uuid(),
    refNo,
    status: "draft",
    templateId: of.id,
    createdAt: HOURS_AGO,
    inspector: "inspector@test.local",
    photos: 0,
    files: 0,
    ...extra,
  };
}

const NOTHING_ELSE: Untouched = { clients: [], manufacturers: [], accounts: [] };

/** A project holding these rows and Storage objects; every write is recorded in order. */
function fakeProject(
  templates: E2eTemplate[],
  inspections: E2eInspection[],
  objects: Record<string, string[]> = {},
  failing: { remove?: string; deleteInspection?: string } = {},
) {
  const calls: string[] = [];
  const stored = new Map(Object.entries(objects).map(([key, paths]) => [key, [...paths]]));
  const goneInspections = new Set<string>();
  const db: CleanDatabase = {
    templates: async () => templates.map((row) => ({ ...row })),
    inspections: async (ids) => inspections.filter((row) => ids.includes(row.templateId)).map((row) => ({ ...row })),
    untouched: async () => ({ clients: ["E2E new client (temporary) ab12"], manufacturers: [], accounts: ["e2e-users-x1y2z3@test.local"] }),
    listObjects: async (bucket, folder) => stored.get(`${bucket}:${folder}`) ?? [],
    removeObjects: async (bucket, paths) => {
      if (failing.remove && paths.some((path) => path.startsWith(failing.remove!))) throw new Error("storage unavailable");
      calls.push(`remove ${bucket} ${paths.join(" ")}`);
    },
    deleteInspection: async (id) => {
      if (failing.deleteInspection === id) throw new Error("inspection does not belong to a test account");
      const ref = inspections.find((row) => row.id === id)?.refNo;
      calls.push(`delete inspection ${ref}`);
      if (goneInspections.has(id)) return false;
      goneInspections.add(id);
      return true;
    },
    deleteTemplate: async (id) => {
      const row = templates.find((candidate) => candidate.id === id);
      calls.push(`delete template ${row?.code} v${row?.version}`);
      return true;
    },
  };
  return { db, calls, goneInspections };
}

describe("what goes and what stays", () => {
  it("deletes an old E2E_ template with the test account's inspections, and ignores every other code", () => {
    const fixture = template("E2E_NEW");
    const plan = planCleanup(
      [template("STD_EG"), template("E2EX_OTHER"), fixture],
      [inspection(fixture, "INS-2026-0002"), inspection(fixture, "INS-2026-0001", { status: "approved" })],
      OPTIONS,
    );
    expect(plan.map((entry) => entry.template.code)).toEqual(["E2E_NEW"]);
    expect(plan[0].keep).toBeNull();
    expect(plan[0].inspections.map((entry) => [entry.inspection.refNo, entry.keep])).toEqual([
      ["INS-2026-0001", null],
      ["INS-2026-0002", null],
    ]);
  });

  it("leaves a young template and its inspections alone: a run may be using them", () => {
    const running = template("E2E_CAPTURE", { createdAt: MINUTES_AGO });
    const [entry] = planCleanup([running], [inspection(running, "INS-2026-0003")], OPTIONS);
    expect(entry.keep).toBe("template created 10 minutes ago");
    expect(entry.inspections[0].keep).toBe("template created 10 minutes ago");
    // --min-age 0 takes it too.
    expect(planCleanup([running], [], { ...OPTIONS, minAgeMinutes: 0 })[0].keep).toBeNull();
  });

  it("keeps an inspection that is young or not a test account's, and its template with it", () => {
    const photos = template("E2E_PHOTOS");
    const [entry] = planCleanup(
      [photos],
      [
        inspection(photos, "INS-2026-0004", { createdAt: "2026-10-07T05:59:30Z" }),
        inspection(photos, "INS-2026-0005", { inspector: "kenneth@example.com" }),
        inspection(photos, "INS-2026-0006", { inspector: null }),
        inspection(photos, "INS-2026-0007", { inspector: "E2E-PHOTOS-AB12CD@TEST.LOCAL" }),
      ],
      OPTIONS,
    );
    expect(entry.inspections.map((planned) => [planned.inspection.refNo, planned.keep])).toEqual([
      ["INS-2026-0004", "created just now"],
      ["INS-2026-0005", "not a test account's (kenneth@example.com)"],
      ["INS-2026-0006", "not a test account's (inspector unknown)"],
      ["INS-2026-0007", null],
    ]);
    expect(entry.keep).toBe("3 of its inspections stay");
  });

  it("knows a test account by its address, whatever the case", () => {
    expect(isTestAccount("inspector@test.local")).toBe(true);
    expect(isTestAccount(" Admin@Test.Local ")).toBe(true);
    expect(isTestAccount("someone@test.local.example.com")).toBe(false);
    expect(isTestAccount(null)).toBe(false);
  });

  it("looks only at the codes --only names, which must be E2E_ codes", () => {
    const templates = [template("E2E_NEW"), template("E2E_NEW_CM"), template("E2E_TEMPLATES_AB12CD_ROOT")];
    expect(planCleanup(templates, [], { ...OPTIONS, only: "E2E_NEW" }).map((entry) => entry.template.code)).toEqual([
      "E2E_NEW",
      "E2E_NEW_CM",
    ]);
    expect(() => planCleanup(templates, [], { ...OPTIONS, only: "STD_" })).toThrow(
      '--only takes a code prefix that starts with E2E_, not "STD_".',
    );
    expect(describePlan([], false, "E2E_NEW")).toEqual(["No templates with a code starting E2E_NEW: nothing to clean up."]);
  });

  it("finds a version's source files where the template editor puts them", () => {
    expect(sourceFolder({ code: "E2E_TEMPLATES_AB12CD_ROOT", version: 2 })).toBe("E2E_TEMPLATES_AB12CD_ROOT/v2");
  });
});

describe("cleaning up", () => {
  it("lists without deleting anything", async () => {
    const fixture = template("E2E_NEW");
    const { db, calls } = fakeProject([fixture], [inspection(fixture, "INS-2026-0001")], {
      [`inspection-photos:${fixture.id}`]: ["x/1.jpg"],
    });
    const report = await cleanE2eData(db, { ...OPTIONS, apply: false });
    expect(calls).toEqual([]);
    expect(report.deleted).toEqual({ templates: 0, inspections: 0, objects: 0 });
    expect(describeResult(report, false)).toEqual([
      "Listed only: nothing was deleted. npm run clean:e2e -- --apply deletes 1 inspection and 1 template.",
    ]);
    expect(describeResult(report, false, "--apply --only E2E_NEW")[0]).toContain("npm run clean:e2e -- --apply --only E2E_NEW deletes");
  });

  it("deletes each inspection's Storage objects, then the inspection, then the template's source files and the template", async () => {
    const fixture = template("E2E_PHOTOS", { version: 2 });
    const first = inspection(fixture, "INS-2026-0001", { photos: 1, files: 1 });
    const second = inspection(fixture, "INS-2026-0002");
    const { db, calls } = fakeProject([fixture], [first, second], {
      [`inspection-photos:${first.id}`]: [`${first.id}/a.jpg`, `${first.id}/thumbs/a.jpg`],
      [`inspection-files:${first.id}`]: [`${first.id}/b.pdf`],
      [`template-sources:E2E_PHOTOS/v2`]: ["E2E_PHOTOS/v2/c/form.pdf"],
    });
    const report = await cleanE2eData(db, { ...OPTIONS, apply: true });
    expect(calls).toEqual([
      `remove inspection-photos ${first.id}/a.jpg ${first.id}/thumbs/a.jpg`,
      `remove inspection-files ${first.id}/b.pdf`,
      "delete inspection INS-2026-0001",
      "delete inspection INS-2026-0002",
      "remove template-sources E2E_PHOTOS/v2/c/form.pdf",
      "delete template E2E_PHOTOS v2",
    ]);
    expect(report.deleted).toEqual({ templates: 1, inspections: 2, objects: 4 });
    expect(report.failures).toEqual([]);
    expect(describeResult(report, true)).toEqual(["Deleted 2 inspections, 1 template and 4 Storage objects."]);
  });

  it("keeps a template whose inspection could not go, says why, and carries on with the next", async () => {
    const broken = template("E2E_LIST");
    const fine = template("E2E_NEW");
    const stuck = inspection(broken, "INS-2026-0001");
    const { db, calls } = fakeProject([broken, fine], [stuck, inspection(fine, "INS-2026-0002")], {}, { deleteInspection: stuck.id });
    const report = await cleanE2eData(db, { ...OPTIONS, apply: true });
    expect(calls).toEqual(["delete inspection INS-2026-0002", "delete template E2E_NEW v1"]);
    expect(report.failures).toEqual(["INS-2026-0001 (E2E_LIST v1): inspection does not belong to a test account"]);
    expect(describeResult(report, true)).toEqual([
      "Deleted 1 inspection, 1 template and 0 Storage objects.",
      "Failed (those templates stay):",
      "  INS-2026-0001 (E2E_LIST v1): inspection does not belong to a test account",
    ]);
  });

  it("deletes no inspection whose Storage objects could not be removed", async () => {
    const fixture = template("E2E_PHOTOS");
    const first = inspection(fixture, "INS-2026-0001");
    const { db, calls } = fakeProject([fixture], [first], { [`inspection-photos:${first.id}`]: [`${first.id}/a.jpg`] }, { remove: first.id });
    const report = await cleanE2eData(db, { ...OPTIONS, apply: true });
    expect(calls).toEqual([]);
    expect(report.failures).toEqual(["INS-2026-0001 (E2E_PHOTOS v1): storage unavailable"]);
  });

  it("deletes nothing that stays: young rows and other people's inspections", async () => {
    const young = template("E2E_CAPTURE", { createdAt: MINUTES_AGO });
    const old = template("E2E_REVIEW");
    const { db, calls } = fakeProject(
      [young, old],
      [inspection(young, "INS-2026-0001"), inspection(old, "INS-2026-0002", { inspector: "kenneth@example.com" })],
    );
    const report = await cleanE2eData(db, { ...OPTIONS, apply: true });
    expect(calls).toEqual([]);
    expect(report.deleted).toEqual({ templates: 0, inspections: 0, objects: 0 });
  });

  it("counts an inspection a spec's teardown deleted first as gone", async () => {
    const fixture = template("E2E_NEW");
    const first = inspection(fixture, "INS-2026-0001");
    const project = fakeProject([fixture], [first]);
    project.goneInspections.add(first.id);
    const report = await cleanE2eData(project.db, { ...OPTIONS, apply: true });
    expect(project.calls).toEqual(["delete inspection INS-2026-0001", "delete template E2E_NEW v1"]);
    expect(report.deleted).toEqual({ templates: 1, inspections: 0, objects: 0 });
  });
});

describe("the listing", () => {
  it("names every template and inspection, what goes and why the rest stays", () => {
    const fixture = template("E2E_NEW");
    const running = template("E2E_CAPTURE", { createdAt: MINUTES_AGO, status: "draft" });
    const plan = planCleanup(
      [fixture, running],
      [inspection(fixture, "INS-2026-0001", { photos: 3, files: 1, status: "submitted" }), inspection(running, "INS-2026-0002")],
      OPTIONS,
    );
    expect(describePlan(plan, false).map((line) => line.replace(/ +/g, " "))).toEqual([
      "Templates with an E2E_ code: 2",
      " E2E_CAPTURE v1 draft 1 inspection kept: template created 10 minutes ago",
      " E2E_NEW v1 active 1 inspection to delete",
      "Inspections of those templates: 2",
      " INS-2026-0002 draft E2E_CAPTURE v1 0 photos, 0 files kept: template created 10 minutes ago",
      " INS-2026-0001 submitted E2E_NEW v1 3 photos, 1 file to delete",
    ]);
    expect(describePlan([], false)).toEqual(["No templates with an E2E_ code: nothing to clean up."]);
  });

  it("lists the other leftovers it never deletes", () => {
    expect(describeUntouched(NOTHING_ELSE)).toEqual([]);
    expect(describeUntouched({ clients: ["E2E a", "E2E b"], manufacturers: [], accounts: ["e2e-x@test.local"] })).toEqual([
      "Not touched here, though e2e runs may have left them: delete by hand once nothing uses them.",
      "  clients: E2E a; E2E b",
      "  accounts: e2e-x@test.local",
    ]);
  });

  it("says when there is nothing to delete", async () => {
    const { db } = fakeProject([], []);
    expect(describeResult(await cleanE2eData(db, { ...OPTIONS, apply: false }), false)).toEqual(["Nothing to delete."]);
  });
});
