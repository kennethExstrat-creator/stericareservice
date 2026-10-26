// Preview of an Excel or CSV Source Document through its Route Handlers
// (sheets.ts; Kenneth, 26 October 2026): who may see it, what it reads with,
// and the table's cap. The session and Supabase are faked: a query records
// its filters and answers the row, the bucket answers the stored file.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import type { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { GET } from "@/app/api/inspections/[id]/files/[fileId]/sheets/route";
import { POST } from "@/app/api/sheets/route";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_COLUMNS, PREVIEW_ROWS, SpreadsheetPreviewResultSchema } from "./preview";

const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const FILE = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const MB = 1024 * 1024;

type Session = Awaited<ReturnType<typeof getSession>>;
const INSPECTOR: Session = {
  status: "active",
  user: { id: "inspector-id", email: "inspector@test.local", fullName: "Inspector A", role: "inspector" },
};

/** 250 rows by 40 columns of cartons, from A1. */
function largeWorkbook(): Uint8Array<ArrayBuffer> {
  const rows = Array.from({ length: 250 }, (_, row) => Array.from({ length: 40 }, (_, column) => `R${row + 1}C${column + 1}`));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Cartons");
  return new Uint8Array(XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }));
}

type Stored = {
  row: { storage_path: string } | null;
  rowError?: { code: string; message: string };
  blob?: Blob;
  downloadError?: { message: string };
};

let seen: { table: string; filters: unknown[][]; bucket: string; path: string };

function useStorage(stored: Stored) {
  seen = { table: "", filters: [], bucket: "", path: "" };
  const query = {
    select: () => query,
    eq: (...filter: unknown[]) => {
      seen.filters.push(filter);
      return query;
    },
    maybeSingle: async () => ({ data: stored.row, error: stored.rowError ?? null }),
  };
  const client = {
    from: (table: string) => {
      seen.table = table;
      return query;
    },
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          seen.bucket = bucket;
          seen.path = path;
          return stored.downloadError ? { data: null, error: stored.downloadError } : { data: stored.blob ?? null, error: null };
        },
      }),
    },
  };
  vi.mocked(createClient).mockResolvedValue(client as never);
}

async function get(inspectionId = INSPECTION, fileId = FILE) {
  const request = new Request(`http://localhost/api/inspections/${inspectionId}/files/${fileId}/sheets`) as unknown as NextRequest;
  const response = await GET(request, { params: Promise.resolve({ id: inspectionId, fileId }) });
  return { status: response.status, headers: response.headers, body: SpreadsheetPreviewResultSchema.parse(await response.json()) };
}

