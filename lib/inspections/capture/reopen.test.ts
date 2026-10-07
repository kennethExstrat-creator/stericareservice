import { describe, expect, it, vi } from "vitest";
import type { AuditRow } from "@/lib/inspections/review/audit";
import { loadReopenNote, reopenNote } from "./reopen";

const INSPECTION = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const INSPECTOR = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ADMIN = "5f6e7d8c-9b0a-4c1d-8e2f-3a4b5c6d7e8f";

const people = { viewerId: INSPECTOR, viewerName: "Inspector A", inspectorId: INSPECTOR, inspectorName: "Inspector A" };
const inspector = { id: INSPECTOR, role: "inspector" as const };

function audit(id: number, action: string, changes: unknown, at: string, actorId: string | null, actor: AuditRow["actor"] = null): AuditRow {
  return { id, action, changes, at, actorId, actor };
}

const ROWS: AuditRow[] = [
  audit(1, "status_changed", { from: "draft", to: "submitted" }, "2026-10-06T02:00:00Z", INSPECTOR),
  audit(2, "status_changed", { from: "submitted", to: "reopened" }, "2026-10-07T01:05:00Z", ADMIN),
  audit(3, "review.reopened", { reason: "Size M weights are missing.\nAdd them." }, "2026-10-07T01:05:01Z", ADMIN),
];

describe("reopenNote", () => {
  it("tells the inspector who reopened it, when, and what to change", () => {
    expect(reopenNote("reopened", ROWS, inspector, people)).toEqual({
      title: "Reopened: Changes Needed",
      // Row level security hides the admin's profile from an inspector.
      body: "An admin reopened it on 7 Oct 2026, 09:05. Make the changes, then submit it again.",
      reason: { label: "What to Change", text: "Size M weights are missing.\nAdd them." },
    });
  });

  it("names the admin where the viewer may read them, and words it for someone else's inspection", () => {
    const named = ROWS.map((row) => (row.actorId === ADMIN ? { ...row, actor: { full_name: "Admin A", email: null } } : row));
    const admin = { viewerId: ADMIN, viewerName: "Admin A", inspectorId: INSPECTOR, inspectorName: "Inspector A" };
    expect(reopenNote("reopened", named, { id: ADMIN, role: "admin" }, admin)).toMatchObject({
      title: "Reopened for Changes",
      body: "Admin A reopened it on 7 Oct 2026, 09:05. Inspector A can change it and submit it again.",
      reason: { label: "Reason", text: "Size M weights are missing.\nAdd them." },
    });
  });

  it("says nothing for any other status, and makes do without a reason", () => {
    expect(reopenNote("draft", ROWS, inspector, people)).toBeNull();
    expect(reopenNote("reopened", ROWS.slice(0, 2), inspector, people)).toMatchObject({ reason: null });
    expect(reopenNote("reopened", [], inspector, people)).toMatchObject({ body: "It was reopened for changes. Make the changes, then submit it again." });
  });
});

describe("loadReopenNote", () => {
  function client(result: { data: unknown; error: unknown }) {
    const calls: Array<[string, unknown[]]> = [];
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push([method, args]);
        return builder;
      };
    }
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return { from: vi.fn(() => builder), calls };
  }

  it("reads the status changes and the reasons of a reopened inspection only", async () => {
    const rows = ROWS.map((row) => ({ id: row.id, action: row.action, changes: row.changes, at: row.at, actor_id: row.actorId, actor: null }));
    const reopened = client({ data: rows, error: null });
    await expect(loadReopenNote(reopened as never, { id: INSPECTION, status: "reopened" }, inspector, people)).resolves.toMatchObject({
      reason: { text: "Size M weights are missing.\nAdd them." },
    });
    expect(reopened.calls).toContainEqual(["in", ["action", ["status_changed", "review.reopened"]]]);

    const draft = client({ data: rows, error: null });
    await expect(loadReopenNote(draft as never, { id: INSPECTION, status: "draft" }, inspector, people)).resolves.toBeNull();
    expect(draft.from).not.toHaveBeenCalled();
  });

  it("leaves the note out when the audit rows cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = client({ data: null, error: { code: "42501", message: "denied" } });
    await expect(loadReopenNote(failing as never, { id: INSPECTION, status: "reopened" }, inspector, people)).resolves.toBeNull();
  });
});
