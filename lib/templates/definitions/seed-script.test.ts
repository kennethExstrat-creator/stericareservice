// scripts/seed-templates.mts against an in-memory templates table that keeps
// the database's rules: one active version per code, (code, version) unique.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  describeOutcome,
  jsonEqual,
  parseBundle,
  planTemplate,
  prepare,
  rowFields,
  seedTemplates,
  type Bundle,
  type SeedDatabase,
  type TemplateStatus,
  type VersionRow,
  type Wanted,
} from "@/scripts/seed-templates.mjs";

const BUNDLE_TEXT = readFileSync(new URL("./seed-bundle.json", import.meta.url), "utf8");
const POLYCO = "20000000-0000-4000-8000-000000000001";

function bundle(): Bundle {
  return parseBundle(BUNDLE_TEXT);
}

type Row = VersionRow & { code: string; client_id: string | null; extends_code: string | null };

/** Ids stay unique across fake tables, so rows copied from one into another never clash. */
let nextId = 1;

/** The templates table as the seed sees it, with the constraints that matter here. */
function fakeDatabase(options: { clients?: { id: string; name: string }[]; refuseActive?: string } = {}) {
  const rows: Row[] = [];
  const writes: string[] = [];
  const db: SeedDatabase = {
    clients: async () => options.clients ?? [{ id: POLYCO, name: "Polyco Healthline" }],
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
      if (status === "active" && options.refuseActive === `${row.code} v${row.version}`) throw new Error("activation refused");
      if (status === "active" && rows.some((other) => other.code === row.code && other.status === "active" && other.id !== id)) {
        throw new Error("23505 one active version");
      }
      row.status = status;
      writes.push(`${status} ${row.code} v${row.version}`);
    },
  };
  return { db, rows, writes };
}

const active = (rows: readonly Row[]) =>
  rows.filter((row) => row.status === "active").map((row) => `${row.code} v${row.version}`).sort();

describe("the bundle", () => {
  it("reads seed-bundle.json", () => {
    expect(bundle().templates.map((entry) => [entry.code, entry.client])).toEqual([
      ["STD_EG", null],
      ["SAFEDON_EG", "Polyco Healthline"],
      ["STD_SG", null],
    ]);
  });

  it("refuses a bundle it cannot trust", () => {
    const parsed = JSON.parse(BUNDLE_TEXT);
    expect(() => parseBundle(JSON.stringify({ ...parsed, format: 2 }))).toThrow(/unknown format.*UPDATE_TEMPLATE_SEEDS/);
    expect(() => parseBundle(JSON.stringify({ ...parsed, templates: [...parsed.templates].reverse() }))).toThrow(
      /SAFEDON_EG comes before its base STD_EG/,
    );
    const broken = structuredClone(parsed);
    broken.templates[0].definition.code = "OTHER";
    expect(() => parseBundle(JSON.stringify(broken))).toThrow(/STD_EG: bad definition/);
  });
});

describe("preparing a template", () => {
  it("puts the client's id in a client-scoped template and each base at its version now", () => {
    const safedon = bundle().templates[1];
    const wanted = prepare(safedon, POLYCO, new Map([["STD_EG", 4]]));
    expect(wanted.definition.scope).toEqual({ productType: "examination", standard: "ASTM_D6319", clientId: POLYCO });
    expect(wanted.resolved.scope).toEqual(wanted.definition.scope);
    expect(wanted.resolved.bases).toEqual([{ code: "STD_EG", version: 4 }]);
    expect(rowFields(wanted)).toMatchObject({
      code: "SAFEDON_EG",
      extends_code: "STD_EG",
      product_type: "examination",
      standard: "ASTM_D6319",
      client_id: POLYCO,
      manufacturer_id: null,
      source_file_path: null,
    });
    // The bundle itself is left as it was.
    expect(safedon.definition.scope.clientId).toBeUndefined();
  });

  it("needs every base seeded first", () => {
    expect(() => prepare(bundle().templates[1], POLYCO, new Map())).toThrow(/extends STD_EG, which is not seeded before it/);
  });
});

