import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The loader evaluates with the app's registry; these tests use the
// framework's test registry, whose modules pass, fail and warn.
vi.mock("@/modules/registry", async () => {
  const { TEST_REGISTRY } = await import("@/modules/_framework/__fixtures__/test-registry");
  return { MODULE_REGISTRY: TEST_REGISTRY, getModuleDefinition: (key: keyof typeof TEST_REGISTRY) => TEST_REGISTRY[key] };
});

import { ADMIN_ID, INSPECTION_ID, INSPECTOR_ID, reviewTemplate, savedData, VERSION } from "./__fixtures__/review";
import { loadReview, PHOTO_URL_SECONDS, type ReviewViewer } from "./load";

type Result = { data?: unknown; error?: unknown; count?: number | null };
type Query = { table: string; calls: Array<[string, unknown[]]> };
type Responder = (query: Query) => Result;

const OTHER_ADMIN = "00000000-0000-4000-8000-000000000103";
const PHOTO_ID = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";
const FLAGGED_ID = "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e";

const admin: ReviewViewer = { id: ADMIN_ID, name: "Admin A", role: "admin" };
const inspector: ReviewViewer = { id: INSPECTOR_ID, name: "Inspector A", role: "inspector" };

function inspectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INSPECTION_ID,
    ref_no: "INS-2026-0001",
    status: "approved",
    inspection_date: "2026-10-05",
    po_no: null,
    product_name: "Product A",
    lot_numbers: ["LOT-M-0001"],
    data: savedData(),
    module_overrides: { weight: { reason: "Scale broken.", by: OTHER_ADMIN, at: "2026-10-05T03:00:00.000Z" } },
    result: "fail",
    remarks: "  Critical defect in size L.  ",
    suggested_result: "fail",
    created_at: "2026-10-05T01:00:00.000000+00:00",
    updated_at: VERSION,
    submitted_at: "2026-10-05T06:30:00.000000+00:00",
    approved_at: "2026-10-06T07:00:00.000000+00:00",
    approved_by: OTHER_ADMIN,
    inspector_id: INSPECTOR_ID,
    client: { id: "20000000-0000-4000-8000-0000000000c1", name: "Client A" },
    manufacturer: { id: "10000000-0000-4000-8000-0000000000f1", name: "Manufacturer A", factory_name: "Plant 1" },
    inspector: { id: INSPECTOR_ID, full_name: "Inspector A", email: "inspector@example.com" },
    approver: { id: OTHER_ADMIN, full_name: "Admin B", email: "admin-b@example.com" },
    template: { id: "40000000-0000-4000-8000-000000000001", code: "TEST_EG", version: 3, resolved: reviewTemplate() },
    ...overrides,
  };
}

const photoRows = [
  {
    id: PHOTO_ID,
    module_key: "visual",
    target: "size:L/defect:embedded_insect",
    caption: "Insect in the cuff",
    storage_path: `${INSPECTION_ID}/${PHOTO_ID}.jpg`,
    thumb_path: `${INSPECTION_ID}/thumbs/${PHOTO_ID}.jpg`,
    taken_at: "2026-10-05T02:10:00Z",
    flagged: false,
  },
  {
    id: FLAGGED_ID,
    module_key: "header",
    target: null,
    caption: null,
    storage_path: `${INSPECTION_ID}/${FLAGGED_ID}.heic`,
    thumb_path: null,
    taken_at: null,
    flagged: true,
  },
];

const auditRows = [
  { id: 1, action: "created", changes: {}, at: "2026-10-05T01:00:00+00:00", actor_id: INSPECTOR_ID, actor: { full_name: "Inspector A", email: null } },
  {
    id: 2,
    action: "status_changed",
    changes: { from: "submitted", to: "approved" },
    at: "2026-10-06T07:00:00+00:00",
    actor_id: OTHER_ADMIN,
    actor: { full_name: "Admin B", email: null },
  },
];

