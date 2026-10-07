import { describe, expect, it } from "vitest";
import type { AuditEntry } from "./audit";
import { statusNotice, type NoticeInspection } from "./notice";

const INSPECTOR = "00000000-0000-4000-8000-000000000101";
const ADMIN = "00000000-0000-4000-8000-000000000102";
const admin = { id: ADMIN, role: "admin" } as const;
const inspector = { id: INSPECTOR, role: "inspector" } as const;

function inspection(overrides: Partial<NoticeInspection> = {}): NoticeInspection {
  return {
    status: "submitted",
    inspector: { id: INSPECTOR, name: "Inspector A" },
    submittedAt: "2026-10-05T06:30:00+00:00",
    approvedAt: null,
    approver: null,
    ...overrides,
  };
}

function reopen(actor: AuditEntry["actor"], reason: string | null): AuditEntry {
  return { id: 3, at: "2026-10-06T02:00:00+00:00", kind: "reopened", title: "Reopened", actor, actorId: ADMIN, reason, detail: null };
}

describe("statusNotice", () => {
  it("asks an admin to review a submitted inspection", () => {
    expect(statusNotice(inspection(), admin, [])).toEqual({
      status: "submitted",
      title: "Waiting for Your Review",
      body: "Inspector A submitted it on 5 Oct 2026, 14:30. Check the results, then approve it or reopen it for changes.",
      reason: null,
    });
  });

  it("tells the inspector who submitted it what happens next", () => {
    expect(statusNotice(inspection(), inspector, [])).toMatchObject({
      title: "Waiting for Review",
      body: "You submitted it on 5 Oct 2026, 14:30. An admin checks it next. If something must change, ask an admin to reopen it.",
    });
  });

  // Lead inspectors read their team's inspections (migration 20261007170000), read-only.
  it("tells a lead inspector whose submitted inspection it is, and that an admin decides", () => {
    const lead = { id: "00000000-0000-4000-8000-000000000103", role: "inspector" } as const;
    expect(statusNotice(inspection(), lead, [])).toEqual({
      status: "submitted",
      title: "Waiting for Review",
      body: "Inspector A submitted it on 5 Oct 2026, 14:30. An admin checks it next, and only an admin can reopen it for changes.",
      reason: null,
    });
    expect(statusNotice(inspection({ status: "draft" }), lead, []).body).toBe(
      "Inspector A has not submitted it yet. The results below show what is saved so far.",
    );
    expect(statusNotice(inspection({ status: "reopened" }), lead, [reopen({ kind: "admin" }, "Retest size M.")])).toMatchObject({
      title: "Reopened for Changes",
      body: "An admin reopened it on 6 Oct 2026, 10:00. Inspector A can change it and submit it again.",
      reason: { label: "Reason", text: "Retest size M." },
    });
  });

  it("gives an admin's own submitted inspection to them to review", () => {
    const own = inspection({ inspector: { id: ADMIN, name: "Admin A" } });
    expect(statusNotice(own, admin, []).body).toMatch(/^You submitted it on .* Check the results/);
  });

  it("shows the inspector what to change after a reopen, naming no admin", () => {
    const notice = statusNotice(inspection({ status: "reopened" }), inspector, [reopen({ kind: "admin" }, "Retest size M.")]);
    expect(notice).toEqual({
      status: "reopened",
      title: "Reopened: Changes Needed",
      body: "An admin reopened it on 6 Oct 2026, 10:00. Make the changes, then submit it again.",
      reason: { label: "What to Change", text: "Retest size M." },
    });
  });

  it("tells an admin who reopened it and why", () => {
    const notice = statusNotice(inspection({ status: "reopened" }), admin, [
      reopen({ kind: "person", name: "Admin A" }, "Retest size M."),
    ]);
    expect(notice).toMatchObject({
      title: "Reopened for Changes",
      body: "Admin A reopened it on 6 Oct 2026, 10:00. Inspector A can change it and submit it again.",
      reason: { label: "Reason", text: "Retest size M." },
    });
  });

  it("still explains a reopen when the history is not available", () => {
    expect(statusNotice(inspection({ status: "reopened" }), inspector, [])).toMatchObject({
      body: "It was reopened for changes. Make the changes, then submit it again.",
      reason: null,
    });
  });

  it("says an approved inspection is final, with the approver as the viewer may know them", () => {
    const approved = inspection({ status: "approved", approvedAt: "2026-10-06T07:00:00+00:00" });
    expect(statusNotice({ ...approved, approver: { kind: "person", name: "Admin A" } }, admin, []).body).toBe(
      "Admin A approved it on 6 Oct 2026, 15:00. It is final and can no longer be changed.",
    );
    expect(statusNotice({ ...approved, approver: { kind: "admin" } }, inspector, []).body).toBe(
      "An admin approved it on 6 Oct 2026, 15:00. It is final and can no longer be changed.",
    );
  });

  it("explains a draft to its inspector and to an admin", () => {
    const draft = inspection({ status: "draft", submittedAt: null });
    expect(statusNotice(draft, inspector, []).title).toBe("Not Submitted Yet");
    expect(statusNotice(draft, inspector, []).body).toBe(
      "The results below show what you have saved so far. Submit it from the inspection once it is complete.",
    );
    expect(statusNotice(draft, admin, []).body).toBe(
      "Inspector A has not submitted it yet. The results below show what is saved so far.",
    );
  });
});
