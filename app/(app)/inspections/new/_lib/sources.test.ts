// New Inspection's Source Documents (sources.ts): a reading fills only what
// is still empty, the first answer wins, and documents are read only while
// the form still needs values. The card itself runs live (e2e).
import { describe, expect, it } from "vitest";
import type { DocumentFill } from "@/lib/schemas/document-fill";
import { NO_CHOICES } from "./draft";
import {
  documentRefusal,
  formFill,
  mediaRefusal,
  mergeFills,
  nextToRead,
  readsHere,
  type DocumentRead,
  type HeldDocument,
  type ReadState,
} from "./sources";

const CLIENT = "20000000-0000-4000-8000-000000000001";
const MANUFACTURER = "10000000-0000-4000-8000-000000000001";

function read(fileName: string, header: Partial<DocumentFill["header"]>, sizes: DocumentFill["sizes"] = {}): DocumentRead {
  return {
    status: "read",
    fileName,
    notes: null,
    form: {
      clientId: CLIENT,
      clientName: null,
      clientMatch: { label: "Client A", by: "steri_ai" },
      manufacturerId: MANUFACTURER,
      manufacturerName: null,
      manufacturerMatch: { label: "Manufacturer A · Factory 1", by: "steri_ai" },
      manufacturerDetails: null,
      productType: "examination",
      productName: "Nitrile Blue",
    },
    fill: {
      fileName,
      header: { poNo: null, productCode: null, factoryGloveCode: null, inspectionDate: null, mfgDate: null, expiryDate: null, ...header },
      sizes,
    },
  };
}

const held = (key: string, state: ReadState): HeldDocument => ({ key, file: new File(["%PDF-"], `${key}.pdf`), url: `blob:${key}`, state });

describe("a document read on the form", () => {
  it("fills only the fields nothing is chosen or typed in yet", () => {
    const { form } = read("PO.pdf", {});
    expect(formFill(NO_CHOICES, form)).toEqual({
      clientId: CLIENT,
      manufacturerId: MANUFACTURER,
      productType: "examination",
      productName: "Nitrile Blue",
    });
    // "No Client" is a choice, and a typed name stays.
    expect(formFill({ ...NO_CHOICES, clientId: "none", productName: "Typed" }, form)).toEqual({
      manufacturerId: MANUFACTURER,
      productType: "examination",
    });
    // Spaces alone are no name yet.
    expect(formFill({ ...NO_CHOICES, productName: "  " }, form)).toMatchObject({ productName: "Nitrile Blue" });
  });

  it("goes in with Create merged with the others read: the first answer wins, field by field and size by size", () => {
    const first = read("PO.pdf", { poNo: "PO-0001" }, { M: { qtyCases: 20, lotNumbers: [] } });
    const second = read("Form.jpg", { poNo: "PO-9999", mfgDate: "2026-08-01" }, { M: { qtyCases: 99, lotNumbers: ["L1"] }, L: { qtyCases: 5, lotNumbers: [] } });
    expect(mergeFills([first, second])).toEqual({
      fileName: "PO.pdf, Form.jpg",
      header: { poNo: "PO-0001", productCode: null, factoryGloveCode: null, inspectionDate: null, mfgDate: "2026-08-01", expiryDate: null },
      sizes: { M: { qtyCases: 20, lotNumbers: ["L1"] }, L: { qtyCases: 5, lotNumbers: [] } },
    });
    expect(mergeFills([])).toBeNull();
  });
});

describe("where a dropped file goes (Kenneth, 26 October 2026: Excel and CSV files are read too)", () => {
  const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const spreadsheets = [
    { name: "PO-0001.xlsx", type: XLSX_TYPE, size: 2048 },
    { name: "Packing list.xls", type: "application/vnd.ms-excel", size: 2048 },
    // Windows types a CSV as Excel; some browsers give it no type at all.
    { name: "Order.csv", type: "application/vnd.ms-excel", size: 120 },
    { name: "Order.csv", type: "", size: 120 },
    { name: "Order.csv", type: "text/csv", size: 120 },
  ];

  it("takes a spreadsheet on Files, to be read, and never on Media", () => {
    for (const file of spreadsheets) {
      expect(documentRefusal(file), file.type).toBeNull();
      expect(mediaRefusal(file), file.type).toBe("Media takes photos and videos. Add documents under Files.");
    }
    expect(documentRefusal({ name: "clip.mov", type: "video/quicktime", size: 1024 })).toBe(
      "Files takes PDFs, photos, Excel and CSV files. Add videos under Media.",
    );
    expect(documentRefusal({ name: "notes.txt", type: "text/plain", size: 10 })).toBe("Files takes PDFs, photos, Excel and CSV files. Add videos under Media.");
  });

  it("reads a held spreadsheet on the form, typed as one, up to 4 MB", () => {
    expect(readsHere({ type: "text/csv", size: 120 })).toBe(true);
    expect(readsHere({ type: XLSX_TYPE, size: 4 * 1024 * 1024 })).toBe(true);
    expect(readsHere({ type: XLSX_TYPE, size: 4 * 1024 * 1024 + 1 })).toBe(false);
  });
});

describe("the reader on the form", () => {
  it("reads one document at a time, the first waiting, and only while the form still needs values", () => {
    const documents = [held("a", { step: "read", read: read("a.pdf", {}) }), held("b", { step: "waiting" }), held("c", { step: "waiting" })];
    expect(nextToRead(documents, true)?.key).toBe("b");
    expect(nextToRead(documents, false)).toBeNull();
    expect(nextToRead([held("a", { step: "reading" }), held("b", { step: "waiting" })], true)).toBeNull();
    expect(nextToRead([held("a", { step: "later" }), held("b", { step: "failed", message: "Not connected." })], true)).toBeNull();
  });
});
