// seed-bundle.json, the file scripts/seed-templates.mts reads. Its
// definitions must be the current ones exactly. Its resolutions are a
// snapshot, like a template version saved in the editor: they must resolve
// the definitions they sit next to (same modules, order, titles, wording,
// sizes) and still parse with each module's config schema, but a module's
// later default labels do not make them stale. Regenerate after changing the
// dictionary or the definitions, and once the report modules are built:
//
//   UPDATE_TEMPLATE_SEEDS=1 npx vitest run lib/templates/definitions/seed-bundle.test.ts
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODULE_KEYS } from "@/lib/schemas/module-result";
import { ResolvedTemplateSchema, TemplateDefinitionSchema } from "@/lib/schemas/template";
import { MODULE_REGISTRY } from "@/modules/registry";
import { buildSeedBundle, SEED_BUNDLE_ABOUT, SEED_BUNDLE_FORMAT, SEED_TEMPLATES, serializeSeedBundle } from ".";

const FILE = new URL("./seed-bundle.json", import.meta.url);
const UPDATE = "UPDATE_TEMPLATE_SEEDS=1 npx vitest run lib/templates/definitions/seed-bundle.test.ts";

const fresh = buildSeedBundle(SEED_TEMPLATES, MODULE_REGISTRY);
if (process.env.UPDATE_TEMPLATE_SEEDS === "1") writeFileSync(FILE, serializeSeedBundle(fresh));
const stored = JSON.parse(readFileSync(FILE, "utf8")) as typeof fresh;

describe("seed-bundle.json", () => {
  it(`holds the current seed definitions (else run ${UPDATE})`, () => {
    expect(stored.format).toBe(SEED_BUNDLE_FORMAT);
    expect(stored.about).toBe(SEED_BUNDLE_ABOUT);
    expect(stored.templates.map(({ code, client }) => ({ code, client }))).toEqual(
      fresh.templates.map(({ code, client }) => ({ code, client })),
    );
    for (const [index, entry] of stored.templates.entries()) {
      expect(TemplateDefinitionSchema.safeParse(entry.definition).success, entry.code).toBe(true);
      expect(entry.definition, `${entry.code} is stale: run ${UPDATE}`).toEqual(fresh.templates[index].definition);
    }
  });

  it("holds a resolution of each definition", () => {
    for (const [index, entry] of stored.templates.entries()) {
      const parsed = ResolvedTemplateSchema.safeParse(entry.resolved);
      expect(parsed.success, `${entry.code}: ${parsed.error?.message}`).toBe(true);
      const now = fresh.templates[index].resolved;
      const { modules, ...rest } = entry.resolved;
      const { modules: nowModules, ...nowRest } = now;
      expect(rest, `${entry.code} is stale: run ${UPDATE}`).toEqual(nowRest);
      expect(
        modules.map(({ key, include, title }) => ({ key, include, title })),
        `${entry.code} is stale: run ${UPDATE}`,
      ).toEqual(nowModules.map(({ key, include, title }) => ({ key, include, title })));
      for (const [at, stage] of modules.entries()) {
        // The template's own wording is there; module defaults are as of the snapshot.
        const own = Object.fromEntries(
          Object.entries(nowModules[at].labels).filter(([key, label]) => MODULE_REGISTRY[stage.key].labels[key] !== label),
        );
        expect(stage.labels, `${entry.code} ${stage.key}`).toMatchObject(own);
      }
    }
  });

  it("keeps configs the modules accept (strict once a module is built)", () => {
    for (const entry of stored.templates) {
      for (const stage of entry.resolved.modules.filter((candidate) => candidate.include)) {
        const parsed = MODULE_REGISTRY[stage.key].configSchema.safeParse(stage.config);
        expect(parsed.success, `${entry.code} ${stage.key}: ${parsed.error?.message}`).toBe(true);
      }
    }
  });

  it("lists every base before the templates that extend it, with no client id of its own", () => {
    const seen = new Set<string>();
    for (const entry of stored.templates) {
      if (entry.definition.extends) expect(seen).toContain(entry.definition.extends);
      seen.add(entry.code);
      expect(entry.definition.scope.clientId, entry.code).toBeUndefined();
      expect(entry.resolved.scope.clientId, entry.code).toBeUndefined();
    }
  });

  it("names the modules that were placeholders when it was made", () => {
    for (const key of stored.stubModules) expect(MODULE_KEYS).toContain(key);
    expect(new Set(stored.stubModules).size).toBe(stored.stubModules.length);
  });

  it("is formatted as the generator writes it", () => {
    expect(readFileSync(FILE, "utf8")).toBe(serializeSeedBundle(stored));
  });
});
