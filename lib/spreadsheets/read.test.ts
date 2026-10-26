// Excel and CSV Source Documents as Steri-AI and Preview get them (read.ts;
// Kenneth, 26 October 2026). The workbooks are made with SheetJS as Excel
// saves them: values with their formats, a formula with its result, a date
// in the computer's short date format. Placeholders for every client, PO,
// lot and carton (docs/FIXTURES.md).
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { CSV_TYPE, XLS_TYPE, XLSX_TYPE } from "@/lib/photos/paths";
import { PREVIEW_COLUMNS, PREVIEW_ROWS } from "./preview";
import { decodeCsv, MAX_SPREADSHEET_TEXT, parseCsv, spreadsheetPreview, spreadsheetText } from "./read";

/** An order workbook: the order on its first sheet, an empty sheet, the cartons, and a hidden sheet of notes. */
function orderWorkbook(bookType: "xlsx" | "biff8" = "xlsx"): Uint8Array {
  const order = XLSX.utils.aoa_to_sheet([
    ["PO No", "PO-0001 (SO-0001)"],
    ["Client", "Client A"],
    ["Size", "Cases", "Lot"],
    ["M", 20, "LOT-A01"],
    ["L", 5, "LOT-A02"],
  ]);
  // A formula as Excel saves it, with its result; the result is what the sheet shows.
  order.A6 = { t: "s", v: "Total" };
  order.B6 = { t: "n", v: 25, f: "SUM(B4:B5)" };
  // 3 November 2026 in the computer's short date format (Excel's format 14), which each computer shows its own way.
  order.A7 = { t: "s", v: "Mfg Date" };
  order.B7 = { t: "n", v: 46329, z: "m/d/yy" };
  order.A8 = { t: "s", v: "Price" };
  order.B8 = { t: "n", v: 1234.5, z: "#,##0.00" };
  order["!ref"] = "A1:C8";
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, order, "Order");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), "Empty");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Carton", "Box/Carton #"], ["1", 101], ["2", 102]]), "Cartons");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Note", "Checked by Inspector A"]]), "Notes");
  book.Workbook = { Sheets: [{}, {}, {}, { Hidden: 1 }] };
  return new Uint8Array(XLSX.write(book, { type: "buffer", bookType, compression: true }));
}

const ORDER_TEXT = [
  "Sheet: Order",
  "PO No,PO-0001 (SO-0001)",
  "Client,Client A",
  "Size,Cases,Lot",
  "M,20,LOT-A01",
  "L,5,LOT-A02",
  "Total,25",
  "Mfg Date,2026-11-03",
  'Price,"1,234.50"',
  "",
  "Sheet: Cartons",
  "Carton,Box/Carton #",
  "1,101",
  "2,102",
  "",
  "Sheet: Notes (hidden)",
  "Note,Checked by Inspector A",
].join("\n");

/** A workbook of one sheet. */
function sheetBook(sheet: XLSX.WorkSheet): Uint8Array {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Cartons");
  return new Uint8Array(XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }));
}

/** An OLE2 compound file holding these streams. */
function ole2Of(streams: Readonly<Record<string, Buffer>>): Uint8Array {
  const file = XLSX.CFB.utils.cfb_new();
  for (const [name, content] of Object.entries(streams)) XLSX.CFB.utils.cfb_add(file, name, content);
  return new Uint8Array(XLSX.CFB.write(file, { type: "buffer" }));
}

/** A password-protected .xlsx as Excel saves it: an OLE2 file with the encryption's description (agile, version 4.4) and the package. */
const ENCRYPTED = ole2Of({ EncryptionInfo: Buffer.from([4, 0, 4, 0, 0x40, 0, 0, 0]), EncryptedPackage: Buffer.alloc(600, 1) });
/** A Word document: an OLE2 file without a workbook. */
const WORD = ole2Of({ WordDocument: Buffer.alloc(600, 1) });

/** A zip of one part that says it unpacks to `size` bytes: its directory, and nothing in it. */
function zipClaiming(size: number): Uint8Array {
  const name = Buffer.from("xl/worksheets/sheet1.xml");
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(size, 24);
  central.writeUInt16LE(name.length, 28);
  name.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  return new Uint8Array(Buffer.concat([local, central, end]));
}

const text = (value: string) => new TextEncoder().encode(value);

describe("decodeCsv", () => {
  it("reads UTF-8 without its byte order mark, and UTF-16 by its own", () => {
    expect(decodeCsv(new Uint8Array([0xef, 0xbb, 0xbf, ...text("Size,Cases\nM,20")]))).toBe("Size,Cases\nM,20");
    expect(decodeCsv(new Uint8Array(Buffer.from("﻿Size,Cases\nM,20", "utf16le")))).toBe("Size,Cases\nM,20");
    expect(decodeCsv(text("Product,Note\nBrand A,Café – 5½"))).toBe("Product,Note\nBrand A,Café – 5½");
  });

  it("falls back to windows-1252 when the bytes are not UTF-8, as Excel's plain CSV on Windows saves them", () => {
    const windows = new Uint8Array([...text("Product,Note\nBrand A,Caf"), 0xe9, 0x20, 0x96, 0x20, 0x35, 0xbd]);
    expect(decodeCsv(windows)).toBe("Product,Note\nBrand A,Café – 5½");
  });
});

