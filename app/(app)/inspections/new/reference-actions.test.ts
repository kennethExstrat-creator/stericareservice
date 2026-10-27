// New Client and New Manufacturer's Server Actions (Kenneth, 27 October 2026:
// "the Steri AI should be able to read doc to use existing client and
// manufacturer or create new one"). A small database stands in for Supabase,
// with the unique indexes of migrations 20261006000200 and 20261027163000, so
// a name taken meanwhile meets a 23505 as it would. Placeholder names only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  unstable_rethrow: vi.fn((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
  }),
}));
vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminClientConfigured: vi.fn() }));

import { authorizeAction } from "@/lib/auth/session";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CHECK_FIELDS, NO_SWITCH, NOT_ADDED, NOTES, SEVERAL_CLIENTS } from "./_lib/new-entries";
import { addClientFromDocument, addManufacturerFromDocument } from "./reference-actions";

/* ------------------------------------------------------------------ *
 * A database: four tables, their unique indexes and foreign keys
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown> & { id: string };
type Table = "clients" | "manufacturer_brands" | "manufacturer_companies" | "manufacturers";
type Who = "user" | "admin";
type Write = { who: Who; table: Table; action: "insert" | "delete"; values: Record<string, unknown> };

const lower = (value: unknown) => String(value ?? "").toLowerCase();

/** Which existing row a new one collides with, on the table's unique index. */
const UNIQUE: Record<Table, (row: Row, other: Row) => boolean> = {
  clients: (row, other) => lower(row.name) === lower(other.name),
  manufacturer_brands: (row, other) => lower(row.name) === lower(other.name),
  manufacturer_companies: (row, other) => lower(row.name) === lower(other.name),
  manufacturers: (row, other) => row.company_id === other.company_id && lower(row.factory_name) === lower(other.factory_name),
};

function database(initial: Partial<Record<Table, Row[]>> = {}) {
  const tables: Record<Table, Row[]> = {
    clients: [],
    manufacturer_brands: [],
    manufacturer_companies: [],
    manufacturers: [],
    ...structuredClone(initial),
  };
  const writes: Write[] = [];
  let made = 0;
  /** Runs once, just before the next insert into that table: another session's change, meanwhile. */
  const meanwhile = new Map<Table, () => void>();
  /** The next insert into that table is refused with this error. */
  const refusals = new Map<Table, { code: string; message: string }>();

  function brandTree() {
    return tables.manufacturer_brands.map((brand) => ({
      id: brand.id,
      name: brand.name,
      companies: tables.manufacturer_companies
        .filter((company) => company.brand_id === brand.id)
        .map((company) => ({
          id: company.id,
          name: company.name,
          factories: tables.manufacturers
            .filter((factory) => factory.company_id === company.id)
            .map((factory) => ({ id: factory.id, factory_name: factory.factory_name ?? null, country: factory.country ?? null })),
        })),
    }));
  }

  function insert(who: Who, table: Table, values: Record<string, unknown>) {
    meanwhile.get(table)?.();
    meanwhile.delete(table);
    const refusal = refusals.get(table);
    if (refusal) {
      refusals.delete(table);
      return { data: null, error: refusal };
    }
    const row: Row = { id: `${table}-${++made}`, ...values };
    const missingParent =
      (table === "manufacturer_companies" && !tables.manufacturer_brands.some((brand) => brand.id === row.brand_id)) ||
      (table === "manufacturers" && !tables.manufacturer_companies.some((company) => company.id === row.company_id));
    if (missingParent) return { data: null, error: { code: "23503", message: "violates foreign key constraint" } };
    if (tables[table].some((other) => UNIQUE[table](row, other))) {
      return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
    }
    tables[table].push(row);
    writes.push({ who, table, action: "insert", values });
    return { data: row, error: null };
  }

  function client(who: Who) {
    return {
      from: (table: Table) => ({
        select: () => Promise.resolve({ data: table === "manufacturer_brands" ? brandTree() : tables[table].map(({ id, name }) => ({ id, name })), error: null }),
        insert: (values: Record<string, unknown>) => ({
          select: () => ({ single: () => Promise.resolve(insert(who, table, values)) }),
        }),
        delete: () => ({
          eq: (_column: string, id: string) => {
            tables[table] = tables[table].filter((row) => row.id !== id);
            writes.push({ who, table, action: "delete", values: { id } });
            return Promise.resolve({ error: null });
          },
        }),
      }),
    };
  }

  return { tables, writes, meanwhile, refusals, user: client("user"), admin: client("admin"), add: (table: Table, row: Row) => tables[table].push(row) };
}

