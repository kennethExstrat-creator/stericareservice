// scripts/seed-templates.mts: its command line (a dry run unless --apply, and
// nothing at all when npm took an option as its own), and --drafts, the seed
// templates written as drafts for an admin to check and activate (BUILD_SPEC
// 4.2 rule 10, 4.5), against an in-memory templates table that keeps the
// database's rules (one active version per code, (code, version) unique). The
// rest of the script is tested in lib/templates/definitions/seed-script.test.ts,
// and the script run as npm runs it in seed-templates.cli.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  describeDryRun,
  describeOutcome,
  parseBundle,
  parseCommandLine,
  planTemplate,
  plannedStatus,
  prepare,
  seedTemplates,
  swallowedByNpm,
  USAGE,
  writeCommand,
  type Bundle,
  type CommandLine,
  type RunOptions,
  type SeedDatabase,
  type SeedOptions,
  type TemplateStatus,
  type VersionRow,
} from "./seed-templates.mjs";

const BUNDLE_TEXT = readFileSync(new URL("../lib/templates/definitions/seed-bundle.json", import.meta.url), "utf8");
const POLYCO = "20000000-0000-4000-8000-000000000001";

const bundle = (): Bundle => parseBundle(BUNDLE_TEXT);

/** The bundle with SAFEDON_EG seeded as it was until 26 October 2026, a child written with its base. */
function childBundle(): Bundle {
  const withChild = bundle();
  delete withChild.templates[1].retired;
  return withChild;
}

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

/** The child bundle with STD_EG renamed: a changed definition. */
function renamed(): Bundle {
  const changed = childBundle();
  changed.templates[0].definition.name = "Standard examination gloves (ASTM D6319), revised";
  return changed;
}

