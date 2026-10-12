import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tables } from "@/lib/supabase/database.types";
import { applyAsOwner, asOwner, column, createTestDb, readSeed, type Db } from "./harness";

// BUILD_SPEC 11: one master list of defect codes.
const SECTION_11_CODES = [
  "hole_crotch",
  "hole_palm",
  "hole_finger",
  "hole_cuff",
  "hole_other",
  "glove_burst",
  "embedded_insect",
  "embedded_metal",
  "thin_crotch_ring",
  "thin_crotch_area",
  "thin_body_area",
  "thin_spot",
  "dirt_nonremovable",
  "stain",
  "foreign_matter",
  "powder_mark",
  "bead_blister",
  "bead_defective",
  "lump_big",
  "lump_small",
  "dirt_small",
  "sticky_pleats",
  "bead_thin",
  "bead_small_defect",
  "bead_poor",
  "bead_rolled",
  "skin_visual",
  "flow_mark",
  "no_cuff",
  "finger_out",
  "multiple_out",
  "stuck",
  "sticky",
  "faulty_cuff",
];

async function counts(db: Db) {
  return asOwner(db, async (tx) => ({
    manufacturers: (await column<string>(tx, "select id from public.manufacturers")).length,
    clients: (await column<string>(tx, "select id from public.clients")).length,
    defectCodes: (await column<string>(tx, "select code from public.defect_codes")).length,
    users: (await column<string>(tx, "select id from auth.users")).length,
    templates: (await column<string>(tx, "select id from public.templates")).length,
  }));
}

describe("seed.sql", { timeout: 30_000 }, () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("contains every defect code of section 11, active, each with labels in its description", async () => {
    const result = await asOwner(db, (tx) =>
      tx.query<Tables<"defect_codes">>("select * from public.defect_codes order by code"),
    );
    expect(result.rows.map((row) => row.code).sort()).toEqual([...SECTION_11_CODES].sort());
    for (const row of result.rows) {
      expect(row.active, row.code).toBe(true);
      expect(row.description, row.code).toMatch(/labels?:/i);
    }
  });

  it("adds the two manufacturers and the SAFEDON_EG client, and no users or templates", async () => {
    const rows = await asOwner(db, async (tx) => ({
      manufacturers: (
        await tx.query<Pick<Tables<"manufacturers">, "name" | "factory_name" | "country">>(
          "select name, factory_name, country from public.manufacturers order by name",
        )
      ).rows,
      clients: (await tx.query<Pick<Tables<"clients">, "name" | "notes">>("select name, notes from public.clients"))
        .rows,
    }));
    expect(rows.manufacturers).toEqual([
      { name: "Hartalega NGC", factory_name: null, country: "Malaysia" },
      { name: "Terang Nusa Sdn. Bhd.", factory_name: "TG Factory 40", country: "Malaysia" },
    ]);
    expect(rows.clients).toEqual([
      { name: "Polyco Healthline", notes: "Client to confirm, BUILD_SPEC section 13" },
    ]);
    expect(await counts(db)).toMatchObject({ users: 0, templates: 0 });
  });

  it("applies again without error or duplicates", async () => {
    const before = await counts(db);
    const seed = await readSeed();
    await applyAsOwner(db, seed);
    await applyAsOwner(db, seed);
    expect(await counts(db)).toEqual(before);
  });

  it("leaves reference rows an admin edited alone", async () => {
    await asOwner(db, (tx) =>
      tx.query("update public.clients set name = 'Polyco Healthline Ltd' where name = 'Polyco Healthline'"),
    );
    await applyAsOwner(db, await readSeed());
    const names = await asOwner(db, (tx) => column<string>(tx, "select name from public.clients"));
    expect(names).toEqual(["Polyco Healthline Ltd"]);
  });
});
