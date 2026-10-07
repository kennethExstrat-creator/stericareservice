import { describe, expect, it } from "vitest";
import { actorOf, actorText } from "./actor";
import { buildAuditTrail, humanise, latestReopen, type AuditRow } from "./audit";

const INSPECTOR = "00000000-0000-4000-8000-000000000101";
const ADMIN = "00000000-0000-4000-8000-000000000102";

const asInspector = { viewerId: INSPECTOR, viewerName: "Inspector A", inspectorId: INSPECTOR, inspectorName: "Inspector A" };
const asAdmin = { viewerId: ADMIN, viewerName: "Admin A", inspectorId: INSPECTOR, inspectorName: "Inspector A" };

const adminProfile = { full_name: "Admin A", email: "admin@example.com" };
const inspectorProfile = { full_name: "Inspector A", email: "inspector@example.com" };

let nextId = 1;
function row(action: string, changes: unknown, at: string, actorId: string | null, actor: AuditRow["actor"] = null): AuditRow {
  return { id: nextId++, action, changes, at, actorId, actor };
}

/** A full cycle as the database records it, read by an admin (who can read every profile). */
function cycle(actorProfile: (id: string) => AuditRow["actor"]) {
  nextId = 1;
  return [
    row("created", { ref_no: "INS-2026-0001", status: "draft" }, "2026-10-05T01:00:00+00:00", INSPECTOR, actorProfile(INSPECTOR)),
    row("status_changed", { from: "draft", to: "submitted" }, "2026-10-05T06:30:00+00:00", INSPECTOR, actorProfile(INSPECTOR)),
    row("status_changed", { from: "submitted", to: "reopened" }, "2026-10-06T02:00:00+00:00", ADMIN, actorProfile(ADMIN)),
    row("review.reopened", { reason: "Retest size M." }, "2026-10-06T02:00:00.500+00:00", ADMIN, actorProfile(ADMIN)),
    row("status_changed", { from: "reopened", to: "submitted" }, "2026-10-06T05:00:00+00:00", INSPECTOR, actorProfile(INSPECTOR)),
    row("status_changed", { from: "submitted", to: "approved" }, "2026-10-06T07:00:00+00:00", ADMIN, actorProfile(ADMIN)),
  ];
}