describe("seeding drafts (--drafts)", () => {
  it("adds every template as a draft, SAFEDON_EG for its client and resolved against the STD_EG draft", async () => {
    const { db, rows, writes } = fakeDatabase();
    const report = await seedTemplates(db, childBundle(), DRAFTS);
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
    const report = await seedTemplates(db, childBundle(), { ...DRAFTS, dryRun: true });
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
    await seedTemplates(db, childBundle(), DRAFTS);
    writes.length = 0;
    const report = await seedTemplates(db, childBundle(), DRAFTS);
    expect(writes).toEqual([]);
    expect(report.outcomes.map((outcome) => describeOutcome(outcome, false))).toEqual([
      "STD_EG       version 1  unchanged, draft",
      "SAFEDON_EG   version 1  unchanged, draft · client Polyco Healthline",
      "STD_SG       version 1  unchanged, draft",
    ]);
  });

  it("keeps a version an admin has activated since, and never activates or retires anything", async () => {
    const { db, rows, writes } = fakeDatabase();
    await seedTemplates(db, childBundle(), DRAFTS);
    // The admin checked STD_EG and activated it.
    rows.find((row) => row.code === "STD_EG")!.status = "active";
    writes.length = 0;
    const same = await seedTemplates(db, childBundle(), DRAFTS);
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

  it("leaves a retired template's active version as it is", async () => {
    const { db, writes } = fakeDatabase();
    await seedTemplates(db, childBundle(), RUN);
    writes.length = 0;
    const report = await seedTemplates(db, bundle(), DRAFTS);
    expect(writes).toEqual([]);
    expect(report.outcomes.map((outcome) => describeOutcome(outcome, false))).toEqual([
      "STD_EG       version 1  unchanged, active",
      "SAFEDON_EG   version 1  no longer seeded, left active (--drafts retires nothing)",
      "STD_SG       version 1  unchanged, active",
    ]);
  });

  it("does not go with --replace", async () => {
    const { db, writes } = fakeDatabase();
    await expect(seedTemplates(db, childBundle(), { ...DRAFTS, replace: true })).rejects.toThrow(
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

/* ------------------------------------------------------------------ *
 * The command line
 * ------------------------------------------------------------------ */

/** What a plain npm run exports: none of the variables that betray a taken option. */
const NPM_RUN = { npm_config_user_agent: "npm/11.12.1 node/v25.9.0 darwin arm64 workspaces/false", npm_config_npm_version: "11.12.1" };

/** npm 11 expands --apply into its own shorthands -a -p -l -y. */
const NPM_TOOK_APPLY = { npm_config_all: "true", npm_config_parseable: "true", npm_config_long: "true", npm_config_yes: "true" };

const run = (seed: Partial<RunOptions["seed"]> = {}, allowStubs = false): CommandLine => ({
  kind: "run",
  seed: { dryRun: false, drafts: false, replace: false, refresh: false, ...seed },
  allowStubs,
});

describe("the command line", () => {
  it("is a dry run unless --apply is given", () => {
    expect(parseCommandLine([], NPM_RUN)).toEqual(run({ dryRun: true }));
    expect(parseCommandLine(["--drafts"], NPM_RUN)).toEqual(run({ dryRun: true, drafts: true }));
    expect(parseCommandLine(["--replace", "--refresh"], NPM_RUN)).toEqual(run({ dryRun: true, replace: true, refresh: true }));
    expect(parseCommandLine(["--dry-run"], NPM_RUN)).toEqual(run({ dryRun: true }));
  });

  it("writes with --apply, drafts with --apply --drafts, and --dry-run still wins", () => {
    expect(parseCommandLine(["--apply"], NPM_RUN)).toEqual(run());
    expect(parseCommandLine(["--apply", "--drafts"], NPM_RUN)).toEqual(run({ drafts: true }));
    expect(parseCommandLine(["--apply", "--replace", "--refresh", "--allow-stubs"], NPM_RUN)).toEqual(
      run({ replace: true, refresh: true }, true),
    );
    expect(parseCommandLine(["--apply", "--dry-run"], NPM_RUN)).toEqual(run({ dryRun: true }));
    // Run with node directly: no npm_config_ variables at all.
    expect(parseCommandLine(["--apply"], {})).toEqual(run());
  });

  it("shows the usage with --help", () => {
    expect(parseCommandLine(["--help"], NPM_RUN)).toEqual({ kind: "help" });
    expect(USAGE).toBe("npm run seed:templates -- [--apply] [--drafts | --replace] [--refresh] [--allow-stubs] [--dry-run]");
  });

  it("refuses what it does not know, and --drafts with --replace", () => {
    const refused = (argv: string[]) => {
      const command = parseCommandLine(argv, NPM_RUN);
      return command.kind === "refuse" ? command.message.split("\n")[0] : command.kind;
    };
    expect(refused(["--force"])).toBe("Unknown option --force.");
    expect(refused(["-y"])).toBe("Unknown option -y.");
    expect(refused(["--no-apply"])).toBe("Unknown option --no-apply.");
    expect(refused(["apply"])).toBe('Unexpected argument "apply".');
    expect(refused(["--apply=false"])).toBe("--apply takes no value.");
    expect(refused(["--", "--apply"])).toBe('Unexpected argument "--apply".');
    expect(refused(["--toString"])).toBe("Unknown option --toString.");
    expect(refused(["--apply", "--drafts", "--replace"])).toBe(
      "Use --drafts or --replace, not both: drafts never retire an active version.",
    );
    const unknown = parseCommandLine(["--force"], NPM_RUN);
    expect(unknown.kind === "refuse" && unknown.message.split("\n")[1]).toBe(`Usage: ${USAGE}`);
  });
});

describe("options npm took as its own (written before the --)", () => {
  // Each trace is what npm 11.12.1 handed the script for the command in the test's name.
  it("finds each option in npm's variables, as npm 11 spells them", () => {
    expect(swallowedByNpm(NPM_RUN)).toEqual([]);
    expect(swallowedByNpm({ npm_config_dry_run: "true" })).toEqual(["dry-run"]);
    expect(swallowedByNpm({ npm_config_drafts: "true" })).toEqual(["drafts"]);
    expect(swallowedByNpm({ npm_config_refresh: "true" })).toEqual(["refresh"]);
    expect(swallowedByNpm({ npm_config_allow_stubs: "true" })).toEqual(["allow-stubs"]);
    expect(swallowedByNpm(NPM_TOOK_APPLY)).toEqual(["apply"]);
    expect(swallowedByNpm({ npm_config_replace_registry_host: "true" })).toEqual(["replace"]);
    // --replace --drafts: npm took --drafts as --replace-registry-host's value.
    expect(swallowedByNpm({ npm_config_replace_registry_host: "--drafts" })).toEqual(["drafts", "replace"]);
    expect(swallowedByNpm({ npm_config_replace_registry_host: "--apply" })).toEqual(["apply", "replace"]);
    // Spelt as written, as a later npm may hand them over.
    expect(swallowedByNpm({ npm_config_apply: "true", npm_config_replace: "true" })).toEqual(["apply", "replace"]);
  });

  it("leaves npm's own settings alone", () => {
    expect(swallowedByNpm({ npm_config_yes: "true" })).toEqual([]);
    expect(swallowedByNpm({ npm_config_dry_run: "false", npm_config_drafts: "" })).toEqual([]);
    for (const host of ["npmjs", "never", "always", "registry.example.com"]) {
      expect(swallowedByNpm({ npm_config_replace_registry_host: host })).toEqual([]);
    }
  });

  it("npm run seed:templates --drafts -- --apply: stops, rather than write active templates", () => {
    expect(parseCommandLine(["--apply"], { ...NPM_RUN, npm_config_drafts: "true" })).toEqual({
      kind: "refuse",
      message:
        "npm took --drafts as its own option, so the script never saw it. Nothing was written.\n" +
        "Put the options after the --: npm run seed:templates -- --apply --drafts",
    });
  });

  it("npm run seed:templates --dry-run -- --apply: stops, rather than write", () => {
    const command = parseCommandLine(["--apply"], { ...NPM_RUN, npm_config_dry_run: "true" });
    expect(command.kind).toBe("refuse");
  });

  it("npm run seed:templates --replace --drafts -- --apply: names both", () => {
    expect(parseCommandLine(["--apply"], { ...NPM_RUN, npm_config_replace_registry_host: "--drafts" })).toEqual({
      kind: "refuse",
      message:
        "npm took --drafts and --replace as its own options, so the script never saw them. Nothing was written.\n" +
        "Put the options after the --: npm run seed:templates -- --apply --drafts --replace",
    });
  });

  it("npm run seed:templates --apply --drafts and --dry-run: stops too, though nothing would be written", () => {
    const apply = parseCommandLine([], { ...NPM_RUN, ...NPM_TOOK_APPLY, npm_config_drafts: "true" });
    expect(apply.kind === "refuse" && apply.message.split("\n")[1]).toBe(
      "Put the options after the --: npm run seed:templates -- --apply --drafts",
    );
    const dryRun = parseCommandLine([], { ...NPM_RUN, npm_config_dry_run: "true" });
    expect(dryRun.kind === "refuse" && dryRun.message.split("\n")[1]).toBe(
      "Put the options after the --: npm run seed:templates -- --dry-run",
    );
  });

  it("--help still shows the usage", () => {
    expect(parseCommandLine(["--help"], { ...NPM_RUN, npm_config_drafts: "true" })).toEqual({ kind: "help" });
  });
});

describe("the end of a dry run", () => {
  const options = (seed: Partial<RunOptions["seed"]> = {}, allowStubs = false): RunOptions => ({
    seed: { dryRun: true, drafts: false, replace: false, refresh: false, ...seed },
    allowStubs,
  });

  it("gives the command that writes what it showed, with the same options", () => {
    expect(writeCommand(options())).toBe("npm run seed:templates -- --apply");
    expect(writeCommand(options({ drafts: true }))).toBe("npm run seed:templates -- --apply --drafts");
    expect(writeCommand(options({ replace: true, refresh: true }, true))).toBe(
      "npm run seed:templates -- --apply --replace --refresh --allow-stubs",
    );
  });

  it("says how to write it, that there is nothing to write, or only that nothing was written when a run would stop", async () => {
    const { db } = fakeDatabase();
    const first = await seedTemplates(db, bundle(), { ...RUN, dryRun: true });
    expect(describeDryRun(first, options())).toBe("Nothing was written: this was a dry run. To write it: npm run seed:templates -- --apply");

    await seedTemplates(db, bundle(), RUN);
    const again = await seedTemplates(db, bundle(), { ...RUN, dryRun: true });
    expect(describeDryRun(again, options())).toBe("Nothing was written: this was a dry run. There is nothing to write.");

    // The active versions differ from the bundle: a run without --replace stops, and describeBlocked says why.
    const changed = await seedTemplates(db, renamed(), { ...RUN, dryRun: true });
    expect(changed.outcomes.some((outcome) => outcome.blocked)).toBe(true);
    expect(describeDryRun(changed, options())).toBe("Nothing was written: this was a dry run.");
    const replacing = await seedTemplates(db, renamed(), { ...RUN, dryRun: true, replace: true });
    expect(describeDryRun(replacing, options({ replace: true }))).toBe(
      "Nothing was written: this was a dry run. To write it: npm run seed:templates -- --apply --replace",
    );
  });
});
