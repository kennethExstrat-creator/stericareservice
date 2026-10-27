import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPeople, type People } from "./fixtures";
import { applyAsOwner, asOwner, asUser, createTestDb, pgError, readMigrations, type Db } from "./harness";

// Migration 20261027163000: a manufacturer is a brand, its operating
// companies and each company's factories; manufacturers stays one row per
// factory, and its name is the company's.

const MIGRATION = "20261027163000_manufacturer_brands_companies.sql";
const TOP_GLOVE = "11000000-0000-4000-8000-000000000002";
const TERANG_NUSA = "12000000-0000-4000-8000-000000000002";

type Factory = { brand: string; company: string; name: string; factory_name: string | null };

async function factories(db: Db): Promise<Factory[]> {
  const result = await asOwner(db, (tx) =>
    tx.query<Factory>(
      `select b.name as brand, c.name as company, m.name, m.factory_name
         from public.manufacturers m
         join public.manufacturer_companies c on c.id = m.company_id
         join public.manufacturer_brands b on b.id = c.brand_id
        order by m.created_at, m.factory_name`,
    ),
  );
  return result.rows;
}

describe("manufacturers made before the migration", { timeout: 30_000 }, () => {
  let db: Db;

  beforeAll(async () => {
    const names = (await readMigrations()).map(({ name }) => name);
    db = await createTestDb({ until: names[names.indexOf(MIGRATION) - 1] });
    // One at a time: the first row of a name (by created_at) names its company.
    for (const [name, factory] of [
      ["Terang Nusa Sdn. Bhd.", "TG Factory 40"],
      ["Hartalega NGC", null],
      ["TERANG NUSA SDN. BHD.", "TG Factory 41"],
    ]) {
      await asOwner(db, (tx) => tx.query("insert into public.manufacturers (name, factory_name) values ($1, $2)", [name, factory]));
    }
    const file = (await readMigrations()).find(({ name }) => name === MIGRATION);
    if (!file) throw new Error(`${MIGRATION} is not in supabase/migrations`);
    await applyAsOwner(db, file);
  }, 120_000);
  afterAll(() => db.close());

  it("become factories of a company of their name, rows with one name sharing it, each company under a brand of its name", async () => {
    const rows = (await factories(db)).sort((a, b) => (a.factory_name ?? "").localeCompare(b.factory_name ?? ""));
    expect(rows).toEqual([
      { brand: "Hartalega NGC", company: "Hartalega NGC", name: "Hartalega NGC", factory_name: null },
      { brand: "Terang Nusa Sdn. Bhd.", company: "Terang Nusa Sdn. Bhd.", name: "Terang Nusa Sdn. Bhd.", factory_name: "TG Factory 40" },
      { brand: "Terang Nusa Sdn. Bhd.", company: "Terang Nusa Sdn. Bhd.", name: "Terang Nusa Sdn. Bhd.", factory_name: "TG Factory 41" },
    ]);
    const counts = await asOwner(db, async (tx) => ({
      brands: (await tx.query("select 1 from public.manufacturer_brands")).rows.length,
      companies: (await tx.query("select 1 from public.manufacturer_companies")).rows.length,
    }));
    expect(counts).toEqual({ brands: 2, companies: 2 });
  });
});

describe("brands, companies and factories", { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
  }, 120_000);
  afterAll(() => db.close());

  it("names a factory row after its company, also when it moves, and after a rename of the company", async () => {
    const id = await asUser(db, people.admin, async (tx) => {
      const made = await tx.query<{ id: string; name: string }>(
        "insert into public.manufacturers (company_id, factory_name) values ($1, 'TG-F35') returning id, name",
        [TERANG_NUSA],
      );
      expect(made.rows[0].name).toBe("Terang Nusa Sdn. Bhd.");
      return made.rows[0].id;
    });

    // Code from before the companies writes the name: the company's wins.
    const written = await asUser(db, people.admin, (tx) =>
      tx.query<{ name: string }>("update public.manufacturers set name = 'Something Else' where id = $1 returning name", [id]),
    );
    expect(written.rows[0].name).toBe("Terang Nusa Sdn. Bhd.");

    await asUser(db, people.admin, (tx) =>
      tx.query("update public.manufacturer_companies set name = 'Terang Nusa Sdn Bhd' where id = $1", [TERANG_NUSA]),
    );
    const renamed = await factories(db);
    expect(renamed.filter((row) => row.company === "Terang Nusa Sdn Bhd").map((row) => row.name)).toEqual([
      "Terang Nusa Sdn Bhd",
      "Terang Nusa Sdn Bhd",
    ]);

    const moved = await asUser(db, people.admin, async (tx) => {
      const company = await tx.query<{ id: string }>(
        "insert into public.manufacturer_companies (brand_id, name) values ($1, 'Top Glove Sdn. Bhd.') returning id",
        [TOP_GLOVE],
      );
      return tx.query<{ name: string }>("update public.manufacturers set company_id = $1 where id = $2 returning name", [
        company.rows[0].id,
        id,
      ]);
    });
    expect(moved.rows[0].name).toBe("Top Glove Sdn. Bhd.");
  });

  it("refuses a factory of a company that does not exist, or of none", async () => {
    const missing = await pgError(
      asUser(db, people.admin, (tx) =>
        tx.query("insert into public.manufacturers (company_id, factory_name) values ($1, 'Nowhere')", [
          "12000000-0000-4000-8000-0000000000ff",
        ]),
      ),
    );
    expect(missing.code).toBe("23503");
    const none = await pgError(
      asUser(db, people.admin, (tx) => tx.query("insert into public.manufacturers (factory_name) values ('Nowhere')")),
    );
    expect(none.code).toBe("23502");
  });

  it("keeps brand names and company names unique, whatever the case", async () => {
    for (const sql of [
      "insert into public.manufacturer_brands (name) values ('TOP glove')",
      `insert into public.manufacturer_companies (brand_id, name) values ('${TOP_GLOVE}', 'hartalega ngc')`,
    ]) {
      expect((await pgError(asUser(db, people.admin, (tx) => tx.query(sql)))).code, sql).toBe("23505");
    }
  });

  it("allows the same factory name at another company", async () => {
    const made = await asUser(db, people.admin, (tx) =>
      tx.query("insert into public.manufacturers (company_id, factory_name) values ('12000000-0000-4000-8000-000000000001', 'TG Factory 40')"),
    );
    expect(made.affectedRows).toBe(1);
  });

  it("deletes neither a brand that has companies nor a company that has factories", async () => {
    for (const sql of [
      `delete from public.manufacturer_brands where id = '${TOP_GLOVE}'`,
      `delete from public.manufacturer_companies where id = '${TERANG_NUSA}'`,
    ]) {
      // on delete restrict: 23001, which the admin screen words as "in use".
      expect((await pgError(asUser(db, people.admin, (tx) => tx.query(sql)))).code, sql).toBe("23001");
    }
  });

  it("lets every active user read brands and companies", async () => {
    const seen = await asUser(db, people.inspector, async (tx) => ({
      brands: (await tx.query("select id from public.manufacturer_brands")).rows.length,
      companies: (await tx.query("select id from public.manufacturer_companies")).rows.length,
    }));
    expect(seen.brands).toBeGreaterThanOrEqual(2);
    expect(seen.companies).toBeGreaterThanOrEqual(2);
  });
});
