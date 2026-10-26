// The seed bundle: each seed template's definition with its resolution, as
// plain JSON (seed-bundle.json) for scripts/seed-templates.mts. The script
// runs on Node's built-in TypeScript, without the app's path aliases, so it
// cannot load the modules to resolve a template itself; it reads this file
// and writes the rows. seed-bundle.test.ts keeps the file in step with the
// definitions and regenerates it on request (UPDATE_TEMPLATE_SEEDS=1).
//
// Each definition is resolved against the module registry of the day, like a
// template version saved in the editor (templates.resolved is frozen with the
// version, docs/MODULES.md section 12). Regenerate after the report modules
// are built, so the seeds carry their default labels; `stubModules` says which
// modules were still placeholders when the file was made.
import { MODULE_KEYS, type ModuleKey } from "@/lib/schemas/module-result";
import type { ResolvedTemplate, TemplateDefinition } from "@/lib/schemas/template";
import type { ModuleRegistry } from "@/modules/_framework/contract";
import { lookupFrom, resolveTemplateOrThrow } from "../resolve";
import type { SeedTemplate } from "./types";

export const SEED_BUNDLE_FORMAT = 1;

/**
 * The version each base is resolved at here (`resolved.bases`). The seed
 * writes the version the base really has in the database instead.
 */
export const BUNDLE_BASE_VERSION = 1;

export const SEED_BUNDLE_ABOUT =
  "Generated from lib/templates/definitions: do not edit. Regenerate with " +
  "UPDATE_TEMPLATE_SEEDS=1 npx vitest run lib/templates/definitions/seed-bundle.test.ts; " +
  "scripts/seed-templates.mts writes it to the templates table.";

export type SeedBundleTemplate = {
  code: string;
  /** The client a client-scoped template belongs to, by name; the seed sets its id in scope.clientId. */
  client: string | null;
  /** The seed retires the code's active version and publishes none (SeedTemplate.retired). */
  retired?: true;
  definition: TemplateDefinition;
  resolved: ResolvedTemplate;
};

export type SeedBundle = {
  format: typeof SEED_BUNDLE_FORMAT;
  about: string;
  /** Modules the templates switch on that were placeholders when the bundle was made. */
  stubModules: ModuleKey[];
  /** Bases before the templates that extend them. */
  templates: SeedBundleTemplate[];
};

export function buildSeedBundle(seeds: readonly SeedTemplate[], registry: ModuleRegistry): SeedBundle {
  const definitions = seeds.map((seed) => ({ seed, definition: seed.definition() }));
  const getBase = lookupFrom(definitions.map(({ definition }) => ({ definition, version: BUNDLE_BASE_VERSION })));
  const templates = definitions.map(({ seed, definition }) => ({
    code: seed.code,
    client: seed.client,
    ...(seed.retired ? { retired: true as const } : {}),
    definition,
    resolved: resolveTemplateOrThrow(definition, { getBase, registry }),
  }));
  const used = new Set(
    templates.flatMap(({ resolved }) => resolved.modules.filter((entry) => entry.include).map((entry) => entry.key)),
  );
  return {
    format: SEED_BUNDLE_FORMAT,
    about: SEED_BUNDLE_ABOUT,
    stubModules: MODULE_KEYS.filter((key) => used.has(key) && registry[key].stub),
    templates,
  };
}

/** The file's text: two-space JSON with a final newline, so a regeneration diffs cleanly. */
export function serializeSeedBundle(bundle: SeedBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}
