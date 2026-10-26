// scripts/seed-templates.mts against an in-memory templates table that keeps
// the database's rules: one active version per code, (code, version) unique.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  describeBlocked,
  describeOutcome,
  jsonEqual,
  parseBundle,
  planTemplate,
  prepare,
  replacesActive,
  rowFields,
  seedTemplates,
  type Bundle,
  type SeedDatabase,
  type SeedOptions,
  type TemplateStatus,
  type VersionRow,
  type Wanted,
} from "@/scripts/seed-templates.mjs";

const BUNDLE_TEXT = readFileSync(new URL("./seed-bundle.json", import.meta.url), "utf8");
const POLYCO = "20000000-0000-4000-8000-000000000001";

function bundle(): Bundle {
  return parseBundle(BUNDLE_TEXT);
}

/**
 * The bundle with SAFEDON_EG seeded as it was until 26 October 2026: a child
 * written with its base. The script's base-and-child rules run on it; the
 * real bundle retires SAFEDON_EG ("retiring SAFEDON_EG" below).
 */
function childBundle(): Bundle {
  const withChild = bundle();
  delete withChild.templates[1].retired;
  return withChild;
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

/** A real run; --replace only where a test gives it. */
const RUN: SeedOptions = { dryRun: false, refresh: false, replace: false };
const DRY_RUN: SeedOptions = { ...RUN, dryRun: true };
const REPLACE: SeedOptions = { ...RUN, replace: true };

/** The child bundle with STD_EG renamed: a changed definition. */
function renamed(name = "Standard examination gloves (ASTM D6319), revised"): Bundle {
  const changed = childBundle();
  changed.templates[0].definition.name = name;
  return changed;
}

describe("the bundle", () => {
  it("reads seed-bundle.json: STD_EG and STD_SG to write, SAFEDON_EG retired", () => {
    expect(bundle().templates.map((entry) => [entry.code, entry.client, entry.retired ?? false])).toEqual([
      ["STD_EG", null, false],
      ["SAFEDON_EG", "Polyco Healthline", true],
      ["STD_SG", null, false],
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
    const marked = structuredClone(parsed);
    marked.templates[1].retired = "yes";
    expect(() => parseBundle(JSON.stringify(marked))).toThrow(/SAFEDON_EG: bad retired mark/);
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

  it("knows which plans retire the active version", () => {
    expect(replacesActive(planTemplate(wanted, [], options))).toBe(false);
    expect(replacesActive(planTemplate(wanted, [row(1, "active")], options))).toBe(false);
    expect(replacesActive(planTemplate(wanted, [row(1, "retired"), row(2, "draft")], options))).toBe(false);
    expect(replacesActive(planTemplate(wanted, [row(1, "active", { definition: changed })], options))).toBe(true);
    expect(replacesActive(planTemplate(wanted, [row(1, "active", { definition: changed }), row(2, "draft")], options))).toBe(true);
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

describe("seeding a base and a child", () => {
  it("adds the three templates, active, SAFEDON_EG for its client and resolved against STD_EG version 1", async () => {
    const { db, rows, writes } = fakeDatabase();
    const report = await seedTemplates(db, childBundle(), RUN);
    expect(report.written).toBe(true);
    expect(writes).toEqual(["insert STD_EG v1 active", "insert SAFEDON_EG v1 active", "insert STD_SG v1 active"]);
    expect(active(rows)).toEqual(["SAFEDON_EG v1", "STD_EG v1", "STD_SG v1"]);
    const safedon = rows.find((row) => row.code === "SAFEDON_EG");
    expect(safedon?.client_id).toBe(POLYCO);
    expect((safedon?.resolved as { bases: unknown }).bases).toEqual([{ code: "STD_EG", version: 1 }]);
    expect(report.outcomes.map((outcome) => describeOutcome(outcome, false))).toEqual([
      "STD_EG       version 1  added, active",
      "SAFEDON_EG   version 1  added, active · client Polyco Healthline",
      "STD_SG       version 1  added, active",
    ]);
    expect(describeBlocked(report.outcomes, false)).toBeNull();
  });

  it("is idempotent: a second run writes nothing", async () => {
    const { db, writes } = fakeDatabase();
    await seedTemplates(db, childBundle(), RUN);
    writes.length = 0;
    const report = await seedTemplates(db, childBundle(), RUN);
    expect(writes).toEqual([]);
    expect(report.outcomes.map((outcome) => outcome.plan.action)).toEqual(["keep", "keep", "keep"]);
  });

  it("stops before writing anything when it would retire an active version, unless told to replace it", async () => {
    const { db, rows, writes } = fakeDatabase();
    await seedTemplates(db, childBundle(), RUN);
    writes.length = 0;
    const report = await seedTemplates(db, renamed(), RUN);
    expect(report.written).toBe(false);
    expect(writes).toEqual([]);
    expect(active(rows)).toEqual(["SAFEDON_EG v1", "STD_EG v1", "STD_SG v1"]);
    // SAFEDON_EG would follow its base to a new version, so it is held back too.
    expect(report.outcomes.map((outcome) => [outcome.plan.code, outcome.blocked])).toEqual([
      ["STD_EG", true],
      ["SAFEDON_EG", true],
      ["STD_SG", false],
    ]);
    expect(report.outcomes.map((outcome) => describeOutcome(outcome, true))).toEqual([
      "STD_EG       version 2  to add, active, version 1 to retire (needs --replace)",
      "SAFEDON_EG   version 2  to add, active, version 1 to retire · client Polyco Healthline (needs --replace)",
      "STD_SG       version 1  unchanged, active",
    ]);
    expect(describeBlocked(report.outcomes, false)).toBe(
      "Active now and different from the bundle: STD_EG version 1, SAFEDON_EG version 1. An admin may have changed them " +
        "since the seed. Stopped before writing anything: check them, then run again with --replace to retire them.",
    );
  });

  it("leaves an admin's newer active version alone unless told to replace it", async () => {
    // Seeded as version 1; an admin has since saved and activated version 2 of STD_EG.
    const { db, rows, writes } = fakeDatabase();
    await seedTemplates(db, childBundle(), RUN);
    const seeded = rows.find((row) => row.code === "STD_EG")!;
    seeded.status = "retired";
    rows.push({ ...structuredClone(seeded), id: "admin-v2", version: 2, status: "active", definition: { name: "Admin's" } });
    writes.length = 0;

    const report = await seedTemplates(db, childBundle(), RUN);
    expect(writes).toEqual([]);
    expect(active(rows)).toEqual(["SAFEDON_EG v1", "STD_EG v2", "STD_SG v1"]);
    expect(describeBlocked(report.outcomes, true)).toMatch(
      /^Active now and different from the bundle: STD_EG version 2, SAFEDON_EG version 1\. .* A real run stops before writing anything/,
    );

    await seedTemplates(db, childBundle(), REPLACE);
    expect(writes).toEqual([
      "insert STD_EG v3 draft",
      "retired STD_EG v2",
      "active STD_EG v3",
      "insert SAFEDON_EG v2 draft",
      "retired SAFEDON_EG v1",
      "active SAFEDON_EG v2",
    ]);
    // The admin's version is retired, never edited: it can be made active again.
    expect(rows.find((row) => row.id === "admin-v2")).toMatchObject({ status: "retired", definition: { name: "Admin's" } });
  });

  it("needs no --replace where nothing is active: it activates a draft or adds a version", async () => {
    const { db, rows, writes } = fakeDatabase();
    await seedTemplates(db, childBundle(), RUN);
    for (const row of rows) row.status = row.code === "STD_EG" ? "draft" : "retired";
    writes.length = 0;
    const report = await seedTemplates(db, childBundle(), RUN);
    expect(report.outcomes.map((outcome) => outcome.blocked)).toEqual([false, false, false]);
    expect(writes).toEqual(["active STD_EG v1", "insert SAFEDON_EG v2 active", "insert STD_SG v2 active"]);
  });

  it("versions a changed base and the child resolved against it, retiring what they replace", async () => {
    const { db, rows, writes } = fakeDatabase();
    await seedTemplates(db, childBundle(), RUN);
    writes.length = 0;
    await seedTemplates(db, renamed(), REPLACE);
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
      name: "Standard examination gloves (ASTM D6319)",
    });
  });

  it("writes nothing on a dry run and says what it would do", async () => {
    const { db, writes } = fakeDatabase();
    const report = await seedTemplates(db, childBundle(), DRY_RUN);
    expect(report.written).toBe(false);
    expect(writes).toEqual([]);
    expect(report.outcomes.map((outcome) => describeOutcome(outcome, true))).toEqual([
      "STD_EG       version 1  to add, active",
      "SAFEDON_EG   version 1  to add, active · client Polyco Healthline",
      "STD_SG       version 1  to add, active",
    ]);
  });

  it("plans a dry run of a changed base with the base's next version", async () => {
    const { db } = fakeDatabase();
    await seedTemplates(db, childBundle(), RUN);
    const report = await seedTemplates(db, renamed("Renamed"), { ...DRY_RUN, replace: true });
    expect(report.outcomes.map((outcome) => describeOutcome(outcome, true))).toEqual([
      "STD_EG       version 2  to add, active, version 1 to retire",
      "SAFEDON_EG   version 2  to add, active, version 1 to retire · client Polyco Healthline",
      "STD_SG       version 1  unchanged, active",
    ]);
  });

  it("stops before writing anything when the client is missing", async () => {
    const { db, writes } = fakeDatabase({ clients: [{ id: POLYCO, name: "Someone else" }] });
    await expect(seedTemplates(db, childBundle(), RUN)).rejects.toThrow(
      /SAFEDON_EG belongs to the client "Polyco Healthline", which is not in the clients table/,
    );
    expect(writes).toEqual([]);
  });

  it("finds the client whatever its case", async () => {
    const { db, rows } = fakeDatabase({ clients: [{ id: POLYCO, name: " polyco HEALTHLINE " }] });
    await seedTemplates(db, childBundle(), RUN);
    expect(rows.find((row) => row.code === "SAFEDON_EG")?.client_id).toBe(POLYCO);
  });

  it("puts the old version back when the new one cannot be activated", async () => {
    const { db, rows } = fakeDatabase();
    await seedTemplates(db, childBundle(), RUN);
    const failing = fakeDatabase({ refuseActive: "STD_EG v2" });
    failing.rows.push(...rows.map((row) => structuredClone(row)));
    await expect(seedTemplates(failing.db, renamed("Renamed"), REPLACE)).rejects.toThrow(/activation refused/);
    expect(failing.writes).toEqual(["insert STD_EG v2 draft", "retired STD_EG v1", "active STD_EG v1"]);
    expect(active(failing.rows)).toEqual(["SAFEDON_EG v1", "STD_EG v1", "STD_SG v1"]);
  });
});

// Kenneth, 26 October 2026: every client uses STD_EG, which runs SAFEDON_EG's flow; SAFEDON_EG is retired.
describe("retiring SAFEDON_EG", () => {
  it("adds STD_EG and STD_SG to an empty table, retires nothing and needs no client", async () => {
    const { db, rows, writes } = fakeDatabase({ clients: [] });
    const report = await seedTemplates(db, bundle(), RUN);
    expect(report.written).toBe(true);
    expect(writes).toEqual(["insert STD_EG v1 active", "insert STD_SG v1 active"]);
    expect(active(rows)).toEqual(["STD_EG v1", "STD_SG v1"]);
    expect(report.outcomes.map((outcome) => describeOutcome(outcome, false))).toEqual([
      "STD_EG       version 1  added, active",
      "SAFEDON_EG   no longer seeded, nothing active to retire",
      "STD_SG       version 1  added, active",
    ]);
    expect(rows.find((row) => row.code === "STD_EG")).toMatchObject({ client_id: null, extends_code: null });
  });

  it("retires its active version, and only with --replace, adding no new one", async () => {
    const { db, rows, writes } = fakeDatabase();
    await seedTemplates(db, childBundle(), RUN);
    writes.length = 0;

    const stopped = await seedTemplates(db, bundle(), RUN);
    expect(stopped.written).toBe(false);
    expect(writes).toEqual([]);
    expect(stopped.outcomes.map((outcome) => describeOutcome(outcome, true))).toEqual([
      "STD_EG       version 1  unchanged, active",
      "SAFEDON_EG   version 1  to retire: no longer seeded (needs --replace)",
      "STD_SG       version 1  unchanged, active",
    ]);
    expect(describeBlocked(stopped.outcomes, false)).toBe(
      "Active now and no longer seeded: SAFEDON_EG version 1. An admin may have changed it since the seed. " +
        "Stopped before writing anything: check it, then run again with --replace to retire it.",
    );

    const report = await seedTemplates(db, bundle(), REPLACE);
    expect(writes).toEqual(["retired SAFEDON_EG v1"]);
    expect(active(rows)).toEqual(["STD_EG v1", "STD_SG v1"]);
    expect(describeOutcome(report.outcomes[1], false)).toBe("SAFEDON_EG   version 1  retired: no longer seeded");
    // Retired, never edited: an admin can make it active again, and a second run leaves it so.
    expect(rows.find((row) => row.code === "SAFEDON_EG")).toMatchObject({ status: "retired", client_id: POLYCO });
    writes.length = 0;
    await seedTemplates(db, bundle(), REPLACE);
    expect(writes).toEqual([]);
  });

  it("plans the live change in one run: a new STD_EG version, the old one and SAFEDON_EG retired", async () => {
    const { db } = fakeDatabase();
    await seedTemplates(db, renamed("Standard examination gloves (EN 455)"), RUN);
    const report = await seedTemplates(db, bundle(), { ...DRY_RUN, replace: true });
    expect(report.outcomes.map((outcome) => describeOutcome(outcome, true))).toEqual([
      "STD_EG       version 2  to add, active, version 1 to retire",
      "SAFEDON_EG   version 1  to retire: no longer seeded",
      "STD_SG       version 1  unchanged, active",
    ]);
    expect(describeBlocked(report.outcomes, true)).toBeNull();
  });

  it("is left as it is by --drafts, which retires nothing", async () => {
    const { db, writes } = fakeDatabase();
    await seedTemplates(db, childBundle(), RUN);
    writes.length = 0;
    const report = await seedTemplates(db, bundle(), { ...RUN, drafts: true });
    expect(writes).toEqual([]);
    expect(report.outcomes[1].blocked).toBe(false);
    expect(describeOutcome(report.outcomes[1], false)).toBe(
      "SAFEDON_EG   version 1  no longer seeded, left active (--drafts retires nothing)",
    );
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
