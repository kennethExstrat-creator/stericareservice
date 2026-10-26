// The seed templates of BUILD_SPEC 11 as data, built from the data
// dictionary (lib/coverage): STD_EG and STD_SG, the standard templates every
// client uses, and SAFEDON_EG, retired. scripts/seed-templates.mts writes them
// to the templates table from seed-bundle.json (bundle.ts). It publishes
// STD_EG and STD_SG and retires SAFEDON_EG's active version. Since 26 October
// 2026 STD_EG runs SAFEDON_EG's flow (std-eg.ts).
import { SAFEDON_EG_SEED } from "./safedon-eg";
import { STD_EG_SEED } from "./std-eg";
import { STD_SG_SEED } from "./std-sg";
import type { SeedTemplate } from "./types";

export { definitionFromCoverage, definitionWithFlow, REPORT_TITLE_SEPARATOR, type FlowIdentity } from "./from-coverage";
export { SAFEDON_EG_CLIENT, SAFEDON_EG_SEED } from "./safedon-eg";
export { STD_EG_IDENTITY, STD_EG_REPORT_SEED, STD_EG_SEED } from "./std-eg";
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

/** Every seed template, each base before the templates that extend it; SAFEDON_EG is retired (`retired`). */
export const SEED_TEMPLATES: readonly SeedTemplate[] = [STD_EG_SEED, SAFEDON_EG_SEED, STD_SG_SEED];