describe("buildAuditTrail", () => {
  it("tells each status change in words, with the reopen's reason folded into it", () => {
    const trail = buildAuditTrail(cycle((id) => (id === ADMIN ? adminProfile : inspectorProfile)), asAdmin);
    expect(trail.map(({ kind, title, actor, reason }) => ({ kind, title, actor: actorText(actor), reason }))).toEqual([
      { kind: "created", title: "Created", actor: "Inspector A", reason: null },
      { kind: "submitted", title: "Submitted", actor: "Inspector A", reason: null },
      { kind: "reopened", title: "Reopened", actor: "Admin A", reason: "Retest size M." },
      { kind: "resubmitted", title: "Submitted Again", actor: "Inspector A", reason: null },
      { kind: "approved", title: "Approved", actor: "Admin A", reason: null },
    ]);
  });

  it("names an admin to an inspector only as an admin, since their profile is hidden", () => {
    // Row level security returns no profile for anyone but the inspector.
    const trail = buildAuditTrail(cycle((id) => (id === INSPECTOR ? inspectorProfile : null)), asInspector);
    expect(trail.map((entry) => actorText(entry.actor))).toEqual([
      "Inspector A",
      "Inspector A",
      "an admin",
      "Inspector A",
      "an admin",
    ]);
    expect(actorText(trail[2].actor, { start: true })).toBe("An admin");
  });

  it("knows the viewer and the inspector by name even without a profile row", () => {
    const trail = buildAuditTrail(cycle(() => null), asAdmin);
    expect(trail.map((entry) => actorText(entry.actor))).toEqual([
      "Inspector A",
      "Inspector A",
      "Admin A",
      "Inspector A",
      "Admin A",
    ]);
  });

  it("calls rows without an actor the system's (service role, database owner)", () => {
    nextId = 1;
    const [entry] = buildAuditTrail([row("created", {}, "2026-10-05T01:00:00Z", null)], asAdmin);
    expect(actorText(entry.actor)).toBe("the system");
    expect(actorText(entry.actor, { start: true })).toBe("The system");
  });

  it("puts rows in time order, then by id", () => {
    nextId = 1;
    const late = row("status_changed", { from: "draft", to: "submitted" }, "2026-10-05T06:30:00Z", INSPECTOR);
    const early = row("created", {}, "2026-10-05T01:00:00Z", INSPECTOR);
    expect(buildAuditTrail([late, early], asAdmin).map((entry) => entry.kind)).toEqual(["created", "submitted"]);
  });

  it("keeps a reason that matches no reopen as its own entry", () => {
    nextId = 1;
    const trail = buildAuditTrail([row("review.reopened", { reason: "Retest." }, "2026-10-06T02:00:00Z", ADMIN, adminProfile)], asAdmin);
    expect(trail).toEqual([expect.objectContaining({ kind: "event", title: "Reason for Reopening", reason: "Retest." })]);
  });

  it("gives each reopen its own reason", () => {
    nextId = 1;
    const trail = buildAuditTrail(
      [
        row("status_changed", { from: "submitted", to: "reopened" }, "2026-10-06T02:00:00Z", ADMIN, adminProfile),
        row("review.reopened", { reason: "First." }, "2026-10-06T02:00:01Z", ADMIN, adminProfile),
        row("status_changed", { from: "reopened", to: "submitted" }, "2026-10-06T03:00:00Z", INSPECTOR),
        row("status_changed", { from: "submitted", to: "reopened" }, "2026-10-06T04:00:00Z", ADMIN, adminProfile),
        row("review.reopened", { reason: "Second." }, "2026-10-06T04:00:01Z", ADMIN, adminProfile),
      ],
      asAdmin,
    );
    expect(trail.filter((entry) => entry.kind === "reopened").map((entry) => entry.reason)).toEqual(["First.", "Second."]);
    expect(latestReopen(trail)?.reason).toBe("Second.");
  });

  it("words other events from their action, with any reason or note", () => {
    nextId = 1;
    const trail = buildAuditTrail(
      [
        row("module_override", { module: "weight", reason: "Scale broken." }, "2026-10-06T01:00:00Z", ADMIN, adminProfile),
        row("ai_review.requested", {}, "2026-10-06T01:01:00Z", ADMIN, adminProfile),
        row("ai_report.sent", { note: "Sent twice." }, "2026-10-06T01:02:00Z", ADMIN, adminProfile),
        row("ai_review.failed", {}, "2026-10-06T01:03:00Z", null),
      ],
      asAdmin,
    );
    expect(trail.map(({ title, detail }) => ({ title, detail }))).toEqual([
      { title: "Module Settings Changed for This Inspection", detail: "Scale broken." },
      { title: "AI Second Opinion Requested", detail: null },
      { title: "Sent to the AI Report", detail: "Sent twice." },
      { title: "AI Review Failed", detail: null },
    ]);
  });

  it("says what changed when a status change is not part of the flow", () => {
    nextId = 1;
    const [entry] = buildAuditTrail([row("status_changed", { from: "approved", to: "nonsense" }, "2026-10-06T01:00:00Z", null)], asAdmin);
    expect(entry).toMatchObject({ kind: "status", title: "Status Changed From Approved to Unknown" });
  });
});

describe("humanise", () => {
  it.each([
    ["ai_review.failed", "AI Review Failed"],
    ["module_override", "Module Override"],
    ["export", "Export"],
    ["", "Event"],
    // Title Case: small words stay small after the first word; each part of a hyphenated word is capitalised.
    ["export.sent_to_the_client", "Export Sent to the Client"],
    ["for_review.follow-up", "For Review Follow-Up"],
  ])("%s reads as %s", (action, words) => {
    expect(humanise(action)).toBe(words);
  });
});

describe("actorOf", () => {
  it("prefers the profile, then a name the viewer knows, then an unnamed admin", () => {
    expect(actorOf(ADMIN, { full_name: "  ", email: "admin@example.com" }, asInspector)).toEqual({
      kind: "person",
      name: "admin@example.com",
    });
    expect(actorOf(INSPECTOR, null, asInspector)).toEqual({ kind: "person", name: "Inspector A" });
    expect(actorOf(ADMIN, null, asInspector)).toEqual({ kind: "admin" });
    expect(actorOf(null, null, asInspector)).toEqual({ kind: "system" });
  });
});
