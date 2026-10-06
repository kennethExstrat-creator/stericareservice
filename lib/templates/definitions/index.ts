// The seed templates of BUILD_SPEC 11 as data: STD_EG, SAFEDON_EG (extends
// STD_EG, scoped to its client) and STD_SG, built from the data dictionary
// (lib/coverage). scripts/seed-templates.mts writes them to the templates
// table from seed-bundle.json (bundle.ts).
import { SAFEDON_EG_SEED } from "./safedon-eg";
import { STD_EG_SEED } from "./std-eg";
import { STD_SG_SEED } from "./std-sg";
import type { SeedTemplate } from "./types";

export { definitionFromCoverage, REPORT_TITLE_SEPARATOR } from "./from-coverage";
export { SAFEDON_EG_CLIENT, SAFEDON_EG_SEED } from "./safedon-eg";
export { STD_EG_SEED } from "./std-eg";
export { STD_SG_SEED } from "./std-sg";
export {
  buildSeedBundle,
  serializeSeedBundle,
  BUNDLE_BASE_VERSION,
  SEED_BUNDLE_ABOUT,
  SEED_BUNDLE_FORMAT,
  type SeedBundle,
  type SeedBundleTemplate,
} from "./bundle";
export type { SeedTemplate } from "./types";

/** Every seed template, each base before the templates that extend it. */
export const SEED_TEMPLATES: readonly SeedTemplate[] = [STD_EG_SEED, SAFEDON_EG_SEED, STD_SG_SEED];
