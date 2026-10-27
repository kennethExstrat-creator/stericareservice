import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assignLead, createInspection, createLead, createPeople, createTemplate, setStatus, type People } from "./fixtures";
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
  type Db,
} from "./harness";

// Roles and permissions (migration 20261027150000, Kenneth, 27 October 2026:
// "build permission and module on off for each role", with custom roles):
// a role's access keeps the old data boundary (role and is_lead follow it);
// its permissions switch screens and actions on; only the built-in Admin role
// manages people and roles.

const MIGRATION = "20261027150000_roles_and_permissions.sql";

type ProfileRole = { role_id: string; role: string; is_lead: boolean; lead_id: string | null };

async function roleOf(db: Db, id: string): Promise<ProfileRole> {
  const result = await asOwner(db, (tx) =>
    tx.query<ProfileRole>("select role_id, role, is_lead, lead_id from public.profiles where id = $1", [id]),
  );
  return result.rows[0];
}

async function builtIn(db: Db, kind: "admin" | "lead" | "inspector"): Promise<string> {
  return (await asOwner(db, (tx) => column<string>(tx, "select id from public.roles where built_in = $1", [kind])))[0];
}

/** A custom role, made as the database owner. */
async function customRole(db: Db, name: string, access: "own" | "team" | "all", permissions: string[]): Promise<string> {
  const ids = await asOwner(db, (tx) =>
    column<string>(tx, "insert into public.roles (name, access, permissions) values ($1, $2, $3) returning id", [
      name,
      access,
      permissions,
    ]),
  );
  return ids[0];
}

async function giveRole(db: Db, userId: string, roleId: string, leadId: string | null = null): Promise<void> {
  await asOwner(db, (tx) => tx.query("update public.profiles set role_id = $2, lead_id = $3 where id = $1", [userId, roleId, leadId]));
}

describe("people made before the migration", { timeout: 30_000 }, () => {
  let db: Db;
  let admin: string;
  let lead: string;
  let inspector: string;

  beforeAll(async () => {
    const names = (await readMigrations()).map(({ name }) => name);
    db = await createTestDb({ until: names[names.indexOf(MIGRATION) - 1] });
    admin = await createAuthUser(db, { email: "admin@test.local" });
    await asOwner(db, (tx) => tx.query("update public.profiles set role = 'admin' where id = $1", [admin]));
    lead = await createLead(db, "lead@test.local", "Lee Lead");
    inspector = await createAuthUser(db, { email: "inspector@test.local" });
    await assignLead(db, inspector, lead);
    const file = (await readMigrations()).find(({ name }) => name === MIGRATION);
    if (!file) throw new Error(`${MIGRATION} is not in supabase/migrations`);
    await applyAsOwner(db, file);
  }, 120_000);
  afterAll(() => db.close());

  it("get the built-in role for what they are, and keep their team", async () => {
    expect((await roleOf(db, admin)).role_id).toBe(await builtIn(db, "admin"));
    expect((await roleOf(db, lead)).role_id).toBe(await builtIn(db, "lead"));
    expect(await roleOf(db, inspector)).toMatchObject({ role_id: await builtIn(db, "inspector"), lead_id: lead });
  });
});