let db: ReturnType<typeof database>;

function use(next: ReturnType<typeof database>, { secretKey = true } = {}) {
  db = next;
  vi.mocked(createClient).mockResolvedValue(db.user as never);
  vi.mocked(isAdminClientConfigured).mockReturnValue(secretKey);
  vi.mocked(createAdminClient).mockReturnValue(db.admin as never);
}

const INSPECTOR = {
  id: "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e",
  email: "inspector@test.local",
  fullName: null,
  role: "inspector" as const,
  grant: { id: "r1", name: "Inspector", builtIn: "inspector" as const, access: "own" as const, permissions: ["create_inspections", "ai_reading"] },
};

/** Brand A: Company A Sdn. Bhd., factories F-1 and F-2. Brand B: Brand B Sdn. Bhd., one factory without a name. */
const MANUFACTURERS: Partial<Record<Table, Row[]>> = {
  manufacturer_brands: [
    { id: "brand-a", name: "Brand A" },
    { id: "brand-b", name: "Brand B" },
  ],
  manufacturer_companies: [
    { id: "company-a", brand_id: "brand-a", name: "Company A Sdn. Bhd." },
    { id: "company-b", brand_id: "brand-b", name: "Brand B Sdn. Bhd." },
  ],
  manufacturers: [
    { id: "factory-1", company_id: "company-a", factory_name: "F-1", country: "Malaysia", name: "Company A Sdn. Bhd." },
    { id: "factory-2", company_id: "company-a", factory_name: "F-2", country: "Malaysia", name: "Company A Sdn. Bhd." },
    { id: "factory-b", company_id: "company-b", factory_name: null, country: "Thailand", name: "Brand B Sdn. Bhd." },
  ],
};

const manufacturer = (fields: Partial<Record<"brand" | "company" | "factory" | "address" | "country", string>>) => ({
  brand: "",
  company: "",
  factory: "",
  address: "",
  country: "",
  ...fields,
});

/** Everything logged, as one string: names typed must never be in it. */
const logged = () => JSON.stringify(vi.mocked(console.error).mock.calls);