describe("planning one template", () => {
  const wanted: Wanted = prepare(bundle().templates[0], null, new Map());
  const row = (version: number, status: TemplateStatus, change?: Partial<VersionRow>): VersionRow => ({
    id: `id-${version}`,
    version,
    status,
    definition: wanted.definition as VersionRow["definition"],
    resolved: wanted.resolved as VersionRow["resolved"],
    ...change,
  });
  const changed = { ...wanted.definition, name: "Renamed" } as VersionRow["definition"];
  const options = { refresh: false };

  it("adds version 1, active, to an empty table", () => {
    expect(planTemplate(wanted, [], options)).toEqual({ action: "insert", code: "STD_EG", version: 1, retire: null });
  });

  it("writes nothing when the active version has the same definition", () => {
    expect(planTemplate(wanted, [row(1, "retired"), row(2, "active")], options)).toEqual({
      action: "keep",
      code: "STD_EG",
      version: 2,
      id: "id-2",
    });
  });

  it("adds the next version and retires the active one when the definition changed", () => {
    expect(planTemplate(wanted, [row(1, "active", { definition: changed }), row(2, "draft", { definition: changed })], options)).toEqual({
      action: "insert",
      code: "STD_EG",
      version: 3,
      retire: { id: "id-1", version: 1 },
    });
  });

  it("activates a draft that already has the definition", () => {
    expect(planTemplate(wanted, [row(1, "active", { definition: changed }), row(2, "draft")], options)).toEqual({
      action: "activate",
      code: "STD_EG",
      version: 2,
      id: "id-2",
      retire: { id: "id-1", version: 1 },
    });
  });

  it("does not bring a retired version back: it adds a new one", () => {
    expect(planTemplate(wanted, [row(1, "retired")], options)).toMatchObject({ action: "insert", version: 2, retire: null });
  });

  it("treats a version without a resolution as different", () => {
    expect(planTemplate(wanted, [row(1, "active", { resolved: null })], options)).toMatchObject({ action: "insert", version: 2 });
  });

  it("compares the base versions of a child, and the whole resolution only with --refresh", () => {
    const child = prepare(bundle().templates[1], POLYCO, new Map([["STD_EG", 2]]));
    const stored = (bases: unknown, extra: Record<string, unknown> = {}): VersionRow => ({
      id: "id-1",
      version: 1,
      status: "active",
      definition: child.definition as VersionRow["definition"],
      resolved: { ...child.resolved, bases, ...extra } as VersionRow["resolved"],
    });
    expect(planTemplate(child, [stored([{ code: "STD_EG", version: 2 }])], options).action).toBe("keep");
    expect(planTemplate(child, [stored([{ code: "STD_EG", version: 1 }])], options).action).toBe("insert");
    const relabelled = stored([{ code: "STD_EG", version: 2 }], { name: "Older wording" });
    expect(planTemplate(child, [relabelled], options).action).toBe("keep");
    expect(planTemplate(child, [relabelled], { refresh: true }).action).toBe("insert");
  });
});