describe("roles", { timeout: 60_000 }, () => {
  let db: Db;
  let people: People;
  let lead: string;
  let templateId: string;

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
    lead = await createLead(db, "lead@test.local", "Lee Lead");
    await assignLead(db, people.inspector, lead);
    await assignLead(db, people.otherInspector, lead);
    templateId = await createTemplate(db);
  }, 120_000);
  afterAll(() => db.close());

  describe("the built-in roles", () => {
    it("allow what each could do before, the Admin role everything", async () => {
      const allowed = (userId: string, permission: string) =>
        asUser(db, userId, (tx) => column<boolean>(tx, "select public.has_permission($1)", [permission]));
      expect(await allowed(people.admin, "approve_inspections")).toEqual([true]);
      expect(await allowed(people.inspector, "create_inspections")).toEqual([true]);
      expect(await allowed(people.inspector, "approve_inspections")).toEqual([false]);
      expect(await allowed(people.inspector, "clients")).toEqual([false]);
      expect(await allowed(lead, "export_reports")).toEqual([true]);
    });

    it("are never deleted, renamed or given other access, and the Admin role keeps every permission", async () => {
      const admin = await builtIn(db, "admin");
      const inspector = await builtIn(db, "inspector");
      expect((await pgError(asUser(db, people.admin, (tx) => tx.query("delete from public.roles where id = $1", [inspector])))).code).toBe("42501");
      expect(
        (await pgError(asUser(db, people.admin, (tx) => tx.query("update public.roles set name = 'Checker' where id = $1", [inspector])))).code,
      ).toBe("42501");
      expect(
        (await pgError(asUser(db, people.admin, (tx) => tx.query("update public.roles set access = 'all' where id = $1", [inspector])))).code,
      ).toBe("42501");
      expect(
        (await pgError(asUser(db, people.admin, (tx) => tx.query("update public.roles set permissions = '{}' where id = $1", [admin])))).code,
      ).toBe("42501");
    });

    it("let an admin change the Inspector role's switches", async () => {
      const inspector = await builtIn(db, "inspector");
      await asUser(db, people.admin, (tx) =>
        tx.query("update public.roles set permissions = array_append(permissions, 'dashboard') where id = $1", [inspector]),
      );
      expect(await asUser(db, people.inspector, (tx) => column<boolean>(tx, "select public.has_permission('dashboard')"))).toEqual([true]);
      await asUser(db, people.admin, (tx) =>
        tx.query("update public.roles set permissions = array_remove(permissions, 'dashboard') where id = $1", [inspector]),
      );
    });
  });

  describe("custom roles", () => {
    it("are made, named and switched by the Admin role only", async () => {
      const made = await asUser(db, people.admin, (tx) =>
        column<string>(
          tx,
          "insert into public.roles (name, access, permissions) values ('  Office   Staff ', 'own', '{clients,manufacturers,clients}') returning id",
        ),
      );
      const row = await asOwner(db, (tx) =>
        tx.query<{ name: string; permissions: string[] }>("select name, permissions from public.roles where id = $1", [made[0]]),
      );
      expect(row.rows[0]).toEqual({ name: "Office Staff", permissions: ["clients", "manufacturers"] });

      const byInspector = await pgError(
        asUser(db, people.inspector, (tx) => tx.query("insert into public.roles (name, access) values ('Mine', 'all')")),
      );
      expect(byInspector.code).toBe("42501");
      expect(
        (await pgError(asUser(db, people.admin, (tx) => tx.query("insert into public.roles (name, access) values ('office staff', 'own')")))).code,
      ).toBe("23505");
      expect(
        (await pgError(asUser(db, people.admin, (tx) => tx.query("insert into public.roles (name, access, permissions) values ('X', 'own', '{fly}')")))).code,
      ).toBe("23514");
    });

    it("set what their people see: role and is_lead follow the access", async () => {
      const manager = await customRole(db, "QC Manager", "all", ["approve_inspections"]);
      const person = await createAuthUser(db, { email: "manager@test.local" });
      await assignLead(db, person, lead);
      // Out of the team in the same change, as the app does: the team rules refuse a lead kept.
      const keptLead = await pgError(giveRole(db, person, manager, lead));
      expect(keptLead).toMatchObject({ code: "23514", message: "an admin is not a lead inspector and is in no team" });
      await giveRole(db, person, manager);
      expect(await roleOf(db, person)).toMatchObject({ role: "admin", is_lead: false, lead_id: null });

      const teamRole = await customRole(db, "Senior Inspector", "team", []);
      await giveRole(db, person, teamRole);
      expect(await roleOf(db, person)).toMatchObject({ role: "inspector", is_lead: true });
    });

    it("keep what they see while anyone has them, and are not deleted then", async () => {
      const role = await customRole(db, "Checker", "own", []);
      const person = await createAuthUser(db, { email: "checker@test.local" });
      await giveRole(db, person, role, lead);
      expect(
        (await pgError(asUser(db, people.admin, (tx) => tx.query("update public.roles set access = 'all' where id = $1", [role])))).code,
      ).toBe("23514");
      // ON DELETE RESTRICT: 23001.
      expect((await pgError(asUser(db, people.admin, (tx) => tx.query("delete from public.roles where id = $1", [role])))).code).toBe("23001");
      await giveRole(db, person, await builtIn(db, "inspector"), lead);
      await asUser(db, people.admin, (tx) => tx.query("delete from public.roles where id = $1", [role]));
    });

    it("needs a lead inspector for a role that sees its own inspections", async () => {
      const role = await customRole(db, "Trainee", "own", []);
      const person = await createAuthUser(db, { email: "trainee@test.local" });
      await asUser(db, people.admin, (tx) => tx.query("update public.profiles set role_id = $2, lead_id = $3 where id = $1", [person, role, lead]));
      const noLead = await pgError(
        asUser(db, people.admin, (tx) => tx.query("update public.profiles set lead_id = null where id = $1", [person])),
      );
      expect(noLead.code).toBe("23514");
    });
  });

  describe("managing people", () => {
    it("is the Admin role's alone, even for a role that sees everything", async () => {
      const manager = await customRole(db, "Operations", "all", ["clients", "dashboard"]);
      const person = await createAuthUser(db, { email: "ops@test.local" });
      await giveRole(db, person, manager);

      // Anyone else's profile, and the roles: row level security finds nothing to change.
      const other = await asUser(db, person, (tx) =>
        tx.query("update public.profiles set role_id = $2 where id = $1", [people.inspector, manager]),
      );
      expect(other.affectedRows ?? 0).toBe(0);
      const roles = await asUser(db, person, (tx) => tx.query("update public.roles set permissions = '{}' where id = $1", [manager]));
      expect(roles.affectedRows ?? 0).toBe(0);
      // Their own: the guard refuses.
      const selfAdmin = await pgError(
        asUser(db, person, (tx) => tx.query("update public.profiles set role_id = public.builtin_role_id('admin') where id = $1", [person])),
      );
      expect(selfAdmin.code).toBe("42501");
    });

    it("keeps one active person with the Admin role; one who only sees everything does not count", async () => {
      const db2 = await createTestDb();
      const only = await createAuthUser(db2, { email: "only@test.local" });
      await asOwner(db2, (tx) => tx.query("update public.profiles set role = 'admin' where id = $1", [only]));
      const allSeeing = await asOwner(db2, (tx) =>
        column<string>(tx, "insert into public.roles (name, access) values ('Viewer', 'all') returning id"),
      );
      const viewer = await createAuthUser(db2, { email: "viewer@test.local" });
      await asOwner(db2, (tx) => tx.query("update public.profiles set role_id = $2 where id = $1", [viewer, allSeeing[0]]));
      const demote = await pgError(
        asService(db2, (tx) => tx.query("update public.profiles set active = false where id = $1", [only])),
      );
      expect(demote.message).toMatch(/last active admin/);
      await db2.close();
    });

    it("moves a person to the built-in role when only role and is_lead are written (code from before roles)", async () => {
      const person = await createAuthUser(db, { email: "legacy@test.local" });
      await asUser(db, people.admin, (tx) => tx.query("update public.profiles set role = 'admin', lead_id = null where id = $1", [person]));
      expect((await roleOf(db, person)).role_id).toBe(await builtIn(db, "admin"));
    });
  });

  describe("the role's switches in the database", () => {
    it("let a role without admin access manage clients when it allows them, and nothing else", async () => {
      const office = await customRole(db, "Clients Desk", "own", ["clients"]);
      const person = await createAuthUser(db, { email: "desk@test.local" });
      await giveRole(db, person, office, lead);
      await asUser(db, person, (tx) => tx.query("insert into public.clients (name) values ('Glove Buyer')"));
      for (const sql of [
        "insert into public.manufacturer_brands (name) values ('Brand')",
        "insert into public.manufacturer_companies (brand_id, name) values ('11000000-0000-4000-8000-000000000001', 'Company')",
        "insert into public.manufacturers (company_id, factory_name) values ('12000000-0000-4000-8000-000000000001', 'Factory')",
      ]) {
        expect((await pgError(asUser(db, person, (tx) => tx.query(sql)))).code, sql).toBe("42501");
      }
    });

    it("refuse an admin-level role what it does not allow: approving, switching steps, deciding on Steri-AI", async () => {
      const viewer = await customRole(db, "Auditor", "all", []);
      const person = await createAuthUser(db, { email: "auditor@test.local" });
      await giveRole(db, person, viewer);
      const inspection = await createInspection(db, people.inspector, templateId);
      await setStatus(db, people.inspector, inspection.id, "submitted");
      const approve = await pgError(
        asUser(db, person, (tx) => tx.query("update public.inspections set status = 'approved' where id = $1", [inspection.id])),
      );
      expect(approve.message).toMatch(/cannot approve or reopen/);
      const steps = await pgError(
        asUser(db, person, (tx) =>
          tx.query(`update public.inspections set module_overrides = '{"weight": false}' where id = $1`, [inspection.id]),
        ),
      );
      expect(steps.message).toMatch(/cannot switch inspection steps/);
      // The built-in Admin role still approves.
      await setStatus(db, people.admin, inspection.id, "approved");
    });

    it("refuse creating inspections and deleting drafts to a role that does not allow them", async () => {
      const watcher = await customRole(db, "Watcher", "own", []);
      const person = await createAuthUser(db, { email: "watcher@test.local" });
      await giveRole(db, person, watcher, lead);
      const create = await pgError(createInspection(db, person, templateId));
      expect(create.message).toMatch(/cannot create inspections/);

      const draft = await createInspection(db, people.otherInspector, templateId);
      const inspectorRole = await builtIn(db, "inspector");
      await asUser(db, people.admin, (tx) =>
        tx.query("update public.roles set permissions = array_remove(permissions, 'delete_drafts') where id = $1", [inspectorRole]),
      );
      const remove = await pgError(
        asUser(db, people.otherInspector, (tx) => tx.query("select public.delete_draft_inspection($1)", [draft.id])),
      );
      expect(remove.message).toMatch(/cannot delete drafts/);
      await asUser(db, people.admin, (tx) =>
        tx.query("update public.roles set permissions = array_append(permissions, 'delete_drafts') where id = $1", [inspectorRole]),
      );
      await asUser(db, people.otherInspector, (tx) => tx.query("select public.delete_draft_inspection($1)", [draft.id]));
    });
  });

  it("tells the session the caller's own role", async () => {
    const rows = await asUser(db, people.inspector, (tx) =>
      tx.query<{ name: string; built_in: string; access: string; permissions: string[] }>(
        "select name, built_in, access, permissions from public.my_role()",
      ),
    );
    expect(rows.rows[0]).toMatchObject({ name: "Inspector", built_in: "inspector", access: "own" });
    expect(rows.rows[0].permissions).toContain("create_inspections");
  });
});
