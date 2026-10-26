// Preview of an Excel or CSV Source Document (Kenneth, 26 October 2026): a
// spreadsheet opens as a table of its sheets, read on the server (the
// sheets route, faked here), laid out as Excel lays it out.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileRowIcon, previewOfUploaded } from "./file-list";
import { previewKind, SheetTable } from "./file-preview-dialog";

const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const FILE = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what Preview makes of a file", () => {
  it("shows an Excel or CSV file as a table, by its name", () => {
    expect(["PO-0001.xlsx", "Packing list.XLS", "Order.csv"].map(previewKind)).toEqual(["sheet", "sheet", "sheet"]);
    expect(previewKind("PO-0001.pdf")).toBe("pdf");
    expect(previewKind("notes.txt")).toBe("other");
  });

  it("reads an uploaded spreadsheet's sheets on the server, from the inspection's file; anything else needs none", async () => {
    const fetch = vi.fn(async () => Response.json({ status: "ready", sheets: [] }));
    vi.stubGlobal("fetch", fetch);
    const sheets = previewOfUploaded(INSPECTION, { id: FILE, name: "PO-0001.xlsx" }, "https://storage.test/signed").sheets;
    expect(await sheets?.()).toEqual({ status: "ready", sheets: [] });
    expect(fetch).toHaveBeenCalledWith(`/api/inspections/${INSPECTION}/files/${FILE}/sheets`, expect.objectContaining({ cache: "no-store" }));
    expect(previewOfUploaded(INSPECTION, { id: FILE, name: "PO-0001.pdf" }, "https://storage.test/signed")).toEqual({
      name: "PO-0001.pdf",
      url: "https://storage.test/signed",
    });
  });

  it("gives an Excel or CSV file's row a spreadsheet's icon", () => {
    expect(renderToStaticMarkup(<FileRowIcon file={{ name: "Order.csv", type: "application/vnd.ms-excel" }} />)).toContain("lucide-file-spreadsheet");
    expect(renderToStaticMarkup(<FileRowIcon file={{ name: "PO-0001.pdf" }} />)).toContain("lucide-file-text");
  });
});

describe("a sheet's table", () => {
  const html = renderToStaticMarkup(
    <SheetTable
      sheet={{ name: "Order", hidden: false, rows: [["Size", "Cases"], ["M", "1,234"]], firstRow: 2, firstColumn: 1, totalRows: 250, totalColumns: 2 }}
    />,
  );

  it("heads its columns with Excel's letters and its rows with their numbers, from where the sheet's table starts", () => {
    expect(html).toMatch(/<th scope="col"[^>]*>B<\/th><th scope="col"[^>]*>C<\/th>/);
    expect(html).toMatch(/<th scope="row"[^>]*>3<\/th>/);
    expect(html).toMatch(/<th scope="row"[^>]*>4<\/th>/);
    expect(html).toContain('<span class="sr-only">Row</span>');
  });

  it("puts numbers on the right, as data in a table, and says what it leaves out", () => {
    expect(html).toMatch(/<td class="[^"]*text-right[^"]*">1,234<\/td>/);
    expect(html).toMatch(/<td class="[^"]*">Size<\/td>/);
    expect(html).not.toMatch(/<td class="[^"]*text-right[^"]*">Size<\/td>/);
    expect(html).toContain("Showing the first 2 of 250 rows. Download the file to see it all.");
  });
});
