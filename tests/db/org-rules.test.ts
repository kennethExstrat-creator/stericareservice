import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tables } from "@/lib/supabase/database.types";
import { assignLead, createLead, createPeople, promoteToAdmin, type People } from "./fixtures";
import {
  applyAsOwner,
  asOwner,
  asService,
  asUser,
  column,
  createAuthUser,
  createTestDb,
  pgError,
  readMigrations,
  schemaSnapshot,
  type Db,
  type Tx,
} from "./harness";

type Profile = Tables<"profiles">;

const MIGRATION = "20261007170000_lead_inspectors.sql";

async function profile(db: Db, id: string): Promise<Profile> {
  const result = await asOwner(db, (tx) => tx.query<Profile>("select * from public.profiles where id = $1", [id]));
  return result.rows[0];
}

function update(tx: Tx, id: string, assignments: string, params: unknown[] = []) {
  return tx.query<Profile>(`update public.profiles set ${assignments} where id = $1 returning *`, [id, ...params]);
}

// Lead inspectors and their teams (migration 20261007170000): who leads whom,
// and who may change it. Visibility is in rls-lead.test.ts.
describe("lead inspectors: the rules on profiles", { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;
  let lead: string;
  let otherLead: string;

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
    lead = await createLead(db, "lead@test.local", "Lina Lead");
    otherLead = await createLead(db, "lead2@test.local", "Leo Lead");
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("starts every account outside any team, as an inspector who is not a lead", async () => {
    const id = await createAuthUser(db, { email: "fresh@test.local", active: false });
    expect(await profile(db, id)).toMatchObject({ role: "inspector", active: false, is_lead: false, lead_id: null });
  });

  it("tells the session the level and the lead through my_profile_status()", async () => {
    await assignLead(db, people.inspector, lead);
    const status = (userId: string) =>
      asUser(db, userId, (tx) => tx.query("select * from public.my_profile_status()")).then((result) => result.rows);
    expect(await status(lead)).toEqual([{ active: true, role: "inspector", is_lead: true, lead_id: null }]);
    expect(await status(people.inspector)).toEqual([{ active: true, role: "inspector", is_lead: false, lead_id: lead }]);
    expect(await status(people.admin)).toEqual([{ active: true, role: "admin", is_lead: false, lead_id: null }]);
  });

  describe("what an admin does on the Users screen", () => {
    it("makes an inspector a lead inspector, and back once their team is empty", async () => {
      const id = await createAuthUser(db, { email: "rising@test.local", fullName: "Rita Rising" });
      await assignLead(db, id, lead);
      // A lead has no lead of their own: both change in one statement.
      const promoted = await asUser(db, people.admin, (tx) => update(tx, id, "is_lead = true, lead_id = null"));
      expect(promoted.rows[0]).toMatchObject({ is_lead: true, lead_id: null });

      const demoted = await asUser(db, people.admin, (tx) =>
        update(tx, id, "is_lead = false, lead_id = $2", [otherLead]),
      );
      expect(demoted.rows[0]).toMatchObject({ is_lead: false, lead_id: otherLead });
    });

    it("moves an inspector to another team", async () => {
      const moved = await asUser(db, people.admin, (tx) => update(tx, people.inspector, "lead_id = $2", [otherLead]));
      expect(moved.rows[0].lead_id).toBe(otherLead);
      await assignLead(db, people.inspector, lead);
    });

    it("activates an inspector into a team in one change", async () => {
      const id = await createAuthUser(db, { email: "newbie@test.local", active: false });
      const activated = await asUser(db, people.admin, (tx) => update(tx, id, "active = true, lead_id = $2", [lead]));
      expect(activated.rows[0]).toMatchObject({ active: true, lead_id: lead });
    });

    it("makes a team member an admin, who leaves the team in the same change", async () => {
      const id = await createAuthUser(db, { email: "boss@test.local" });
      await assignLead(db, id, lead);
      const refused = await pgError(asUser(db, people.admin, (tx) => update(tx, id, "role = 'admin'")));
      expect(refused).toMatchObject({ code: "23514", message: "an admin is not a lead inspector and is in no team" });

      const made = await asUser(db, people.admin, (tx) => update(tx, id, "role = 'admin', lead_id = null"));
      expect(made.rows[0]).toMatchObject({ role: "admin", lead_id: null, is_lead: false });
    });
  });

  describe("rule 6: an active inspector who is not a lead works in a lead inspector's team", () => {
    it.each([
      ["activating an inspector with no lead", "fresh-a@test.local", "active = true"],
      ["taking an active inspector out of their team", "fresh-b@test.local", "lead_id = null"],
      ["making a lead without a team a plain inspector", "fresh-c@test.local", "is_lead = false"],
      ["making an admin an inspector", "fresh-d@test.local", "role = 'inspector'"],
    ])("is checked when an admin is %s", async (_case, email, assignments) => {
      const id = await createAuthUser(db, { email, active: !assignments.startsWith("active") });
      if (assignments.startsWith("lead_id")) await assignLead(db, id, lead);
      if (assignments.startsWith("is_lead")) await asOwner(db, (tx) => update(tx, id, "is_lead = true"));
      if (assignments.startsWith("role")) await promoteToAdmin(db, id);

      const error = await pgError(asUser(db, people.admin, (tx) => update(tx, id, assignments)));
      expect(error).toMatchObject({ code: "23514", message: "an active inspector needs a lead inspector" });
    });

    it("leaves inspectors who had no lead before the rule as they are, until an admin changes them", async () => {
      // inspector@test.local on the live project: active, no lead.
      const id = await createAuthUser(db, { email: "grandfathered@test.local", fullName: "Gail Grandfathered" });
      expect(await profile(db, id)).toMatchObject({ active: true, lead_id: null });

      const renamed = await asUser(db, id, (tx) =>
        update(tx, id, "full_name = 'Gail G.', signature_path = $2", [`${id}/signature.png`]),
      );
      expect(renamed.rows[0]).toMatchObject({ full_name: "Gail G.", lead_id: null });
      // An admin may still take them out, or rename them, without choosing a lead first.
      const renamedByAdmin = await asUser(db, people.admin, (tx) => update(tx, id, "full_name = 'Gail Grand'"));
      expect(renamedByAdmin.rows[0].full_name).toBe("Gail Grand");
      const deactivated = await asUser(db, people.admin, (tx) => update(tx, id, "active = false"));
      expect(deactivated.rows[0].active).toBe(false);
    });

    it("binds signed-in admins only: test setup, scripts and repairs may leave the lead for later", async () => {
      const viaService = await createAuthUser(db, { email: "script@test.local", active: false });
      const viaOwner = await createAuthUser(db, { email: "repair@test.local", active: false });
      await asService(db, (tx) => update(tx, viaService, "active = true"));
      await asOwner(db, (tx) => update(tx, viaOwner, "active = true"));
      expect((await profile(db, viaService)).active).toBe(true);
      expect((await profile(db, viaOwner)).active).toBe(true);
    });
  });

  describe("rule 4: a lead_id names an active lead inspector", () => {
    it.each([
      ["an inspector who is not a lead", (p: People) => p.otherInspector],
      ["an admin", (p: People) => p.admin],
      ["someone who does not exist", () => "00000000-0000-4000-8000-0000000000aa"],
    ])("refuses %s, whoever asks", async (_case, target) => {
      const id = await createAuthUser(db, { email: `team-${Math.random().toString(36).slice(2, 8)}@test.local` });
      for (const run of [
        (fn: (tx: Tx) => Promise<unknown>) => asUser(db, people.admin, fn),
        (fn: (tx: Tx) => Promise<unknown>) => asService(db, fn),
        (fn: (tx: Tx) => Promise<unknown>) => asOwner(db, fn),
      ]) {
        const error = await pgError(run((tx) => update(tx, id, "lead_id = $2", [target(people)])));
        expect(error).toMatchObject({ code: "23514", message: "the lead inspector must be an active lead inspector" });
      }
    });

    it("refuses a lead inspector who is deactivated", async () => {
      const away = await createLead(db, "away@test.local", "Andy Away");
      await asUser(db, people.admin, (tx) => update(tx, away, "active = false"));
      const error = await pgError(asUser(db, people.admin, (tx) => update(tx, people.otherInspector, "lead_id = $2", [away])));
      expect(error).toMatchObject({ code: "23514", message: "the lead inspector must be an active lead inspector" });
    });
  });

  describe("rules 1 to 3: on the row itself", () => {
    it("never lets anyone lead themselves", async () => {
      const id = await createAuthUser(db, { email: "narcissus@test.local" });
      for (const run of [
        (fn: (tx: Tx) => Promise<unknown>) => asUser(db, people.admin, fn),
        (fn: (tx: Tx) => Promise<unknown>) => asService(db, fn),
      ]) {
        const error = await pgError(run((tx) => update(tx, id, "lead_id = id")));
        expect(error).toMatchObject({ code: "23514", message: "nobody is their own lead inspector" });
      }
    });

    it("gives a lead inspector no lead of their own", async () => {
      const error = await pgError(asUser(db, people.admin, (tx) => update(tx, lead, "lead_id = $2", [otherLead])));
      expect(error).toMatchObject({ code: "23514", message: "a lead inspector has no lead inspector of their own" });
    });

    it("keeps admins out of the teams", async () => {
      const asLead = await pgError(asUser(db, people.admin, (tx) => update(tx, people.admin, "is_lead = true")));
      const inTeam = await pgError(asService(db, (tx) => update(tx, people.admin, "lead_id = $2", [lead])));
      expect(asLead).toMatchObject({ code: "23514", message: "an admin is not a lead inspector and is in no team" });
      expect(inTeam).toMatchObject({ code: "23514", message: "an admin is not a lead inspector and is in no team" });
    });

    it("still holds while the guards are switched off for a repair", async () => {
      const attempts = [
        ["profiles_admin_outside_teams", "is_lead = true", people.admin],
        ["profiles_lead_has_no_lead", "lead_id = $2", lead],
        ["profiles_lead_not_self", "lead_id = id", people.otherInspector],
      ] as const;
      for (const [constraint, assignments, id] of attempts) {
        const error = await pgError(
          asOwner(db, async (tx) => {
            await tx.exec("alter table public.profiles disable trigger org_guard");
            await update(tx, id, assignments, assignments.includes("$2") ? [otherLead] : []);
          }),
        );
        expect(error, constraint).toMatchObject({ code: "23514", message: expect.stringContaining(constraint) });
      }
    });
  });

  describe("rule 5: someone who leads a team stays an active lead inspector", () => {
    it.each([
      ["demoting them", "is_lead = false, lead_id = $2"],
      ["making them an admin", "role = 'admin', is_lead = false"],
      ["deactivating them", "active = false"],
    ])("refuses %s while their team has members, whoever asks", async (_case, assignments) => {
      const params = assignments.includes("$2") ? [otherLead] : [];
      for (const run of [
        (fn: (tx: Tx) => Promise<unknown>) => asUser(db, people.admin, fn),
        (fn: (tx: Tx) => Promise<unknown>) => asService(db, fn),
        (fn: (tx: Tx) => Promise<unknown>) => asOwner(db, fn),
      ]) {
        const error = await pgError(run((tx) => update(tx, lead, assignments, params)));
        expect(error).toMatchObject({
          code: "23514",
          message: expect.stringMatching(/^this lead inspector still leads \d+ inspector\(s\): assign them to another lead inspector first$/),
        });
      }
      expect(await profile(db, lead)).toMatchObject({ active: true, is_lead: true, role: "inspector" });
    });

    it("counts members who are deactivated too", async () => {
      const quiet = await createLead(db, "quiet@test.local", "Quinn Quiet");
      const member = await createAuthUser(db, { email: "member-away@test.local" });
      await assignLead(db, member, quiet);
      await asUser(db, people.admin, (tx) => update(tx, member, "active = false"));
      const error = await pgError(asUser(db, people.admin, (tx) => update(tx, quiet, "active = false")));
      expect(error.code).toBe("23514");
    });

    it("refuses deleting a lead inspector whose team has members", async () => {
      const error = await pgError(asOwner(db, (tx) => tx.query("delete from auth.users where id = $1", [lead])));
      expect(["23503", "23001"]).toContain(error.code);
    });

    it("lets them go once their team is reassigned", async () => {
      const leaving = await createLead(db, "leaving@test.local", "Lee Leaving");
      const member = await createAuthUser(db, { email: "member-moving@test.local" });
      await assignLead(db, member, leaving);
      await asUser(db, people.admin, (tx) => update(tx, member, "lead_id = $2", [otherLead]));
      const deactivated = await asUser(db, people.admin, (tx) => update(tx, leaving, "active = false"));
      expect(deactivated.rows[0]).toMatchObject({ active: false, is_lead: true });
    });
  });

  describe("rule 7: only admins change the teams", () => {
    it.each([
      ["make themselves a lead", (p: People, own: string) => [own, "is_lead = true", []] as const],
      ["choose their own lead", (p: People, own: string) => [own, "lead_id = $2", [p.admin]] as const],
    ])("stops an inspector who tries to %s", async (_case, attempt) => {
      const [id, assignments, params] = attempt(people, people.otherInspector);
      const error = await pgError(asUser(db, people.otherInspector, (tx) => update(tx, id, assignments, [...params])));
      expect(error).toMatchObject({ code: "42501", message: "only an admin can change role, active, is_lead or lead_id" });
    });

    it("stops a lead inspector adding people to their team or changing their team's profiles", async () => {
      const ownTeam = await pgError(asUser(db, lead, (tx) => update(tx, lead, "is_lead = false")));
      expect(ownTeam.code).toBe("42501");
      // Their team member's profile is readable to them, but not theirs to change.
      const changed = await asUser(db, lead, (tx) =>
        tx.query("update public.profiles set full_name = 'Renamed', lead_id = lead_id where id = $1", [people.inspector]),
      );
      expect(changed.affectedRows).toBe(0);
      const grabbed = await asUser(db, lead, (tx) =>
        tx.query("update public.profiles set lead_id = $2 where id = $1", [people.otherInspector, lead]),
      );
      expect(grabbed.affectedRows).toBe(0);
      expect((await profile(db, people.otherInspector)).lead_id).not.toBe(lead);
    });
  });

  it("applies again without changing the schema", async () => {
    const before = await schemaSnapshot(db);
    const migration = (await readMigrations()).find((file) => file.name === MIGRATION);
    expect(migration).toBeDefined();
    await applyAsOwner(db, migration!);
    expect(await schemaSnapshot(db)).toEqual(before);
    expect(
      await asOwner(db, (tx) =>
        column<string>(tx, "select column_name::text from information_schema.columns where table_name = 'profiles' and column_name in ('is_lead', 'lead_id') order by 1"),
      ),
    ).toEqual(["is_lead", "lead_id"]);
  });
});