function fakeClient(respond: Responder) {
  const queries: Query[] = [];
  const from = vi.fn((table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order"]) {
      builder[method] = (...args: unknown[]) => {
        query.calls.push([method, args]);
        return builder;
      };
    }
    const answer = () => ({ data: null, error: null, count: null, ...respond(query) });
    builder.maybeSingle = () => Promise.resolve(answer());
    builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(answer()).then(resolve, reject);
    return builder;
  });
  const createSignedUrls = vi.fn((paths: string[]) =>
    Promise.resolve({
      data: paths.map((path) => ({ path, error: null, signedURL: null, signedUrl: `https://storage.example.com/sign/${path}?token=t` })),
      error: null,
    }),
  );
  const storage = { from: vi.fn(() => ({ createSignedUrls })) };
  return { client: { from, storage } as never, queries, createSignedUrls };
}

const isHead = (query: Query) => query.calls.some(([name, args]) => name === "select" && (args[1] as { head?: boolean })?.head);

/** Answers each table as the live database would, with overrides per table. */
function database(overrides: Partial<Record<string, Result | ((query: Query) => Result)>> = {}): Responder {
  return (query) => {
    const override = overrides[query.table];
    if (override) return typeof override === "function" ? override(query) : override;
    switch (query.table) {
      case "inspections":
        return { data: inspectionRow() };
      case "inspection_photos":
        return isHead(query) ? { count: 5 } : { data: photoRows };
      case "audit_log":
        return { data: auditRows };
      case "profiles":
        return { data: [{ id: OTHER_ADMIN, full_name: "Admin B", email: "admin-b@example.com" }] };
      case "defect_codes":
        return { data: [{ code: "embedded_insect", name: "Embedded insect" }] };
      default:
        return {};
    }
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadReview", () => {
  it("reads one inspection by id, as the signed-in user", async () => {
    const { client, queries } = fakeClient(database());
    await loadReview(client, INSPECTION_ID, admin);
    const inspection = queries.find((query) => query.table === "inspections");
    expect(inspection?.calls).toContainEqual(["eq", ["id", INSPECTION_ID]]);
  });

  it("reads as not found when row level security or a deletion leaves nothing", async () => {
    const { client } = fakeClient(database({ inspections: { data: null } }));
    expect(await loadReview(client, INSPECTION_ID, inspector)).toEqual({ kind: "not_found" });
  });

  it("fails loudly when the inspection itself cannot be read", async () => {
    const { client } = fakeClient(database({ inspections: { error: { code: "XX000", message: "down" } } }));
    await expect(loadReview(client, INSPECTION_ID, admin)).rejects.toThrow("The inspection could not be loaded.");
  });

  it("shapes the facts the page shows", async () => {
    const { client } = fakeClient(database());
    const loaded = await loadReview(client, INSPECTION_ID, admin);
    if (loaded.kind !== "ok") throw new Error("expected a review");
    expect(loaded.review.inspection).toMatchObject({
      refNo: "INS-2026-0001",
      status: "approved",
      version: VERSION,
      // The row has no PO yet: the header module's value stands in.
      poNo: "PO-0001",
      manufacturer: "Manufacturer A · Plant 1",
      inspector: { id: INSPECTOR_ID, name: "Inspector A" },
      approver: { kind: "person", name: "Admin B" },
      remarks: "Critical defect in size L.",
    });
    expect(loaded.review.template).toEqual({
      id: "40000000-0000-4000-8000-000000000001",
      code: "TEST_EG",
      version: 3,
      name: "Test examination gloves",
    });
    expect(loaded.review.evaluation.ok).toBe(true);
  });

  it("signs report photos for an hour, and names defects the module does not label", async () => {
    const { client, createSignedUrls } = fakeClient(database());
    const loaded = await loadReview(client, INSPECTION_ID, admin);
    if (loaded.kind !== "ok") throw new Error("expected a review");

    expect(createSignedUrls).toHaveBeenCalledWith(
      [photoRows[0].storage_path, photoRows[0].thumb_path, photoRows[1].storage_path],
      PHOTO_URL_SECONDS,
    );
    expect(loaded.review.photos.total).toBe(5);
    expect(loaded.review.photos.failed).toBe(false);
    const [insect, flagged] = loaded.review.photos.items;
    expect(insect).toMatchObject({
      thumbUrl: `https://storage.example.com/sign/${photoRows[0].thumb_path}?token=t`,
      fullUrl: `https://storage.example.com/sign/${photoRows[0].storage_path}?token=t`,
      tags: { module: "Visual Inspection (AQL)", size: "L", defect: "Embedded insect" },
      caption: "Insect in the cuff",
    });
    // An unconverted original gets its link, but no preview a browser may not show.
    expect(flagged).toMatchObject({ thumbUrl: null, flagged: true, fullUrl: expect.stringContaining(".heic") });
  });

  it("shows an admin who switched a module off and who approved", async () => {
    const { client, queries } = fakeClient(database());
    const loaded = await loadReview(client, INSPECTION_ID, admin);
    if (loaded.kind !== "ok") throw new Error("expected a review");
    expect(loaded.review.overrides).toEqual([
      { key: "weight", title: "Weight (g)", reason: "Scale broken.", at: "2026-10-05T03:00:00.000Z", by: { kind: "person", name: "Admin B" } },
    ]);
    expect(queries.find((query) => query.table === "profiles")?.calls).toContainEqual(["in", ["id", [OTHER_ADMIN]]]);
  });

  it("names nobody else to an inspector, whose reads row level security limits to their own profile", async () => {
    const { client, queries } = fakeClient(
      database({
        inspections: { data: inspectionRow({ approver: null }) },
        audit_log: { data: auditRows.map((row) => (row.actor_id === OTHER_ADMIN ? { ...row, actor: null } : row)) },
      }),
    );
    const loaded = await loadReview(client, INSPECTION_ID, inspector);
    if (loaded.kind !== "ok") throw new Error("expected a review");
    expect(loaded.review.inspection.approver).toEqual({ kind: "admin" });
    expect(loaded.review.overrides[0].by).toEqual({ kind: "admin" });
    expect(loaded.review.history.entries.map((entry) => entry.actor)).toEqual([
      { kind: "person", name: "Inspector A" },
      { kind: "admin" },
    ]);
    expect(queries.some((query) => query.table === "profiles")).toBe(false);
  });

  it("still shows the review when photos or history cannot be read", async () => {
    const { client } = fakeClient(
      database({
        inspection_photos: (query) =>
          isHead(query) ? { error: { message: "count failed" } } : { error: { message: "photos failed" } },
        audit_log: { error: { message: "history failed" } },
      }),
    );
    const loaded = await loadReview(client, INSPECTION_ID, admin);
    if (loaded.kind !== "ok") throw new Error("expected a review");
    expect(loaded.review.photos).toEqual({ items: [], total: null, failed: true });
    expect(loaded.review.history).toEqual({ entries: [], failed: true });
  });

  it("does not sign anything when no photo is marked for the report", async () => {
    const { client, createSignedUrls } = fakeClient(
      database({ inspection_photos: (query) => (isHead(query) ? { count: 2 } : { data: [] }) }),
    );
    const loaded = await loadReview(client, INSPECTION_ID, admin);
    if (loaded.kind !== "ok") throw new Error("expected a review");
    expect(loaded.review.photos).toEqual({ items: [], total: 2, failed: false });
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("keeps the facts when the template version cannot be read", async () => {
    const { client } = fakeClient(
      database({ inspections: { data: inspectionRow({ template: { id: "t", code: "OLD", version: 1, resolved: null } }) } }),
    );
    const loaded = await loadReview(client, INSPECTION_ID, admin);
    if (loaded.kind !== "ok") throw new Error("expected a review");
    expect(loaded.review.evaluation).toMatchObject({ ok: false, problem: "template" });
    expect(loaded.review.template).toEqual({ id: "t", code: "OLD", version: 1, name: null });
    expect(loaded.review.overrides).toEqual([]);
    expect(loaded.review.inspection.poNo).toBeNull();
  });
});