async function post(parts: BlobPart[] | null, name = "Order.csv", type = "text/csv") {
  const body = new FormData();
  if (parts) body.append("file", new File(parts, name, { type }), name);
  const request = new Request("http://localhost/api/sheets", { method: "POST", body }) as unknown as NextRequest;
  const response = await POST(request);
  return { status: response.status, body: SpreadsheetPreviewResultSchema.parse(await response.json()) };
}

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue(INSPECTOR);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("who may see a spreadsheet", () => {
  it("checks the session first, reading nothing for a caller signed out or not active", async () => {
    vi.mocked(getSession).mockResolvedValue({ status: "signed-out" });
    expect(await get()).toMatchObject({ status: 401, body: { status: "error", message: "Your session has ended. Sign in again." } });
    expect(await post(["Size,Cases\n"])).toMatchObject({ status: 401 });
    vi.mocked(getSession).mockResolvedValue({ status: "deactivated" } as Session);
    expect(await get()).toMatchObject({ status: 403, body: { message: "This account has been deactivated." } });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("answers 404 to ids that are no ids, before reading anything", async () => {
    expect(await get("nope")).toMatchObject({ status: 404, body: { message: "That file is not available." } });
    expect(await get(INSPECTION, "..%2Fother")).toMatchObject({ status: 404 });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("reads with the caller's own client: a file Row Level Security hides answers 404, as one that does not exist", async () => {
    useStorage({ row: null });
    expect(await get()).toMatchObject({ status: 404, body: { message: "That file is not available." } });
    expect(seen).toMatchObject({ table: "inspection_files", filters: [["id", FILE], ["inspection_id", INSPECTION]], path: "" });
  });
});

describe("a stored spreadsheet's table", () => {
  it("shows at most 200 rows and 30 columns of each sheet, with its whole size, never cached", async () => {
    const path = `${INSPECTION}/${FILE}.xlsx`;
    useStorage({ row: { storage_path: path }, blob: new Blob([largeWorkbook()]) });
    const { status, headers, body } = await get();
    expect(status).toBe(200);
    expect(headers.get("cache-control")).toBe("private, no-store");
    expect(seen).toMatchObject({ bucket: "inspection-files", path });
    if (body.status !== "ready") throw new Error(body.message);
    const [sheet] = body.sheets;
    expect(sheet.name).toBe("Cartons");
    expect(sheet.rows).toHaveLength(PREVIEW_ROWS);
    expect(sheet.rows.every((row) => row.length === PREVIEW_COLUMNS)).toBe(true);
    expect(sheet).toMatchObject({ totalRows: 250, totalColumns: 40 });
  });

  it("knows a stored CSV by its object name", async () => {
    useStorage({ row: { storage_path: `${INSPECTION}/${FILE}.csv` }, blob: new Blob(["Size,Cases\nM,20\n"]) });
    expect(await get()).toMatchObject({ status: 200, body: { status: "ready", sheets: [{ name: "", rows: [["Size", "Cases"], ["M", "20"]] }] } });
  });

  it("says when a file is no spreadsheet, too large to show, or cannot be opened", async () => {
    useStorage({ row: { storage_path: `${INSPECTION}/${FILE}.pdf` }, blob: new Blob(["%PDF-1.7\n"]) });
    expect(await get()).toMatchObject({
      status: 415,
      body: { message: "This file is not an Excel or CSV file the app can show. Download it to open it." },
    });
    useStorage({ row: { storage_path: `${INSPECTION}/${FILE}.csv` }, blob: new Blob([new Uint8Array(10 * MB + 1).fill(0x61)]) });
    expect(await get()).toMatchObject({
      status: 413,
      body: { message: "The spreadsheet is larger than 10 MB, too large to show here. Download it to open it." },
    });
    useStorage({ row: { storage_path: `${INSPECTION}/${FILE}.csv` }, blob: new Blob([" ,\n"]) });
    expect(await get()).toMatchObject({ status: 422, body: { message: "This spreadsheet is empty." } });
  });

  it("answers 503 when the file cannot be read, and logs why", async () => {
    useStorage({ row: { storage_path: `${INSPECTION}/${FILE}.xlsx` }, downloadError: { message: "Object not found" } });
    expect(await get()).toMatchObject({ status: 503, body: { message: "The spreadsheet could not be shown. Try again, or download it." } });
    useStorage({ row: null, rowError: { code: "500", message: "boom" } });
    expect(await get()).toMatchObject({ status: 503 });
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

describe("a spreadsheet New Inspection holds before Create", () => {
  it("shows one sent with the request, a CSV whatever type Windows gave it, without touching storage", async () => {
    expect(await post(["Size,Cases\nM,20\n"], "Order.csv", "application/vnd.ms-excel")).toMatchObject({
      status: 200,
      body: { status: "ready", sheets: [{ rows: [["Size", "Cases"], ["M", "20"]] }] },
    });
    expect(await post([largeWorkbook()], "Cartons.xlsx", "")).toMatchObject({ status: 200, body: { status: "ready" } });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("takes up to 4 MB, a request's limit, and a file only", async () => {
    expect(await post([new Uint8Array(4 * MB + 1).fill(0x61)], "Cartons.csv")).toMatchObject({
      status: 413,
      body: { message: "The file is larger than 4 MB: it can be shown once the inspection is created." },
    });
    expect(await post(null)).toMatchObject({ status: 400, body: { message: "Choose a file to show." } });
  });
});
