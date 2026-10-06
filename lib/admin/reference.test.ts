import { notFound } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ABANDONED_UPLOAD_MS,
  ClientInputSchema,
  EditTargetSchema,
  LOGO_ACCEPT,
  LOGO_MAX_BYTES,
  LogoConfirmSchema,
  LogoUploadRequestSchema,
  MESSAGES,
  ManufacturerInputSchema,
  describeDeleteError,
  describeSaveError,
  deleteBlocker,
  fieldErrors,
  formatMegabytes,
  guarded,
  isInUse,
  isLogoOf,
  isLogoType,
  loadClients,
  loadManufacturers,
  logoFileExists,
  logoFileProblem,
  logoObjectName,
  manufacturerLabel,
  matchesSearch,
  multiLine,
  normaliseForSearch,
  oneLine,
  parseLogoObjectName,
  readClient,
  readForm,
  readManufacturer,
  removeLogoFiles,
  removeUnusedLogos,
  searchText,
  unreachable,
  usageText,
  type DatabaseClient,
} from "./reference";

const CLIENT = "2b0e7c4e-5d6f-4a1b-9c8d-7e6f5a4b3c2d";
const OTHER_CLIENT = "9f8e7d6c-5b4a-4392-8170-6e5d4c3b2a19";
const FILE = "0d1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a";

/* ------------------------------------------------------------------ *
 * A fake Supabase client: every query records its chain and resolves to
 * what the test's responder returns; Storage calls are spies.
 * ------------------------------------------------------------------ */

type Result = { data: unknown; error: unknown };
type Query = { table: string; calls: Array<[string, unknown[]]> };

function fakeClient(respond: (query: Query) => Result = () => ({ data: [], error: null })) {
  const queries: Query[] = [];
  const from = vi.fn((table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq", "limit"]) {
      builder[method] = (...args: unknown[]) => {
        query.calls.push([method, args]);
        return builder;
      };
    }
    builder.maybeSingle = () => {
      query.calls.push(["maybeSingle", []]);
      return Promise.resolve(respond(query));
    };
    builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(respond(query)).then(resolve, reject);
    return builder;
  });
  const bucket = {
    createSignedUrls: vi.fn(async (paths: string[]) => ({
      data: paths.map((path) => ({
        path,
        signedUrl: `https://storage.example/${path}?token=t`,
        error: null as string | null,
      })),
      error: null as unknown,
    })),
    list: vi.fn(async (): Promise<Result> => ({ data: [], error: null })),
    remove: vi.fn(async (): Promise<Result> => ({ data: [], error: null })),
  };
  const storage = { from: vi.fn(() => bucket) };
  return { client: { from, storage } as unknown as DatabaseClient, queries, bucket, storage };
}

const usageColumns = (templates: number, inspections: number) => ({
  templates: [{ count: templates }],
  inspections: [{ count: inspections }],
});

