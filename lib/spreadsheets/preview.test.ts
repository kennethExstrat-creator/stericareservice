// Preview's table of a spreadsheet (preview.ts): what the browser makes of
// the server's answer, Excel's column letters, and the line that says what
// the table leaves out.
import { afterEach, describe, expect, it, vi } from "vitest";
import { columnLetters, fetchSheets, HELD_SHEETS_URL, previewNote, storedSheetsUrl, type SheetPreview } from "./preview";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchSheets", () => {
  it("asks the sheets route, never from a cache, and takes its answer, a refusal's message included", async () => {
    const answers = [Response.json({ status: "ready", sheets: [] }), Response.json({ status: "error", message: "That file is not available." }, { status: 404 })];
    const fetch = vi.fn(async () => answers.shift()!);
    vi.stubGlobal("fetch", fetch);
    const url = storedSheetsUrl("0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e", "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f");
    expect(url).toBe("/api/inspections/0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e/files/1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f/sheets");
    expect(await fetchSheets(url)).toEqual({ status: "ready", sheets: [] });
    expect(await fetchSheets(HELD_SHEETS_URL, { method: "POST" })).toEqual({ status: "error", message: "That file is not available." });
    expect(fetch).toHaveBeenLastCalledWith("/api/sheets", { method: "POST", cache: "no-store", credentials: "same-origin" });
  });

  it("says so when the server cannot be reached or answers something else", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await fetchSheets(HELD_SHEETS_URL)).toEqual({ status: "error", message: "Could not reach the server. Check the connection, then try again." });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Bad Gateway</html>", { status: 502 })));
    expect(await fetchSheets(HELD_SHEETS_URL)).toEqual({ status: "error", message: "The spreadsheet could not be shown. Try again, or download it." });
  });
});

const sheet = (rows: number, columns: number, totalRows: number, totalColumns: number): SheetPreview => ({
  name: "Cartons",
  hidden: false,
  rows: Array.from({ length: rows }, () => Array.from({ length: columns }, () => "")),
  firstRow: 0,
  firstColumn: 0,
  totalRows,
  totalColumns,
});

describe("columnLetters", () => {
  it("heads columns as Excel does", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLetters)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
  });
});

describe("previewNote", () => {
  it("says nothing when the table shows the whole sheet", () => {
    expect(previewNote(sheet(12, 4, 12, 4))).toBeNull();
  });

  it("says which rows and columns the table shows, of how many", () => {
    expect(previewNote(sheet(200, 4, 1234, 4))).toBe("Showing the first 200 of 1,234 rows. Download the file to see it all.");
    expect(previewNote(sheet(12, 30, 12, 45))).toBe("Showing the first 30 of 45 columns. Download the file to see it all.");
    expect(previewNote(sheet(200, 30, 5000, 45))).toBe(
      "Showing the first 200 of 5,000 rows and the first 30 of 45 columns. Download the file to see it all.",
    );
  });
});
