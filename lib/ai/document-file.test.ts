// A document as Claude reads it (document-file.ts): the bytes decide what a
// file is (a CSV also by its name), each type within Steri-AI's size for it,
// and an Excel or CSV file goes as a plain-text document titled with the
// file's name (Kenneth, 26 October 2026). Placeholders for the PO and lot.
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { documentBlock, documentTypeOf, readableDocument, UNSUPPORTED_DOCUMENT } from "./document-file";

const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
const HEIC = Buffer.from([0, 0, 0, 24, ...Buffer.from("ftypheic\0\0\0\0mif1heic", "latin1")]);
const CSV = Buffer.from("Size,Cases,Lot\nM,20,LOT-A01\n");
const MB = 1024 * 1024;

function workbook(bookType: "xlsx" | "biff8"): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Size", "Cases"], ["M", 20]]), "Order");
  return XLSX.write(book, { type: "buffer", bookType, compression: true }) as Buffer;
}

describe("documentTypeOf", () => {
  it("knows a document by its bytes: a PDF, a photo, an Excel workbook", () => {
    expect(documentTypeOf(PDF, "i/f.pdf")).toBe("application/pdf");
    expect(documentTypeOf(JPEG, "i/f.jpg")).toBe("image/jpeg");
    expect(documentTypeOf(workbook("xlsx"), "i/f.xlsx")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(documentTypeOf(workbook("biff8"), "i/f.xls")).toBe("application/vnd.ms-excel");
    // The bytes, not the name: a PDF stored under any name is a PDF.
    expect(documentTypeOf(PDF, "i/f.csv")).toBe("application/pdf");
  });

  it("knows a CSV by its text and its name: a stored one's object name ends in .csv, a held one's name or type says so", () => {
    expect(documentTypeOf(CSV, "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e/1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f.csv")).toBe("text/csv");
    expect(documentTypeOf(CSV, "Order.csv", "application/vnd.ms-excel")).toBe("text/csv");
    expect(documentTypeOf(CSV, "export", "text/csv")).toBe("text/csv");
    expect(documentTypeOf(CSV, "i/f.pdf")).toBeNull();
  });

  it("takes nothing Claude cannot read", () => {
    expect(documentTypeOf(HEIC, "i/f.heic")).toBeNull();
    expect(documentTypeOf(Buffer.from([1, 0, 2, 0]), "i/f.csv")).toBeNull();
  });
});

describe("readableDocument", () => {
  it("gives a PDF and a photo as base64, as before", () => {
    expect(readableDocument(PDF, { name: "PO-0001.pdf", storedAs: "i/f.pdf" })).toEqual({
      ok: true,
      file: { mediaType: "application/pdf", base64: PDF.toString("base64"), name: "PO-0001.pdf" },
    });
    expect(readableDocument(JPEG, { name: "Label.jpg" })).toMatchObject({ ok: true, file: { mediaType: "image/jpeg" } });
  });

  it("gives an Excel or CSV file as its text, under the file's own name", () => {
    expect(readableDocument(workbook("xlsx"), { name: "PO-0001.xlsx", storedAs: "i/f.xlsx" })).toEqual({
      ok: true,
      file: { mediaType: "text/plain", text: "Sheet: Order\nSize,Cases\nM,20", name: "PO-0001.xlsx" },
    });
    expect(readableDocument(workbook("biff8"), { name: "Packing list.xls", storedAs: "i/f.xls" })).toMatchObject({
      ok: true,
      file: { mediaType: "text/plain", text: "Sheet: Order\nSize,Cases\nM,20" },
    });
    expect(readableDocument(CSV, { name: "Order.csv", declared: "application/vnd.ms-excel" })).toEqual({
      ok: true,
      file: { mediaType: "text/plain", text: "Size,Cases,Lot\nM,20,LOT-A01", name: "Order.csv" },
    });
  });

  it("refuses what Steri-AI does not read, and a file over its size for the type, saying why", () => {
    expect(readableDocument(HEIC, { name: "IMG_0001.heic" })).toEqual({ ok: false, message: UNSUPPORTED_DOCUMENT });
    expect(UNSUPPORTED_DOCUMENT).toBe("Steri-AI reads PDFs, photos (JPEG or PNG), Excel and CSV files. Save this file as a PDF and upload it again.");
    const sheets = "The file is too large for Steri-AI to read. Upload it in parts, a few sheets at a time.";
    const pages = "The file is too large for Steri-AI to read. Upload it in parts, a few pages at a time.";
    // A spreadsheet up to 10 MB (MAX_SPREADSHEET_BYTES), a PDF up to 20 MB, a photo up to 3.75 MB.
    expect(readableDocument(Buffer.alloc(10 * MB + 1, "a"), { name: "Cartons.csv" })).toEqual({ ok: false, message: sheets });
    expect(readableDocument(Buffer.alloc(10 * MB, "a"), { name: "Cartons.csv" })).toMatchObject({ ok: true });
    expect(readableDocument(Buffer.concat([PDF, Buffer.alloc(20 * MB)]), { name: "PO-0001.pdf" })).toEqual({ ok: false, message: pages });
    expect(readableDocument(Buffer.concat([JPEG, Buffer.alloc(4 * MB)]), { name: "Label.jpg" })).toEqual({ ok: false, message: pages });
    // A zip holding no workbook is no Excel file; an "Excel" file SheetJS cannot open, or an empty one, says why.
    expect(readableDocument(Buffer.from("PK\u0003\u0004 not a workbook"), { name: "PO-0001.xlsx" })).toEqual({ ok: false, message: UNSUPPORTED_DOCUMENT });
    const word = XLSX.CFB.utils.cfb_new();
    XLSX.CFB.utils.cfb_add(word, "WordDocument", Buffer.alloc(600, 1));
    expect(readableDocument(XLSX.CFB.write(word, { type: "buffer" }) as Buffer, { name: "Report.xls" })).toEqual({
      ok: false,
      message: "This spreadsheet could not be opened. Save it again as .xlsx or CSV and upload it again.",
    });
    expect(readableDocument(Buffer.from(" \n"), { name: "Empty.csv" })).toEqual({ ok: false, message: "This spreadsheet is empty." });
  });
});

describe("documentBlock", () => {
  it("sends a spreadsheet's text as a plain-text document titled with the file's name", () => {
    expect(documentBlock({ mediaType: "text/plain", text: "Sheet: Order\nSize,Cases\nM,20", name: "PO-0001.xlsx" })).toEqual({
      type: "document",
      source: { type: "text", media_type: "text/plain", data: "Sheet: Order\nSize,Cases\nM,20" },
      title: "PO-0001.xlsx",
    });
    expect(documentBlock({ mediaType: "text/plain", text: "Size,Cases,Lot\nM,20,LOT-A01", name: "Order.csv" })).toEqual({
      type: "document",
      source: { type: "text", media_type: "text/plain", data: "Size,Cases,Lot\nM,20,LOT-A01" },
      title: "Order.csv",
    });
  });

  it("sends a PDF as a document and a photo as an image, as before", () => {
    expect(documentBlock({ mediaType: "application/pdf", base64: "JVBERi0=", name: "PO-0001.pdf" })).toEqual({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" },
    });
    expect(documentBlock({ mediaType: "image/png", base64: "iVBORw0K", name: "Label.png" })).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "iVBORw0K" },
    });
  });
});