describe("spreadsheetText: what Steri-AI gets", () => {
  it("gives a workbook sheet by sheet as CSV, the values as Excel shows them, empty sheets left out and hidden ones marked", () => {
    expect(spreadsheetText(orderWorkbook(), XLSX_TYPE)).toEqual({ ok: true, value: ORDER_TEXT });
  });

  it("reads an Excel 97-2003 workbook (.xls) the same way", () => {
    expect(spreadsheetText(orderWorkbook("biff8"), XLS_TYPE)).toEqual({ ok: true, value: ORDER_TEXT });
  });

  it("leaves out empty rows, the empty columns before a sheet's table, and a range stretched by formatting", () => {
    const sheet = XLSX.utils.sheet_add_aoa({}, [["Carton"], [101], [], [102]], { origin: "C3" });
    sheet["!ref"] = "A1:Z500";
    expect(spreadsheetText(sheetBook(sheet), XLSX_TYPE)).toEqual({ ok: true, value: "Sheet: Cartons\nCarton\n101\n102" });
  });

  it("gives a CSV as it is: without its byte order mark, lines ending in one way", () => {
    const csv = new Uint8Array([0xef, 0xbb, 0xbf, ...text("Size,Cases,Lot\r\nM,20,LOT-A01\r\nL,5,\"LOT-A02, LOT-A03\"\r\n")]);
    expect(spreadsheetText(csv, CSV_TYPE)).toEqual({ ok: true, value: 'Size,Cases,Lot\nM,20,LOT-A01\nL,5,"LOT-A02, LOT-A03"' });
    const windows = new Uint8Array([...text("Product,Note\nBrand A,Caf"), 0xe9]);
    expect(spreadsheetText(windows, CSV_TYPE)).toEqual({ ok: true, value: "Product,Note\nBrand A,Café" });
  });

  it("cuts a long spreadsheet at the end of a row, saying how many rows were left out, those of later sheets included", () => {
    const csv = text(`Size,Cases\n${"M,20\n".repeat(10)}`);
    expect(spreadsheetText(csv, CSV_TYPE, 30)).toEqual({ ok: true, value: "Size,Cases\nM,20\nM,20\nM,20\nM,20\n[truncated: 6 more rows]" });
    // Order's last five rows, then Cartons' three and Notes' one.
    expect(spreadsheetText(orderWorkbook(), XLSX_TYPE, 60)).toEqual({
      ok: true,
      value: "Sheet: Order\nPO No,PO-0001 (SO-0001)\nClient,Client A\n[truncated: 10 more rows]",
    });
  });

  it("holds about 300,000 characters at most by default", () => {
    const rows = 40_000;
    const csv = text(`Size,Cases,Lot\n${"M,20,LOT-A01\n".repeat(rows)}`);
    const result = spreadsheetText(csv, CSV_TYPE);
    expect(MAX_SPREADSHEET_TEXT).toBe(300_000);
    if (!result.ok) throw new Error(result.message);
    const lines = result.value.split("\n");
    const left = Number(/^\[truncated: (\d+) more rows\]$/.exec(lines.at(-1) ?? "")?.[1]);
    expect(result.value.length).toBeLessThanOrEqual(MAX_SPREADSHEET_TEXT + 40);
    expect(lines.length - 2 + left).toBe(rows);
  });

  it("says why it cannot read one: password-protected, not a workbook, empty, or unpacking to too much", () => {
    const password = "This spreadsheet is password-protected. Save it without a password and upload it again.";
    const unreadable = "This spreadsheet could not be opened. Save it again as .xlsx or CSV and upload it again.";
    expect(spreadsheetText(ENCRYPTED, XLS_TYPE)).toEqual({ ok: false, message: password });
    expect(spreadsheetText(WORD, XLS_TYPE)).toEqual({ ok: false, message: unreadable });
    expect(spreadsheetText(text("%PDF-1.7\n"), XLSX_TYPE)).toEqual({ ok: false, message: unreadable });
    expect(spreadsheetText(sheetBook(XLSX.utils.aoa_to_sheet([[""], ["  "]])), XLSX_TYPE)).toEqual({ ok: false, message: "This spreadsheet is empty." });
    expect(spreadsheetText(text(" \r\n\r\n"), CSV_TYPE)).toEqual({ ok: false, message: "This spreadsheet is empty." });
    expect(spreadsheetText(zipClaiming(250 * 1024 * 1024), XLSX_TYPE)).toEqual({
      ok: false,
      message: "The spreadsheet is too large to open. Upload it in parts, a few sheets at a time.",
    });
  });
});

