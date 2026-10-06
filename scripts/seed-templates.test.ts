// scripts/seed-templates.mts with --drafts: the seed templates written as
// drafts for an admin to check and activate (BUILD_SPEC 4.2 rule 10, 4.5),
// against an in-memory templates table that keeps the database's rules (one
// active version per code, (code, version) unique). The rest of the script is
// tested in lib/templates/definitions/seed-script.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  describeOutcome,
  parseBundle,
  planTemplate,
  plannedStatus,
  prepare,
  seedTemplates,
  type Bundle,
  type SeedDatabase,
  type SeedOptions,
  type TemplateStatus,
  type VersionRow,
} from "./seed-templates.mjs";

const BUNDLE_TEXT = readFileSync(new URL("../lib/templates/definitions/seed-bundle.json", import.meta.url), "utf8");
const POLYCO = "20000000-0000-4000-8000-000000000001";

const bundle = (): Bundle => parseBundle(BUNDLE_TEXT);

type Row = VersionRow & { code: string; client_id: string | null };

function fakeDatabase() {
  let nextId = 1;
  const rows: Row[] = [];
  const writes: string[] = [];
  const db: SeedDatabase = {
    clients: async () => [{ id: POLYCO, name: "Polyco Healthline" }],
    versions: async (code) => rows.filter((row) => row.code === code).map((row) => structuredClone(row)),
    insert: async (row) => {
      if (rows.some((other) => other.code === row.code && other.version === row.version)) throw new Error("23505 duplicate");
      if (row.status === "active" && rows.some((other) => other.code === row.code && other.status === "active")) {
        throw new Error("23505 one active version");
      }
      const id = `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
      rows.push({ ...structuredClone(row), id });
      writes.push(`insert ${row.code} v${row.version} ${row.status}`);
      return id;
    },
    setStatus: async (id, status: TemplateStatus) => {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) throw new Error("no such template");
      if (status === "active" && rows.some((other) => other.code === row.code && other.status === "active" && other.id !== id)) {
        throw new Error("23505 one active version");
      }
      row.status = status;
      writes.push(`${status} ${row.code} v${row.version}`);
    },
  };
  return { db, rows, writes };
}

const RUN: SeedOptions = { dryRun: false, refresh: false, replace: false };
const DRAFTS: SeedOptions = { ...RUN, drafts: true };

const statuses = (rows: readonly Row[]) => rows.map((row) => `${row.code} v${row.version} ${row.status}`).sort();

/** The bundle with STD_EG renamed: a changed definition. */
function renamed(): Bundle {
  const changed = bundle();
  changed.templates[0].definition.name = "Standard examination gloves (EN 455), revised";
  return changed;
}

describe("seeding drafts (--drafts)", () => {
  it("adds every template as a draft, SAFEDON_EG for its client and resolved against the STD_EG draft", async () => {
    const { db, rows, writes } = fakeDatabase();
    const report = await seedTemplates(db, bundle(), DRAFTS);
    expect(report.written).toBe(true);
    expect(writes).toEqual(["insert STD_EG v1 draft", "insert SAFEDON_EG v1 draft", "insert STD_SG v1 draft"]);
    expect(statuses(rows)).toEqual(["SAFEDON_EG v1 draft", "STD_EG v1 draft", "STD_SG v1 draft"]);
    const safedon = rows.find((row) => row.code === "SAFEDON_EG");
    expect(safedon?.client_id).toBe(POLYCO);
    expect((safedon?.resolved as { bases: unknown }).bases).toEqual([{ code: "STD_EG", version: 1 }]);
    expect(report.outcomes.map((outcome) => describeOutcome(outcome, false))).toEqual([
      "STD_EG       version 1  added, draft",
      "SAFEDON_EG   version 1  added, draft · client Polyco Healthline",
      "STD_SG       version 1  added, draft",
    ]);
  });

  it("says what a dry run would add, and writes nothing", async () => {
    const { db, writes } = fakeDatabase();
    const report = await seedTemplates(db, bundle(), { ...DRAFTS, dryRun: true });
    expect(report.written).toBe(false);
    expect(writes).toEqual([]);
    expect(report.outcomes.map((outcome) => describeOutcome(outcome, true))).toEqual([
      "STD_EG       version 1  to add, draft",
      "SAFEDON_EG   version 1  to add, draft · client Polyco Healthline",
      "STD_SG       version 1  to add, draft",
    ]);
  });

  it("is idempotent: the drafts are kept, so a second run writes nothing", async () => {
    const { db, writes } = fakeDatabase();
    await seedTemplates(db, bundle(), DRAFTS);
    writes.length = 0;
    const report = await seedTemplates(db, bundle(), DRAFTS);
    expect(writes).toEqual([]);
    expect(report.outcomes.map((outcome) => describeOutcome(outcome, false))).toEqual([
      "STD_EG       version 1  unchanged, draft",
      "SAFEDON_EG   version 1  unchanged, draft · client Polyco Healthline",
      "STD_SG       version 1  unchanged, draft",
    ]);
  });

  it("keeps a version an admin has activated since, and never activates or retires anything", async () => {
    const { db, rows, writes } = fakeDatabase();
    await seedTemplates(db, bundle(), DRAFTS);
    // The admin checked STD_EG and activated it.
    rows.find((row) => row.code === "STD_EG")!.status = "active";
    writes.length = 0;
    const same = await seedTemplates(db, bundle(), DRAFTS);
    expect(writes).toEqual([]);
    expect(describeOutcome(same.outcomes[0], false)).toBe("STD_EG       version 1  unchanged, active");

    // A changed definition becomes a new draft next to the active version, which stays.
    const changed = await seedTemplates(db, renamed(), DRAFTS);
    expect(changed.outcomes.map((outcome) => outcome.blocked)).toEqual([false, false, false]);
    expect(writes).toEqual(["insert STD_EG v2 draft", "insert SAFEDON_EG v2 draft"]);
    expect(statuses(rows)).toEqual([
      "SAFEDON_EG v1 draft",
      "SAFEDON_EG v2 draft",
      "STD_EG v1 active",
      "STD_EG v2 draft",
      "STD_SG v1 draft",
    ]);
    // The new SAFEDON_EG draft is resolved against the new STD_EG draft.
    const safedon = rows.find((row) => row.code === "SAFEDON_EG" && row.version === 2);
    expect((safedon?.resolved as { bases: unknown }).bases).toEqual([{ code: "STD_EG", version: 2 }]);
  });

  it("does not go with --replace", async () => {
    const { db, writes } = fakeDatabase();
    await expect(seedTemplates(db, bundle(), { ...DRAFTS, replace: true })).rejects.toThrow(
      "Use --drafts or --replace, not both: drafts never retire an active version.",
    );
    expect(writes).toEqual([]);
  });
});

describe("planning one template as a draft", () => {
  const wanted = prepare(bundle().templates[0], null, new Map());
  const row = (version: number, status: TemplateStatus, change: Partial<VersionRow> = {}): VersionRow => ({
    id: `id-${version}`,
    version,
    status,
    definition: wanted.definition as VersionRow["definition"],
    resolved: wanted.resolved as VersionRow["resolved"],
    ...change,
  });
  const changed = { ...wanted.definition, name: "Renamed" } as VersionRow["definition"];
  const options = { refresh: false, drafts: true };

  it("keeps the active version or the newest draft that has the definition", () => {
    expect(planTemplate(wanted, [row(1, "active")], options)).toEqual({ action: "keep", code: "STD_EG", version: 1, id: "id-1" });
    expect(planTemplate(wanted, [row(1, "active", { definition: changed }), row(2, "draft"), row(3, "draft")], options)).toEqual({
      action: "keep",
      code: "STD_EG",
      version: 3,
      id: "id-3",
    });
  });

  it("adds the next version as a draft, retiring nothing, and never brings a retired one back", () => {
    expect(planTemplate(wanted, [row(1, "active", { definition: changed })], options)).toEqual({
      action: "insert",
      code: "STD_EG",
      version: 2,
      retire: null,
    });
    expect(planTemplate(wanted, [row(1, "retired")], options)).toEqual({ action: "insert", code: "STD_EG", version: 2, retire: null });
  });

  it("knows the status each plan leaves", () => {
    const rows = [row(1, "active", { definition: changed }), row(2, "draft")];
    expect(plannedStatus(planTemplate(wanted, rows, options), rows, options)).toBe("draft");
    expect(plannedStatus(planTemplate(wanted, [row(1, "active")], options), [row(1, "active")], options)).toBe("active");
    expect(plannedStatus(planTemplate(wanted, [], options), [], options)).toBe("draft");
    expect(plannedStatus(planTemplate(wanted, [], { refresh: false }), [], {})).toBe("active");
  });
});
