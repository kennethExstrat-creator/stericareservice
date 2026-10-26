// SAFEDON_EG: Safedon examination gloves to ASTM D6319 (BUILD_SPEC 11), for
// the client whose logo the report carries, Polyco Healthline.
//
// Retired on 26 October 2026: every client now uses the standard template,
// which runs this flow under its own identity (std-eg.ts). The seed retires
// SAFEDON_EG's active version and publishes no new one (`retired`). The
// inspections made on its versions keep them, so its definition stays, for
// them and for tests.
//
// Built from reports/SAFEDON_EG.md, then onsite/SAFEDON_EG.md. It extends
// STD_EG's report flow (the data dictionary's TEMPLATES.STD_EG) and lists
// only what differs. Differences from that flow: header without client row
// and factory glove code; mfg and expiry dates as month and year; the
// report's wording; packing site per size; inner unit "plastic pack";
// dimensions by average, no cuff, the report's specs XS to L; tensile (at
// least 14 MPa and 500%) instead of force_at_break; one weight value per
// size, NA spec; watertight adds glove burst; the report's visual defect
// lists; dispensing_safedon (125 gloves per pack, at most 5%) instead of
// dispensing_packing; labelling adds the expiry date at both levels; the
// onsite sheet's dispensing notes as a custom module.
import { definitionFromCoverage } from "./from-coverage";
import type { SeedTemplate } from "./types";

/** The client as supabase/seed.sql names it. */
export const SAFEDON_EG_CLIENT = "Polyco Healthline";

export const SAFEDON_EG_SEED: SeedTemplate = {
  code: "SAFEDON_EG",
  client: SAFEDON_EG_CLIENT,
  flow: "SAFEDON_EG",
  retired: true,
  definition: (clientId) => definitionFromCoverage("SAFEDON_EG", clientId === undefined ? {} : { clientId }),
};