describe("parseCsv", () => {
  it("splits fields at commas outside quotes, a doubled quote one quote, and keeps every field as written", () => {
    expect(parseCsv('Name,Note,Code\r\n"Brand A, Blue","He said ""ok""\nthen left",0020\n01/02/2026,,007')).toEqual([
      ["Name", "Note", "Code"],
      ["Brand A, Blue", 'He said "ok"\nthen left', "0020"],
      ["01/02/2026", "", "007"],
    ]);
  });

  it("takes the separator from a sep= line, else the first line's most common one", () => {
    expect(parseCsv("sep=;\nSize;Cases\nM;20")).toEqual([["Size", "Cases"], ["M", "20"]]);
    expect(parseCsv("Size;Cases;Note\nM;20;1,5 cases")).toEqual([["Size", "Cases", "Note"], ["M", "20", "1,5 cases"]]);
    expect(parseCsv("Size\tCases\nM\t20\n")).toEqual([["Size", "Cases"], ["M", "20"]]);
    // A first column named ID is a CSV's, not another format's.
    expect(parseCsv("ID,Size\n1,M")).toEqual([["ID", "Size"], ["1", "M"]]);
  });
});

describe("spreadsheetPreview: Preview's table", () => {
  it("shows each sheet that holds something as displayed, hidden ones marked", () => {
    const result = spreadsheetPreview(orderWorkbook(), XLSX_TYPE);
    if (result.status !== "ready") throw new Error(result.message);
    expect(result.sheets.map(({ name, hidden }) => ({ name, hidden }))).toEqual([
      { name: "Order", hidden: false },
      { name: "Cartons", hidden: false },
      { name: "Notes", hidden: true },
    ]);
    expect(result.sheets[0]).toEqual({
      name: "Order",
      hidden: false,
      rows: [
        ["PO No", "PO-0001 (SO-0001)", ""],
        ["Client", "Client A", ""],
        ["Size", "Cases", "Lot"],
        ["M", "20", "LOT-A01"],
        ["L", "5", "LOT-A02"],
        ["Total", "25", ""],
        ["Mfg Date", "2026-11-03", ""],
        ["Price", "1,234.50", ""],
      ],
      firstRow: 0,
      firstColumn: 0,
      totalRows: 8,
      totalColumns: 3,
    });
  });

  it("shows at most 200 rows and 30 columns of a sheet, from where it starts, with its whole size", () => {
    const rows = Array.from({ length: 250 }, (_, row) => Array.from({ length: 40 }, (_, column) => `R${row + 1}C${column + 1}`));
    const result = spreadsheetPreview(sheetBook(XLSX.utils.sheet_add_aoa({}, rows, { origin: "B3" })), XLSX_TYPE);
    if (result.status !== "ready") throw new Error(result.message);
    const [sheet] = result.sheets;
    expect(sheet.rows).toHaveLength(PREVIEW_ROWS);
    expect(sheet.rows.every((row) => row.length === PREVIEW_COLUMNS)).toBe(true);
    expect(sheet.rows[0][0]).toBe("R1C1");
    expect(sheet.rows[199][29]).toBe("R200C30");
    expect(sheet).toMatchObject({ firstRow: 2, firstColumn: 1, totalRows: 250, totalColumns: 40 });
  });

  it("shows a CSV as one sheet, its fields as written, at most 200 rows and 30 columns", () => {
    const csv = text("Size,Cases,Date\nM,0020,01/02/2026\n");
    expect(spreadsheetPreview(csv, CSV_TYPE)).toEqual({
      status: "ready",
      sheets: [
        {
          name: "",
          hidden: false,
          rows: [
            ["Size", "Cases", "Date"],
            ["M", "0020", "01/02/2026"],
          ],
          firstRow: 0,
          firstColumn: 0,
          totalRows: 2,
          totalColumns: 3,
        },
      ],
    });
    const wide = text(Array.from({ length: 300 }, (_, row) => Array.from({ length: 35 }, (_, column) => `${row}.${column}`).join(",")).join("\n"));
    const result = spreadsheetPreview(wide, CSV_TYPE);
    if (result.status !== "ready") throw new Error(result.message);
    expect(result.sheets[0].rows).toHaveLength(PREVIEW_ROWS);
    expect(result.sheets[0].rows[0]).toHaveLength(PREVIEW_COLUMNS);
    expect(result.sheets[0]).toMatchObject({ totalRows: 300, totalColumns: 35 });
  });

  it("says why it cannot show one", () => {
    expect(spreadsheetPreview(ENCRYPTED, XLS_TYPE)).toEqual({
      status: "error",
      message: "This spreadsheet is password-protected. Save it without a password and upload it again.",
    });
    expect(spreadsheetPreview(text(",,\n"), CSV_TYPE)).toEqual({ status: "error", message: "This spreadsheet is empty." });
  });
});
