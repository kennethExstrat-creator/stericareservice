import { describe, expect, it } from "vitest";
import type { AuditEntry } from "./audit";
import { groupHistory } from "./history-groups";

let next = 1;
function entry(title: string, patch: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: next++,
    at: "2026-10-27T03:27:00.000Z",
    kind: "event",
    title,
    actor: { kind: "system" },
    actorId: null,
    reason: null,
    detail: null,
    ...patch,
  };
}

describe("History lines", () => {
  it("folds a run of the same event by the same actor into one line", () => {
    const created = entry("Created", { kind: "created", actor: { kind: "person", name: "Inspector A" } });
    const reads = Array.from({ length: 16 }, () => entry("Source Document Read"));
    const drafted = entry("Summary Drafted");
    const lines = groupHistory([created, ...reads, drafted]);
    expect(lines.map((line) => line.kind)).toEqual(["entry", "run", "entry"]);
    expect(lines[1]).toMatchObject({ kind: "run", title: "Source Document Read", entries: reads });
  });

  it("keeps two alike events, and any event with a reason, on lines of their own", () => {
    const reopened = (reason: string) =>
      entry("Reopened", { kind: "reopened", reason, actor: { kind: "person", name: "Admin A" } });
    const lines = groupHistory([entry("Photo Deleted"), entry("Photo Deleted"), reopened("Retest size M."), reopened("Recount."), reopened("Again.")]);
    expect(lines.map((line) => line.kind)).toEqual(["entry", "entry", "entry", "entry", "entry"]);
  });

  it("does not fold the same event by different actors", () => {
    const by = (name: string) => entry("Photo Deleted", { actor: { kind: "person", name } });
    const lines = groupHistory([by("Inspector A"), by("Admin A"), by("Inspector A")]);
    expect(lines.every((line) => line.kind === "entry")).toBe(true);
  });
});