describe("seeding", () => {
  it("adds the three templates, active, SAFEDON_EG for its client and resolved against STD_EG version 1", async () => {
    const { db, rows, writes } = fakeDatabase();
    const outcomes = await seedTemplates(db, bundle(), { dryRun: false, refresh: false });
    expect(writes).toEqual(["insert STD_EG v1 active", "insert SAFEDON_EG v1 active", "insert STD_SG v1 active"]);
    expect(active(rows)).toEqual(["SAFEDON_EG v1", "STD_EG v1", "STD_SG v1"]);
    const safedon = rows.find((row) => row.code === "SAFEDON_EG");
    expect(safedon?.client_id).toBe(POLYCO);
    expect((safedon?.resolved as { bases: unknown }).bases).toEqual([{ code: "STD_EG", version: 1 }]);
    expect(outcomes.map((outcome) => describeOutcome(outcome, false))).toEqual([
      "STD_EG       version 1  added, active",
      "SAFEDON_EG   version 1  added, active · client Polyco Healthline",
      "STD_SG       version 1  added, active",
    ]);
  });

  it("is idempotent: a second run writes nothing", async () => {
    const { db, writes } = fakeDatabase();
    await seedTemplates(db, bundle(), { dryRun: false, refresh: false });
    writes.length = 0;
    const outcomes = await seedTemplates(db, bundle(), { dryRun: false, refresh: false });
    expect(writes).toEqual([]);
    expect(outcomes.map((outcome) => outcome.plan.action)).toEqual(["keep", "keep", "keep"]);
  });

  it("versions a changed base and the child resolved against it, retiring what they replace", async () => {
    const { db, rows, writes } = fakeDatabase();
    await seedTemplates(db, bundle(), { dryRun: false, refresh: false });
    writes.length = 0;
    const changed = bundle();
    changed.templates[0].definition.name = "Standard examination gloves (EN 455), revised";
    await seedTemplates(db, changed, { dryRun: false, refresh: false });
    expect(writes).toEqual([
      "insert STD_EG v2 draft",
      "retired STD_EG v1",
      "active STD_EG v2",
      "insert SAFEDON_EG v2 draft",
      "retired SAFEDON_EG v1",
      "active SAFEDON_EG v2",
    ]);
    expect(active(rows)).toEqual(["SAFEDON_EG v2", "STD_EG v2", "STD_SG v1"]);
    const safedon = rows.find((row) => row.code === "SAFEDON_EG" && row.version === 2);
    expect((safedon?.resolved as { bases: unknown }).bases).toEqual([{ code: "STD_EG", version: 2 }]);
    // The replaced versions are retired, never edited.
    expect(rows.find((row) => row.code === "STD_EG" && row.version === 1)?.definition).toMatchObject({
      name: "Standard examination gloves (EN 455)",
    });
  });

  it("writes nothing on a dry run and says what it would do", async () => {
    const { db, writes } = fakeDatabase();
    const outcomes = await seedTemplates(db, bundle(), { dryRun: true, refresh: false });
    expect(writes).toEqual([]);
    expect(outcomes.map((outcome) => describeOutcome(outcome, true))).toEqual([
      "STD_EG       version 1  to add, active",
      "SAFEDON_EG   version 1  to add, active · client Polyco Healthline",
      "STD_SG       version 1  to add, active",
    ]);
  });

  it("plans a dry run of a changed base with the base's next version", async () => {
    const { db } = fakeDatabase();
    await seedTemplates(db, bundle(), { dryRun: false, refresh: false });
    const changed = bundle();
    changed.templates[0].definition.name = "Renamed";
    const outcomes = await seedTemplates(db, changed, { dryRun: true, refresh: false });
    expect(outcomes.map((outcome) => describeOutcome(outcome, true))).toEqual([
      "STD_EG       version 2  to add, active, version 1 to retire",
      "SAFEDON_EG   version 2  to add, active, version 1 to retire · client Polyco Healthline",
      "STD_SG       version 1  unchanged, active",
    ]);
  });

  it("stops before writing anything when the client is missing", async () => {
    const { db, writes } = fakeDatabase({ clients: [{ id: POLYCO, name: "Someone else" }] });
    await expect(seedTemplates(db, bundle(), { dryRun: false, refresh: false })).rejects.toThrow(
      /SAFEDON_EG belongs to the client "Polyco Healthline", which is not in the clients table/,
    );
    expect(writes).toEqual([]);
  });

  it("finds the client whatever its case", async () => {
    const { db, rows } = fakeDatabase({ clients: [{ id: POLYCO, name: " polyco HEALTHLINE " }] });
    await seedTemplates(db, bundle(), { dryRun: false, refresh: false });
    expect(rows.find((row) => row.code === "SAFEDON_EG")?.client_id).toBe(POLYCO);
  });

  it("puts the old version back when the new one cannot be activated", async () => {
    const { db, rows } = fakeDatabase();
    await seedTemplates(db, bundle(), { dryRun: false, refresh: false });
    const failing = fakeDatabase({ refuseActive: "STD_EG v2" });
    failing.rows.push(...rows.map((row) => structuredClone(row)));
    const changed = bundle();
    changed.templates[0].definition.name = "Renamed";
    await expect(seedTemplates(failing.db, changed, { dryRun: false, refresh: false })).rejects.toThrow(/activation refused/);
    expect(failing.writes).toEqual(["insert STD_EG v2 draft", "retired STD_EG v1", "active STD_EG v1"]);
    expect(active(failing.rows)).toEqual(["SAFEDON_EG v1", "STD_EG v1", "STD_SG v1"]);
  });
});

describe("jsonEqual", () => {
  it("ignores key order and undefined keys, as jsonb does", () => {
    expect(jsonEqual({ a: 1, b: { c: [1, { d: 2 }] } }, { b: { c: [1, { d: 2 }] }, a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: "1" })).toBe(false);
    expect(jsonEqual({ a: [] }, { a: {} })).toBe(false);
  });
});
