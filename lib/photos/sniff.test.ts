// Spreadsheets for Source Documents (sniff.ts; Kenneth, 26 October 2026): an
// Excel workbook by what its container holds, a CSV by its name or type once
// its bytes are text, never a name or a type alone. The workbooks are made
// with SheetJS, as Excel saves them; the images and PDFs are covered in
// exif.test.ts.
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { CSV_TYPE, XLS_TYPE, XLSX_TYPE } from "./paths";
import { detectType, isWorkbookZip, sniffSpreadsheet, spreadsheetTypeOf, zipEntries } from "./sniff";

function workbook(bookType: "xlsx" | "biff8"): Uint8Array {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Size", "Cases"], ["M", 20]]), "Order");
  return new Uint8Array(XLSX.write(book, { type: "buffer", bookType, compression: true }));
}

/** A zip holding these parts: a Word file's, say. */
function zipOf(names: readonly string[]): Uint8Array {
  const zip = XLSX.CFB.utils.cfb_new();
  for (const name of names) XLSX.CFB.utils.cfb_add(zip, name, Buffer.from("<x/>"));
  return new Uint8Array(XLSX.CFB.write(zip, { type: "buffer", fileType: "zip" }));
}

/** An OLE2 compound file holding these streams: a Word document's, say. */
function ole2Of(names: readonly string[]): Uint8Array {
  const file = XLSX.CFB.utils.cfb_new();
  for (const name of names) XLSX.CFB.utils.cfb_add(file, name, Buffer.alloc(600, 1));
  return new Uint8Array(XLSX.CFB.write(file, { type: "buffer" }));
}

