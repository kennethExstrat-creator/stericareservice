// SAFEDON_EG: Safedon examination gloves to ASTM D6319 (BUILD_SPEC 11). Built
// from reports/SAFEDON_EG.md, then onsite/SAFEDON_EG.md. Extends STD_EG and
// lists only what differs; scoped to the client whose logo the report
// carries, Polyco Healthline (BUILD_SPEC 13 asks Kenneth to confirm it), so
// it wins over STD_EG whenever an inspection is for that client (4.4).
//
// Differences from STD_EG: header without client row and factory glove code,
// mfg and expiry dates as month and year, the report's wording; packing site
// per size; inner unit "plastic pack"; dimensions by average, no cuff, the
// report's specs XS to L; tensile (at least 14 MPa and 500%) instead of
// force_at_break; one weight value per size, NA spec; watertight adds glove
// burst; the report's visual defect lists; dispensing_safedon (125 gloves per
// pack, at most 5%) instead of dispensing_packing; labelling adds the expiry
// date at both levels; the onsite sheet's dispensing notes as a custom module.
import { definitionFromCoverage } from "./from-coverage";
import type { SeedTemplate } from "./types";

/** The client as supabase/seed.sql names it. */
export const SAFEDON_EG_CLIENT = "Polyco Healthline";

export const SAFEDON_EG_SEED: SeedTemplate = {
  code: "SAFEDON_EG",
  client: SAFEDON_EG_CLIENT,
  definition: (clientId) => definitionFromCoverage("SAFEDON_EG", clientId === undefined ? {} : { clientId }),
};