/** A file in a Storage listing, created `ageMs` before NOW. */
const NOW = Date.parse("2026-10-06T12:00:00Z");
const stored = (name: string, ageMs: number) => ({
  name,
  id: `id-${name}`,
  created_at: new Date(NOW - ageMs).toISOString(),
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * Form input
 * ------------------------------------------------------------------ */

describe("text clean-up", () => {
  it("makes one line of a name: single spaces, no pasted line breaks, trimmed", () => {
    expect(oneLine("  Terang \t Nusa\r\nSdn.  Bhd. ")).toBe("Terang Nusa Sdn. Bhd.");
  });

  it("keeps the lines of an address but drops trailing spaces and blank ends", () => {
    expect(multiLine("\n  Lot 1, Jalan Contoh   \r\n43900 Sepang\r\n\n")).toBe("Lot 1, Jalan Contoh\n43900 Sepang");
  });
});

describe("ManufacturerInputSchema", () => {
  const valid = { name: "Hartalega NGC", factory_name: "", address: "", country: "", notes: "" };

  it("cleans the fields and stores empty ones as null", () => {
    const parsed = ManufacturerInputSchema.parse({
      name: "  Terang   Nusa Sdn. Bhd. ",
      factory_name: " TG Factory 40 ",
      address: "Lot 67330  \r\nKlang\n",
      country: " Malaysia",
      notes: "   ",
    });
    expect(parsed).toEqual({
      name: "Terang Nusa Sdn. Bhd.",
      factory_name: "TG Factory 40",
      address: "Lot 67330\nKlang",
      country: "Malaysia",
      notes: null,
    });
  });

  it("needs a name", () => {
    const result = ManufacturerInputSchema.safeParse({ ...valid, name: "   " });
    expect(result.success).toBe(false);
    expect(fieldErrors(result.error!)).toEqual({ name: "Enter the manufacturer's name." });
  });

  it("caps each field and says how long it may be", () => {
    const result = ManufacturerInputSchema.safeParse({
      ...valid,
      name: "x".repeat(121),
      notes: "y".repeat(2001),
    });
    expect(fieldErrors(result.error!)).toEqual({
      name: "Keep the name to 120 characters or fewer.",
      notes: "Keep the notes to 2,000 characters or fewer.",
    });
  });

  it("measures the cleaned value, not what was pasted", () => {
    expect(ManufacturerInputSchema.safeParse({ ...valid, name: `  ${"x".repeat(120)}  ` }).success).toBe(true);
  });
});

describe("ClientInputSchema", () => {
  it("cleans the name and notes", () => {
    expect(ClientInputSchema.parse({ name: " Polyco  Healthline ", notes: "" })).toEqual({
      name: "Polyco Healthline",
      notes: null,
    });
  });

  it("needs a name", () => {
    const result = ClientInputSchema.safeParse({ name: "", notes: "Some notes" });
    expect(fieldErrors(result.error!)).toEqual({ name: "Enter the client's name." });
  });
});

describe("EditTargetSchema", () => {
  const version = "2026-10-06T10:45:02.066067+00:00";

  it("adds without an id or version", () => {
    expect(EditTargetSchema.parse({ id: "", version: "" })).toEqual({ id: "", version: "" });
  });

  it("edits with an id and the version the form started from", () => {
    expect(EditTargetSchema.parse({ id: CLIENT, version })).toEqual({ id: CLIENT, version });
  });

  it("accepts seeded ids that are not version 4 uuids", () => {
    expect(EditTargetSchema.safeParse({ id: "10000000-0000-0000-0000-000000000001", version }).success).toBe(true);
  });

  it.each([
    ["an id without a version", { id: CLIENT, version: "" }],
    ["a version without an id", { id: "", version }],
    ["an id that is not a uuid", { id: "1; drop table clients", version }],
    ["a version that is not a timestamp", { id: CLIENT, version: "yesterday" }],
  ])("refuses %s", (_label, target) => {
    const result = EditTargetSchema.safeParse(target);
    expect(result.success).toBe(false);
  });
});

describe("readForm", () => {
  it("reads text fields and treats missing fields and files as empty", () => {
    const form = new FormData();
    form.set("name", "Hartalega");
    form.set("notes", new File(["x"], "notes.txt"));
    expect(readForm(form, ["name", "notes", "country"])).toEqual({ name: "Hartalega", notes: "", country: "" });
  });
});

describe("fieldErrors", () => {
  it("keeps the first message for each field", () => {
    const result = ManufacturerInputSchema.safeParse({ name: "", factory_name: "x".repeat(200) });
    expect(fieldErrors(result.error!)).toMatchObject({ name: "Enter the manufacturer's name." });
    expect(Object.keys(fieldErrors(result.error!))).toEqual(
      expect.arrayContaining(["name", "factory_name", "address", "country", "notes"]),
    );
  });
});

/* ------------------------------------------------------------------ *
 * Action results
 * ------------------------------------------------------------------ */

describe("guarded", () => {
  it("returns what the action returns", async () => {
    await expect(guarded("test", async () => ({ status: "success" as const, message: "Saved." }))).resolves.toEqual({
      status: "success",
      message: "Saved.",
    });
  });

  it("turns an unexpected failure into a message and logs it", async () => {
    const result = await guarded("test", async () => {
      throw new Error("connection reset");
    });
    expect(result).toEqual({ status: "error", message: MESSAGES.unexpected });
    expect(console.error).toHaveBeenCalled();
  });

  it("lets Next.js control flow through", async () => {
    await expect(
      guarded("test", async () => {
        notFound();
      }),
    ).rejects.toThrow();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("unreachable", () => {
  it("answers a call that never reached the server", () => {
    expect(unreachable(new TypeError("Failed to fetch"))).toEqual({ status: "error", message: MESSAGES.unreachable });
  });
});

/* ------------------------------------------------------------------ *
 * Usage and errors
 * ------------------------------------------------------------------ */

describe("usage", () => {
  it.each([
    [{ templates: 0, inspections: 0 }, "Not in use", false],
    [{ templates: 1, inspections: 0 }, "1 template", true],
    [{ templates: 0, inspections: 1 }, "1 inspection", true],
    [{ templates: 2, inspections: 1450 }, "2 templates and 1,450 inspections", true],
  ])("%o reads %s", (usage, text, inUse) => {
    expect(usageText(usage)).toBe(text);
    expect(isInUse(usage)).toBe(inUse);
  });

  it("explains why a row in use cannot be deleted", () => {
    expect(deleteBlocker({ templates: 1, inspections: 3 })).toBe(
      "Used by 1 template and 3 inspections, so it cannot be deleted.",
    );
    expect(deleteBlocker({ templates: 0, inspections: 0 })).toBeNull();
  });
});

describe("database errors", () => {
  it("puts a duplicate next to the name", () => {
    expect(describeSaveError("manufacturer", { code: "23505" })).toEqual({
      field: "name",
      message: "There is already a manufacturer with this name and factory.",
    });
    expect(describeSaveError("client", { code: "23505" })).toEqual({
      field: "name",
      message: "There is already a client with this name.",
    });
  });

  it("explains a refusal and anything else in plain words", () => {
    expect(describeSaveError("client", { code: "42501" }).message).toMatch(/^Only active admins can change clients/);
    expect(describeSaveError("client", { code: "XX000" })).toEqual({
      message: "The client could not be saved. Try again.",
    });
  });

  it("says a row in use cannot be deleted, for both codes Postgres uses", () => {
    for (const code of ["23503", "23001"]) {
      expect(describeDeleteError("manufacturer", { code })).toBe(
        "Templates or inspections use this manufacturer, so it cannot be deleted.",
      );
    }
    expect(describeDeleteError("client", { code: "XX000" })).toBe("The client could not be deleted. Try again.");
  });
});

describe("manufacturerLabel", () => {
  it("names the factory when there is one", () => {
    expect(manufacturerLabel({ name: "Terang Nusa Sdn. Bhd.", factoryName: "TG Factory 40" })).toBe(
      "Terang Nusa Sdn. Bhd., TG Factory 40",
    );
    expect(manufacturerLabel({ name: "Hartalega NGC", factoryName: null })).toBe("Hartalega NGC");
  });
});

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

describe("search", () => {
  const text = searchText("Terang Nusa Sdn. Bhd.", "TG Factory 40", null, "Lot 67330, Klang", undefined);

  it("ignores case, accents and extra spaces", () => {
    expect(normaliseForSearch("  Hártalega   NGC ")).toBe("hartalega ngc");
    expect(matchesSearch(searchText("Société Générale"), "societe gen")).toBe(true);
  });

  it("finds every word of the query in any field, in any order", () => {
    expect(matchesSearch(text, "factory 40 terang")).toBe(true);
    expect(matchesSearch(text, "klang")).toBe(true);
    expect(matchesSearch(text, "terang sepang")).toBe(false);
  });

  it("shows everything for an empty query", () => {
    expect(matchesSearch(text, "   ")).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Client logos
 * ------------------------------------------------------------------ */

describe("logo files", () => {
  it("takes what the bucket takes, and nothing else", () => {
    expect(LOGO_ACCEPT).toBe("image/png,image/jpeg,image/webp");
    expect(isLogoType("image/png")).toBe(true);
    expect(isLogoType("image/svg+xml")).toBe(false);
    expect(isLogoType("toString")).toBe(false);
  });

  it.each([
    [{ type: "image/svg+xml", size: 1000 }, "Choose a PNG, JPEG or WebP image."],
    [{ type: "image/heic", size: 1000 }, "Choose a PNG, JPEG or WebP image."],
    [{ type: "", size: 1000 }, "Choose a PNG, JPEG or WebP image."],
    [{ type: "image/png", size: 0 }, "That file is empty. Choose another image."],
    [{ type: "image/jpeg", size: LOGO_MAX_BYTES + 1 }, "That image is 2.0 MB. Choose one up to 2 MB."],
    [{ type: "image/webp", size: 3.4 * 1024 * 1024 }, "That image is 3.4 MB. Choose one up to 2 MB."],
  ])("refuses %o", (file, message) => {
    expect(logoFileProblem(file)).toBe(message);
  });

  it("accepts a logo up to exactly 2 MiB", () => {
    expect(logoFileProblem({ type: "image/webp", size: LOGO_MAX_BYTES })).toBeNull();
  });

  it("formats sizes for people", () => {
    expect(formatMegabytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
    expect(formatMegabytes(14.6 * 1024 * 1024)).toBe("15 MB");
  });
});

describe("logo object names", () => {
  it("puts each upload in the client's folder under a new name", () => {
    expect(logoObjectName(CLIENT.toUpperCase(), "image/jpeg", FILE.toUpperCase())).toBe(`${CLIENT}/${FILE}.jpg`);
    const random = logoObjectName(CLIENT, "image/png");
    expect(random).toMatch(new RegExp(`^${CLIENT}/[0-9a-f-]{36}\\.png$`));
    expect(random).not.toBe(logoObjectName(CLIENT, "image/png"));
  });

  it("reads back only names it could have made", () => {
    expect(parseLogoObjectName(`${CLIENT}/${FILE}.webp`)).toEqual({ clientId: CLIENT, fileName: `${FILE}.webp` });
    for (const name of [
      `${CLIENT}/${FILE}.svg`,
      `${CLIENT}/${FILE.toUpperCase()}.png`,
      `${CLIENT}/../${OTHER_CLIENT}/${FILE}.png`,
      `${CLIENT}/sub/${FILE}.png`,
      `${CLIENT}.png`,
      `/${CLIENT}/${FILE}.png`,
    ]) {
      expect(parseLogoObjectName(name), name).toBeNull();
    }
  });

  it("knows whose folder a name is in", () => {
    expect(isLogoOf(`${CLIENT}/${FILE}.png`, CLIENT.toUpperCase())).toBe(true);
    expect(isLogoOf(`${CLIENT}/${FILE}.png`, OTHER_CLIENT)).toBe(false);
  });

  it("validates the upload requests the browser sends", () => {
    expect(LogoUploadRequestSchema.safeParse({ clientId: CLIENT, type: "image/png", size: 10 }).success).toBe(true);
    expect(LogoUploadRequestSchema.safeParse({ clientId: CLIENT, type: "image/png", size: -1 }).success).toBe(false);
    expect(LogoUploadRequestSchema.safeParse({ clientId: "x", type: "image/png", size: 10 }).success).toBe(false);
    expect(LogoConfirmSchema.safeParse({ clientId: CLIENT, path: `${CLIENT}/${FILE}.png` }).success).toBe(true);
    expect(LogoConfirmSchema.safeParse({ clientId: CLIENT }).success).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Queries
 * ------------------------------------------------------------------ */

describe("loadManufacturers", () => {
  it("lists every manufacturer with its usage, by name and then factory", async () => {
    const { client, queries } = fakeClient(() => ({
      data: [
        { id: "c", name: "terang nusa", factory_name: "TG Factory 40", address: null, country: "Malaysia", notes: null, updated_at: "t3", ...usageColumns(0, 0) },
        { id: "b", name: "Terang Nusa", factory_name: "TG Factory 12", address: null, country: null, notes: null, updated_at: "t2", ...usageColumns(1, 4) },
        { id: "a", name: "Hartalega NGC", factory_name: null, address: "Sepang", country: "Malaysia", notes: "n", updated_at: "t1", ...usageColumns(0, 2) },
      ],
      error: null,
    }));

    const rows = await loadManufacturers(client);

    expect(queries[0].table).toBe("manufacturers");
    expect(queries[0].calls[0][1][0]).toContain("templates(count), inspections(count)");
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(rows[0]).toEqual({
      id: "a",
      name: "Hartalega NGC",
      factoryName: null,
      address: "Sepang",
      country: "Malaysia",
      notes: "n",
      updatedAt: "t1",
      usage: { templates: 0, inspections: 2 },
    });
  });

  it("fails loudly when the list cannot be read, for the error page", async () => {
    const { client } = fakeClient(() => ({ data: null, error: { message: "permission denied" } }));
    await expect(loadManufacturers(client)).rejects.toThrow("Could not load the manufacturers: permission denied");
  });
});

describe("loadClients", () => {
  it("signs every stored logo in one call and keeps the object names on the server", async () => {
    const { client, bucket, storage } = fakeClient(() => ({
      data: [
        { id: "b", name: "Zeta Medical", logo_path: `b/${FILE}.png`, notes: null, updated_at: "t2", ...usageColumns(0, 0) },
        { id: "a", name: "Polyco Healthline", logo_path: null, notes: "To confirm", updated_at: "t1", ...usageColumns(2, 0) },
      ],
      error: null,
    }));

    const rows = await loadClients(client);

    expect(storage.from).toHaveBeenCalledWith("client-logos");
    expect(bucket.createSignedUrls).toHaveBeenCalledExactlyOnceWith([`b/${FILE}.png`], 3600);
    expect(rows).toEqual([
      { id: "a", name: "Polyco Healthline", notes: "To confirm", updatedAt: "t1", usage: { templates: 2, inspections: 0 }, logo: null },
      {
        id: "b",
        name: "Zeta Medical",
        notes: null,
        updatedAt: "t2",
        usage: { templates: 0, inspections: 0 },
        logo: { url: `https://storage.example/b/${FILE}.png?token=t` },
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("logo_path");
  });

  it("does not call Storage when no client has a logo", async () => {
    const { client, bucket } = fakeClient(() => ({
      data: [{ id: "a", name: "Polyco", logo_path: null, notes: null, updated_at: "t", ...usageColumns(0, 0) }],
      error: null,
    }));
    await loadClients(client);
    expect(bucket.createSignedUrls).not.toHaveBeenCalled();
  });

  it("shows a logo whose file Storage does not have as missing, instead of failing the page", async () => {
    const { client, bucket } = fakeClient(() => ({
      data: [
        { id: "a", name: "A", logo_path: "a/gone.png", notes: null, updated_at: "t", ...usageColumns(0, 0) },
        { id: "b", name: "B", logo_path: "b/here.png", notes: null, updated_at: "t", ...usageColumns(0, 0) },
      ],
      error: null,
    }));
    bucket.createSignedUrls.mockResolvedValueOnce({
      data: [
        {
          path: "a/gone.png",
          signedUrl: null as never,
          error: "Either the object does not exist or you do not have access to it",
        },
        { path: "b/here.png", signedUrl: "https://storage.example/b/here.png?token=t", error: null },
      ],
      error: null,
    });

    const rows = await loadClients(client);
    expect(rows.map((row) => row.logo)).toEqual([
      { url: null, problem: "missing" },
      { url: "https://storage.example/b/here.png?token=t" },
    ]);
  });

  it("calls every logo unavailable, not missing, when Storage does not answer", async () => {
    const { client, bucket } = fakeClient(() => ({
      data: [
        { id: "a", name: "A", logo_path: "a/x.png", notes: null, updated_at: "t", ...usageColumns(0, 0) },
        { id: "b", name: "B", logo_path: "b/y.png", notes: null, updated_at: "t", ...usageColumns(0, 0) },
        { id: "c", name: "C", logo_path: null, notes: null, updated_at: "t", ...usageColumns(0, 0) },
      ],
      error: null,
    }));
    bucket.createSignedUrls.mockResolvedValueOnce({ data: null as never, error: { message: "fetch failed" } });

    const rows = await loadClients(client);

    expect(rows.map((row) => row.logo)).toEqual([
      { url: null, problem: "unavailable" },
      { url: null, problem: "unavailable" },
      null,
    ]);
    expect(console.error).toHaveBeenCalled();
  });

  it("calls a logo Storage left out of its answer unavailable", async () => {
    const { client, bucket } = fakeClient(() => ({
      data: [{ id: "a", name: "A", logo_path: "a/x.png", notes: null, updated_at: "t", ...usageColumns(0, 0) }],
      error: null,
    }));
    bucket.createSignedUrls.mockResolvedValueOnce({ data: [], error: null });
    const rows = await loadClients(client);
    expect(rows[0].logo).toEqual({ url: null, problem: "unavailable" });
  });
});

describe("readManufacturer and readClient", () => {
  it("read one row with its usage", async () => {
    const { client, queries } = fakeClient(() => ({
      data: { id: CLIENT, name: "Polyco", logo_path: `${CLIENT}/${FILE}.png`, ...usageColumns(1, 2) },
      error: null,
    }));
    await expect(readClient(client, CLIENT)).resolves.toEqual({
      id: CLIENT,
      name: "Polyco",
      logoPath: `${CLIENT}/${FILE}.png`,
      usage: { templates: 1, inspections: 2 },
    });
    expect(queries[0].calls).toContainEqual(["eq", ["id", CLIENT]]);
  });

  it("answer null for a row that does not exist", async () => {
    const { client } = fakeClient(() => ({ data: null, error: null }));
    await expect(readManufacturer(client, CLIENT)).resolves.toBeNull();
  });

  it("throw on a database error", async () => {
    const { client } = fakeClient(() => ({ data: null, error: { message: "timeout" } }));
    await expect(readManufacturer(client, CLIENT)).rejects.toThrow("timeout");
  });
});

describe("logoFileExists", () => {
  it("looks for the exact file in the client's folder", async () => {
    const { client, bucket } = fakeClient();
    bucket.list.mockResolvedValueOnce({ data: [stored(`${FILE}.png`, 0), stored(`${FILE}.png.bak`, 0)], error: null });
    await expect(logoFileExists(client, `${CLIENT}/${FILE}.png`)).resolves.toBe(true);
    expect(bucket.list).toHaveBeenCalledWith(CLIENT, { limit: 10, search: `${FILE}.png` });
  });

  it("is false for a missing file, and never lists for a name it could not have made", async () => {
    const { client, bucket } = fakeClient();
    await expect(logoFileExists(client, `${CLIENT}/${FILE}.png`)).resolves.toBe(false);
    await expect(logoFileExists(client, `../${FILE}.png`)).resolves.toBe(false);
    expect(bucket.list).toHaveBeenCalledOnce();
  });
});

describe("removeUnusedLogos", () => {
  const current = `${CLIENT}/${FILE}.png`;
  const previous = `${CLIENT}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;

  it("removes the replaced logo and uploads abandoned for over an hour, never the current or a fresh one", async () => {
    const { client, bucket } = fakeClient(() => ({ data: [], error: null }));
    bucket.list.mockResolvedValueOnce({
      data: [
        stored(`${FILE}.png`, 2 * ABANDONED_UPLOAD_MS),
        stored("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg", 0),
        stored("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png", 2 * ABANDONED_UPLOAD_MS),
        stored("cccccccc-cccc-4ccc-8ccc-cccccccccccc.png", ABANDONED_UPLOAD_MS / 2),
        { name: "folder", id: null, created_at: null },
      ],
      error: null,
    });

    await removeUnusedLogos(client, CLIENT, { keep: current, previous, now: NOW });

    expect(bucket.remove).toHaveBeenCalledExactlyOnceWith([
      previous,
      `${CLIENT}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png`,
    ]);
  });

  it("keeps a previous logo another client points at", async () => {
    const { client, bucket, queries } = fakeClient((query) =>
      query.table === "clients" ? { data: [{ id: OTHER_CLIENT }], error: null } : { data: [], error: null },
    );
    await removeUnusedLogos(client, CLIENT, { keep: null, previous: "shared/logo.png", now: NOW });
    expect(queries[0].calls).toContainEqual(["neq", ["id", CLIENT]]);
    expect(bucket.remove).not.toHaveBeenCalled();
  });

  it("logs a failure instead of failing the change it tidies up after", async () => {
    const { client, bucket } = fakeClient(() => ({ data: [], error: null }));
    bucket.list.mockResolvedValueOnce({ data: null, error: { message: "unavailable" } });
    await expect(removeUnusedLogos(client, CLIENT, { keep: null, previous, now: NOW })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("removeLogoFiles", () => {
  it("empties a deleted client's folder and removes a logo stored elsewhere", async () => {
    const { client, bucket } = fakeClient(() => ({ data: [], error: null }));
    bucket.list.mockResolvedValueOnce({ data: [stored(`${FILE}.png`, 0)], error: null });
    await removeLogoFiles(client, CLIENT, `${CLIENT}.png`);
    expect(bucket.remove).toHaveBeenCalledExactlyOnceWith([`${CLIENT}/${FILE}.png`, `${CLIENT}.png`]);
  });

  it("does nothing when there are no files", async () => {
    const { client, bucket } = fakeClient(() => ({ data: [], error: null }));
    await removeLogoFiles(client, CLIENT, null);
    expect(bucket.remove).not.toHaveBeenCalled();
  });
});