beforeEach(() => {
  vi.mocked(authorizeAction).mockResolvedValue({ ok: true, user: INSPECTOR });
  vi.spyOn(console, "error").mockImplementation(() => {});
  use(database({ clients: [{ id: "client-1", name: "Test Buyer" }], ...MANUFACTURERS }));
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * New Client
 * ------------------------------------------------------------------ */

describe("New Client (addClientFromDocument)", () => {
  it("is for a role that creates inspections: anyone else is refused before anything is read", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });
    expect(await addClientFromDocument({ name: "New Buyer Sdn. Bhd." })).toEqual({ status: "error", message: "You do not have permission to do that." });
    expect(authorizeAction).toHaveBeenCalledWith({ permission: "create_inspections" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("refuses a blank name with the admin screen's words, writing nothing", async () => {
    expect(await addClientFromDocument({ name: "   " })).toEqual({
      status: "error",
      message: CHECK_FIELDS,
      fieldErrors: { name: "Enter the client's name." },
    });
    expect(await addClientFromDocument({ name: "x".repeat(121) })).toMatchObject({ fieldErrors: { name: "Keep the name to 120 characters or fewer." } });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("adds a new client with the secret key, its name on one line, and answers it for the picker", async () => {
    expect(await addClientFromDocument({ name: "  New   Buyer Sdn. Bhd. " })).toEqual({
      status: "added",
      option: { id: "clients-1", label: "New Buyer Sdn. Bhd." },
      note: NOTES.clientAdded,
    });
    expect(db.writes).toEqual([{ who: "admin", table: "clients", action: "insert", values: { name: "New Buyer Sdn. Bhd." } }]);
  });

  it("chooses the listed client a name reads like, case, punctuation and legal suffix aside, adding nothing", async () => {
    expect(await addClientFromDocument({ name: "TEST BUYER SDN. BHD." })).toEqual({
      status: "listed",
      option: { id: "client-1", label: "Test Buyer" },
      note: NOTES.listed,
    });
    expect(db.writes).toEqual([]);
  });

  it("chooses the client someone else added meanwhile: the unique index refuses a second one", async () => {
    db.meanwhile.set("clients", () => db.add("clients", { id: "theirs", name: "new buyer sdn. bhd." }));
    expect(await addClientFromDocument({ name: "New Buyer Sdn. Bhd." })).toEqual({
      status: "listed",
      option: { id: "theirs", label: "new buyer sdn. bhd." },
      note: NOTES.listed,
    });
    expect(db.tables.clients.map((client) => client.id)).toEqual(["client-1", "theirs"]);
  });

  it("adds nothing when several listed clients read like the name", async () => {
    use(database({ clients: [{ id: "c1", name: "Twin Buyer Sdn. Bhd." }, { id: "c2", name: "Twin Buyer Pte. Ltd." }] }));
    expect(await addClientFromDocument({ name: "Twin Buyer" })).toEqual({ status: "error", message: SEVERAL_CLIENTS, fieldErrors: { name: SEVERAL_CLIENTS } });
    expect(db.writes).toEqual([]);
  });

  it("writes through the caller's own session on a server without the key, and says who can add it when that is refused", async () => {
    use(database(), { secretKey: false });
    db.refusals.set("clients", { code: "42501", message: 'new row violates row-level security policy for table "clients"' });
    expect(await addClientFromDocument({ name: "New Buyer Sdn. Bhd." })).toEqual({ status: "error", message: NO_SWITCH.client });
    expect(createAdminClient).not.toHaveBeenCalled();
    // Logged by its code, never with the name typed.
    expect(logged()).toContain("42501");
    expect(logged()).not.toContain("New Buyer");

    use(database(), { secretKey: false });
    expect(await addClientFromDocument({ name: "New Buyer Sdn. Bhd." })).toMatchObject({ status: "added" });
    expect(db.writes[0].who).toBe("user");
  });

  it("turns an unexpected failure into a message", async () => {
    vi.mocked(createClient).mockRejectedValue(new Error("fetch failed"));
    expect(await addClientFromDocument({ name: "New Buyer Sdn. Bhd." })).toEqual({ status: "error", message: NOT_ADDED.client });
  });
});

/* ------------------------------------------------------------------ *
 * New Manufacturer
 * ------------------------------------------------------------------ */

describe("New Manufacturer (addManufacturerFromDocument)", () => {
  it("is for a role that creates inspections: anyone else is refused before anything is read", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "Your session has ended. Sign in again." });
    expect(await addManufacturerFromDocument(manufacturer({ brand: "New Brand", company: "New Brand Sdn. Bhd." }))).toEqual({
      status: "error",
      message: "Your session has ended. Sign in again.",
    });
    expect(authorizeAction).toHaveBeenCalledWith({ permission: "create_inspections" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("needs the brand and the company, as Admin > Manufacturers does, writing nothing without them", async () => {
    expect(await addManufacturerFromDocument(manufacturer({}))).toEqual({
      status: "error",
      message: CHECK_FIELDS,
      fieldErrors: { brand: "Enter the brand's name.", company: "Enter the company's name." },
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("adds only the factory under a listed company, leaving manufacturers.name to its trigger", async () => {
    const result = await addManufacturerFromDocument(
      manufacturer({ brand: "Brand A", company: "COMPANY A SDN BHD", factory: " F-40 ", address: "Lot 1\r\nPlaceholder Park ", country: "Malaysia" }),
    );
    expect(result).toMatchObject({
      status: "added",
      option: { id: "manufacturers-1", label: "Brand A · F-40" },
      note: "Added the factory F-40 to Company A Sdn. Bhd. (Brand A).",
    });
    expect(db.writes).toEqual([
      {
        who: "admin",
        table: "manufacturers",
        action: "insert",
        values: { company_id: "company-a", factory_name: "F-40", address: "Lot 1\nPlaceholder Park", country: "Malaysia" },
      },
    ]);
    // The brands, companies and factories as they are now, for the next New Manufacturer.
    expect(result.status === "added" && result.directory.factories.map((factory) => factory.id)).toContain("manufacturers-1");
  });

  it("adds a company under the listed brand its brand reads like, with the factory", async () => {
    expect(await addManufacturerFromDocument(manufacturer({ brand: "brand a", company: "Brand A Gloves Sdn. Bhd.", factory: "F-9" }))).toMatchObject({
      status: "added",
      option: { label: "Brand A · F-9" },
      note: "Added the company Brand A Gloves Sdn. Bhd. to the brand Brand A, with the factory F-9.",
    });
    expect(db.writes.map(({ table, values }) => [table, values])).toEqual([
      ["manufacturer_companies", { brand_id: "brand-a", name: "Brand A Gloves Sdn. Bhd." }],
      ["manufacturers", { company_id: "manufacturer_companies-1", factory_name: "F-9", address: null, country: null }],
    ]);
  });

  it("adds the brand, its company and factory when none is listed: a company named alone is labelled by itself", async () => {
    expect(await addManufacturerFromDocument(manufacturer({ brand: "New Gloves", company: "New Gloves Sdn. Bhd." }))).toMatchObject({
      status: "added",
      option: { label: "New Gloves Sdn. Bhd." },
      note: "Added the brand New Gloves, its company New Gloves Sdn. Bhd. and its factory.",
    });
    expect(db.writes.map(({ table }) => table)).toEqual(["manufacturer_brands", "manufacturer_companies", "manufacturers"]);
  });

  it("chooses a listed factory, adding nothing", async () => {
    expect(await addManufacturerFromDocument(manufacturer({ brand: "Brand A", company: "Company A", factory: "f1" }))).toMatchObject({
      status: "listed",
      option: { id: "factory-1", label: "Brand A · F-1" },
      note: NOTES.listed,
    });
    expect(db.writes).toEqual([]);
  });

  it("asks for the factory where the company has several and none is named", async () => {
    const words = "Company A Sdn. Bhd. has 2 factories in the list. Choose one under Manufacturer, or enter the factory to add it.";
    expect(await addManufacturerFromDocument(manufacturer({ brand: "Brand A", company: "Company A Sdn. Bhd." }))).toEqual({
      status: "error",
      message: words,
      fieldErrors: { factory: words },
    });
    expect(db.writes).toEqual([]);
  });

  it("reuses a company added meanwhile under a brand of its own, and takes back the brand it had just added", async () => {
    db.meanwhile.set("manufacturer_companies", () => {
      db.add("manufacturer_brands", { id: "their-brand", name: "Their Brand" });
      db.add("manufacturer_companies", { id: "their-company", brand_id: "their-brand", name: "New Gloves Sdn. Bhd." });
    });
    expect(await addManufacturerFromDocument(manufacturer({ brand: "New Gloves", company: "New Gloves Sdn. Bhd.", factory: "Plant 1" }))).toMatchObject({
      status: "added",
      option: { label: "Their Brand · Plant 1" },
    });
    expect(db.writes.map(({ table, action }) => `${action} ${table}`)).toEqual([
      "insert manufacturer_brands",
      "delete manufacturer_brands",
      "insert manufacturers",
    ]);
    expect(db.tables.manufacturer_brands.map((brand) => brand.name)).toEqual(["Brand A", "Brand B", "Their Brand"]);
  });

  it("chooses the factory someone else added meanwhile", async () => {
    db.meanwhile.set("manufacturers", () => db.add("manufacturers", { id: "their-factory", company_id: "company-a", factory_name: "f-40" }));
    expect(await addManufacturerFromDocument(manufacturer({ brand: "Brand A", company: "Company A Sdn. Bhd.", factory: "F-40" }))).toMatchObject({
      status: "listed",
      option: { id: "their-factory" },
    });
  });

  it("puts a refusal in plain words, logged by its code alone", async () => {
    use(database(MANUFACTURERS), { secretKey: false });
    db.refusals.set("manufacturer_brands", { code: "42501", message: "new row violates row-level security policy" });
    expect(await addManufacturerFromDocument(manufacturer({ brand: "Secret Gloves", company: "Secret Gloves Sdn. Bhd." }))).toEqual({
      status: "error",
      message: NO_SWITCH.manufacturer,
    });
    expect(logged()).toContain("42501");
    expect(logged()).not.toContain("Secret Gloves");

    db.refusals.set("manufacturers", { code: "XX000", message: "internal error" });
    expect(await addManufacturerFromDocument(manufacturer({ brand: "Brand A", company: "Company A Sdn. Bhd.", factory: "F-41" }))).toEqual({
      status: "error",
      message: NOT_ADDED.manufacturer,
    });
  });
});
