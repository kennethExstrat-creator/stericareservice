import { describe, expect, it, vi } from "vitest";
import { TEST_ADMIN_ID, testTemplate } from "./__fixtures__/capture";
import { isInspectionId, loadCaptureInspection, loadOverrideAuthors, normaliseData, toCaptureLoad } from "./load";

const ID = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const INSPECTOR = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    ref_no: "INS-2026-0007",
    status: "draft" as const,
    data: { modules: { glove_info: { colour: "Blue" } }, custom: {} },
    module_overrides: {
      weight: { reason: "Not ordered.", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" },
      nonsense: { reason: "x" },
    },
    updated_at: "2026-10-06T09:14:03.123456+00:00",
    inspection_date: "2026-10-06",
    inspector_id: INSPECTOR,
    submitted_at: null,
    result: null,
    template: { id: "t1", code: "TEST_EG", version: 4, resolved: testTemplate() },
    client: { id: "20000000-0000-4000-8000-0000000000c1", name: "Client A" },
    manufacturer: { id: "10000000-0000-4000-8000-0000000000f1", name: "Manufacturer A", factory_name: "Factory 1" },
    inspector: { id: INSPECTOR, full_name: null, email: "inspector@test.local" },
    ...overrides,
  };
}

describe("toCaptureLoad", () => {
  it("reads the row into what the screen needs, the template parsed, valid overrides only", () => {
    const loaded = toCaptureLoad(row());
    expect(loaded.kind).toBe("found");
    if (loaded.kind !== "found") return;
    const { inspection } = loaded;
    expect(inspection).toMatchObject({
      id: ID,
      refNo: "INS-2026-0007",
      status: "draft",
      updatedAt: "2026-10-06T09:14:03.123456+00:00",
      inspectorId: INSPECTOR,
      manufacturerLabel: "Manufacturer A · Factory 1",
      template: { id: "t1", code: "TEST_EG", version: 4 },
    });
    expect(Object.keys(inspection.overrides)).toEqual(["weight"]);
    expect(inspection.meta).toEqual({
      refNo: "INS-2026-0007",
      inspectionDate: "2026-10-06",
      // No name on the profile: the email.
      inspector: { id: INSPECTOR, name: "inspector@test.local" },
      client: { id: "20000000-0000-4000-8000-0000000000c1", name: "Client A" },
      manufacturer: { id: "10000000-0000-4000-8000-0000000000f1", name: "Manufacturer A" },
    });
  });

  it("still records the inspector when their profile cannot be read", () => {
    const loaded = toCaptureLoad(row({ inspector: null, client: null, manufacturer: null }));
    expect(loaded.kind === "found" && loaded.inspection.meta).toMatchObject({
      inspector: { id: INSPECTOR, name: "Inspector" },
      client: null,
      manufacturer: null,
    });
  });

  it("says when the template version cannot be read, rather than guessing", () => {
    expect(toCaptureLoad(row({ template: { id: "t1", code: "X", version: 1, resolved: { modules: [] } } }))).toMatchObject({
      kind: "template_unreadable",
      refNo: "INS-2026-0007",
    });
    expect(toCaptureLoad(row({ template: null }))).toMatchObject({ kind: "template_unreadable", problem: expect.any(String) });
  });
});

describe("normaliseData", () => {
  it("keeps modules and custom modules, and reads anything malformed as empty", () => {
    expect(normaliseData({ modules: { a: {} }, custom: { b: {} } })).toEqual({ modules: { a: {} }, custom: { b: {} } });
    expect(normaliseData({ modules: [] })).toEqual({ modules: {}, custom: {} });
    expect(normaliseData(null)).toEqual({ modules: {}, custom: {} });
  });
});

describe("loading", () => {
  it("treats anything but a uuid as not found without asking the database", async () => {
    const from = vi.fn();
    expect(isInspectionId("INS-2026-0007")).toBe(false);
    await expect(loadCaptureInspection({ from } as never, "INS-2026-0007")).resolves.toEqual({ kind: "not_found" });
    expect(from).not.toHaveBeenCalled();
  });

  it("is not found when RLS returns no row, and throws on a database error", async () => {
    const client = (result: unknown) =>
      ({
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(result) }) }) }),
      }) as never;
    await expect(loadCaptureInspection(client({ data: null, error: null }), ID)).resolves.toEqual({ kind: "not_found" });
    await expect(loadCaptureInspection(client({ data: null, error: { message: "boom" } }), ID)).rejects.toThrow(/boom/);
    await expect(loadCaptureInspection(client({ data: row(), error: null }), ID)).resolves.toMatchObject({ kind: "found" });
  });

  it("names the admins who switched modules off, where the user may read them", async () => {
    const inProfiles = vi.fn(() =>
      Promise.resolve({ data: [{ id: TEST_ADMIN_ID, full_name: "Admin A", email: "admin@test.local" }], error: null }),
    );
    const client = { from: () => ({ select: () => ({ in: inProfiles }) }) } as never;
    const overrides = { weight: { reason: "n/a", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" } };
    await expect(loadOverrideAuthors(client, overrides)).resolves.toEqual({ [TEST_ADMIN_ID]: "Admin A" });
    await expect(loadOverrideAuthors(client, {})).resolves.toEqual({});
    expect(inProfiles).toHaveBeenCalledTimes(1);
  });
});