const XLSX_BYTES = workbook("xlsx");
const XLS_BYTES = workbook("biff8");
const DOCX_BYTES = zipOf(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
const CSV_BYTES = new TextEncoder().encode("Size,Cases,Lot\nM,20,LOT-A01\n");
const entries = (bytes: Uint8Array) => zipEntries(bytes);

describe("zipEntries", () => {
  it("lists a workbook's parts from the zip's directory at its end, from the whole file or its last part", () => {
    const names = entries(XLSX_BYTES)?.map((entry) => entry.name) ?? [];
    expect(names).toEqual(expect.arrayContaining(["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]));
    expect(isWorkbookZip(entries(XLSX_BYTES) ?? [])).toBe(true);
    // The last part, with where it starts in the file: what the browser reads of a large file.
    const start = 100;
    expect(zipEntries(XLSX_BYTES.subarray(start), start)?.map((entry) => entry.name)).toEqual(names);
    expect(entries(XLSX_BYTES)?.every((entry) => entry.size > 0)).toBe(true);
  });

  it("is null when the directory is not all there, or for anything but a zip", () => {
    // Cut where the directory begins: what is left holds only its end record.
    expect(zipEntries(XLSX_BYTES.subarray(XLSX_BYTES.length - 30), XLSX_BYTES.length - 30)).toBeNull();
    expect(entries(XLS_BYTES)).toBeNull();
    expect(entries(CSV_BYTES)).toBeNull();
    expect(entries(new Uint8Array())).toBeNull();
  });

  it("tells a Word file's zip from a workbook's", () => {
    expect(isWorkbookZip(entries(DOCX_BYTES) ?? [])).toBe(false);
  });
});

describe("sniffSpreadsheet", () => {
  it("takes an .xlsx by the workbook its zip holds, whatever it is called", () => {
    expect(sniffSpreadsheet(XLSX_BYTES, XLSX_TYPE, "PO-0001.xlsx", entries(XLSX_BYTES))).toBe(XLSX_TYPE);
    expect(sniffSpreadsheet(XLSX_BYTES, "", "PO-0001", entries(XLSX_BYTES))).toBe(XLSX_TYPE);
    // A zip is none until its parts are known, and a Word file is none at all.
    expect(sniffSpreadsheet(XLSX_BYTES, XLSX_TYPE, "PO-0001.xlsx")).toBeNull();
    expect(sniffSpreadsheet(DOCX_BYTES, XLSX_TYPE, "report.xlsx", entries(DOCX_BYTES))).toBeNull();
  });

  it("takes an OLE2 file as an .xls when it is named or typed as Excel, not a Word document", () => {
    expect(sniffSpreadsheet(XLS_BYTES, XLS_TYPE, "Packing list.xls")).toBe(XLS_TYPE);
    expect(sniffSpreadsheet(XLS_BYTES, "", "Packing list.XLS")).toBe(XLS_TYPE);
    expect(sniffSpreadsheet(XLS_BYTES, XLS_TYPE, "")).toBe(XLS_TYPE);
    // A password-protected .xlsx is an OLE2 file too: Steri-AI says it cannot open it.
    expect(sniffSpreadsheet(ole2Of(["EncryptionInfo", "EncryptedPackage"]), XLSX_TYPE, "PO-0001.xlsx")).toBe(XLS_TYPE);
    expect(sniffSpreadsheet(ole2Of(["WordDocument"]), "application/msword", "report.doc")).toBeNull();
  });

  it("takes a CSV by its name whatever type the browser gives it, or by its type, once its bytes are text", () => {
    // Windows with Excel installed types a CSV as an Excel file; others text/plain, or nothing.
    for (const type of [CSV_TYPE, XLS_TYPE, "text/plain", "", "application/octet-stream"]) {
      expect(sniffSpreadsheet(CSV_BYTES, type, "Order.csv"), type).toBe(CSV_TYPE);
    }
    expect(sniffSpreadsheet(CSV_BYTES, "text/csv", "export")).toBe(CSV_TYPE);
    expect(sniffSpreadsheet(new Uint8Array([0xef, 0xbb, 0xbf, ...CSV_BYTES]), "", "Order.CSV")).toBe(CSV_TYPE);
    expect(sniffSpreadsheet(new Uint8Array(Buffer.from("﻿Size,Cases\n", "utf16le")), "", "Order.csv")).toBe(CSV_TYPE);
    // Text that happens to begin as a bitmap does ("BM") is still a CSV: a real one has NUL bytes.
    expect(sniffSpreadsheet(new TextEncoder().encode("BMI,Batch,Cases\nA,B,C\n"), "", "weights.csv")).toBe(CSV_TYPE);
  });

  it("takes no binary file, no plain-text PDF and no other text as a CSV", () => {
    expect(sniffSpreadsheet(new Uint8Array([0x53, 0x00, 0x69, 0x00]), XLS_TYPE, "data.csv")).toBeNull();
    expect(sniffSpreadsheet(new TextEncoder().encode("%PDF-1.4\n1 0 obj\n"), "", "scan.csv")).toBeNull();
    expect(sniffSpreadsheet(CSV_BYTES, "text/plain", "notes.txt")).toBeNull();
  });
});

describe("detectType with spreadsheets", () => {
  it("gives a spreadsheet its own type, from its bytes", () => {
    expect(detectType(XLSX_BYTES, XLSX_TYPE, "PO-0001.xlsx", entries(XLSX_BYTES))).toBe(XLSX_TYPE);
    expect(detectType(XLS_BYTES, XLS_TYPE, "Packing list.xls")).toBe(XLS_TYPE);
    expect(detectType(CSV_BYTES, XLS_TYPE, "Order.csv")).toBe(CSV_TYPE);
    expect(detectType(new TextEncoder().encode("BMI,Batch\n1,2\n3,4\n5,6\n"), "", "weights.csv")).toBe(CSV_TYPE);
  });

  it("never takes a spreadsheet's type from the name or the type alone", () => {
    expect(detectType(DOCX_BYTES, XLSX_TYPE, "report.xlsx", entries(DOCX_BYTES))).toBeNull();
    expect(detectType(XLSX_BYTES, XLSX_TYPE, "PO-0001.xlsx")).toBeNull();
    expect(detectType(new Uint8Array([1, 0, 2, 0]), XLS_TYPE, "data.csv")).toBeNull();
    expect(detectType(new Uint8Array([1, 2, 3]), XLS_TYPE, "old.xls")).toBeNull();
    // Anything else keeps its type as before.
    expect(detectType(DOCX_BYTES, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "report.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });
});

describe("spreadsheetTypeOf", () => {
  it("knows a spreadsheet by its name, else its type, before its bytes are read", () => {
    expect(spreadsheetTypeOf({ name: "PO-0001.XLSX" })).toBe(XLSX_TYPE);
    expect(spreadsheetTypeOf({ name: "Packing list.xls", type: XLS_TYPE })).toBe(XLS_TYPE);
    expect(spreadsheetTypeOf({ name: "Order.csv", type: XLS_TYPE })).toBe(CSV_TYPE);
    expect(spreadsheetTypeOf({ name: "Order.csv", type: "" })).toBe(CSV_TYPE);
    expect(spreadsheetTypeOf({ name: "export", type: "text/csv" })).toBe(CSV_TYPE);
    expect(spreadsheetTypeOf({ name: "PO-0001", type: XLSX_TYPE })).toBe(XLSX_TYPE);
    expect(spreadsheetTypeOf({ name: "PO-0001.pdf", type: "application/pdf" })).toBeNull();
    expect(spreadsheetTypeOf({ name: "IMG_0001.jpg", type: "image/jpeg" })).toBeNull();
    expect(spreadsheetTypeOf({ name: "notes.txt", type: "text/plain" })).toBeNull();
  });
});
