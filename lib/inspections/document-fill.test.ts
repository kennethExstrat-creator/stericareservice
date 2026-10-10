import { describe, expect, it } from "vitest";
import { openSecret, sealSecret } from "@/lib/ai/secret-box";
import type { DocumentReading } from "@/lib/schemas/document-fill";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import { emptyHeader } from "@/modules/header/schema";
import { applyDocumentFill, checkReading } from "./document-fill";

const lists = {
  clients: [{ id: "client-1", name: "Client A" }],
  manufacturers: [{ id: "maker-1", name: "Manufacturer A" }],
};

const reading: DocumentReading = {
  clientId: "client-1",
  clientName: "  Client   A ",
  manufacturerId: "not-in-the-list",
  manufacturerName: "Manufacturer Z",
  productType: "examination",
  productName: "Brand X Nitrile Exam Glove",
  productCode: "CODE-001",
  factoryGloveCode: null,
  poNo: "PO-0001 (SO-0001)",
  mfgDate: "2026-02-01",
  expiryDate: "01/02/2029",
  sizes: [
    { size: "m", qtyCases: 100, lotNumbers: ["LOT-A01"] },
    { size: "M", qtyCases: 20, lotNumbers: ["LOT-A02", "LOT-A01"] },
    { size: "XXXL", qtyCases: 5, lotNumbers: [] },
    { size: "L", qtyCases: 2.5, lotNumbers: [] },
  ],
  notes: null,
};

function template(headerFields: Record<string, boolean> = {}): ResolvedTemplate {
  return {
    sizes: [
      { value: "M", label: "M" },
      { value: "L", label: "L" },
    ],
    modules: [
      { key: "header", include: true, config: { fields: headerFields } },
      { key: "order_lots", include: true, config: {} },
    ],
  } as unknown as ResolvedTemplate;
}

describe("checkReading", () => {
  it("keeps only listed ids, real dates and known sizes, adding up lines of one size", () => {
    const { form, fill } = checkReading(reading, lists, "po.pdf");
    expect(form).toMatchObject({ clientId: "client-1", clientName: "Client A", manufacturerId: null, manufacturerName: "Manufacturer Z" });
    expect(fill.header).toEqual({
      poNo: "PO-0001 (SO-0001)",
      productCode: "CODE-001",
      factoryGloveCode: null,
      mfgDate: "2026-02-01",
      expiryDate: null,
    });
    expect(fill.sizes).toEqual({
      M: { qtyCases: 120, lotNumbers: ["LOT-A01", "LOT-A02"] },
      L: { qtyCases: null, lotNumbers: [] },
    });
  });
});

describe("applyDocumentFill", () => {
  it("fills empty fields the template shows and sizes it offers, never over a value", () => {
    const { fill } = checkReading(reading, lists, "po.pdf");
    const data = {
      modules: {
        header: { ...emptyHeader(), productCode: "KEPT", comment: "note" },
        order_lots: { sizes: { L: { qtyCases: 7, lotNumbers: [], packingSite: null } } },
      },
      custom: {},
    };
    const result = applyDocumentFill(data, fill, template({ expiryDate: false }));
    expect(result.data.modules.header).toMatchObject({
      poNo: "PO-0001 (SO-0001)",
      productCode: "KEPT",
      mfgDate: "2026-02-01",
      comment: "note",
    });
    expect(result.data.modules.order_lots).toEqual({
      sizes: {
        M: { qtyCases: 120, lotNumbers: ["LOT-A01", "LOT-A02"], packingSite: null },
        L: { qtyCases: 7, lotNumbers: [], packingSite: null },
      },
    });
    expect(result.filled).toEqual(["header.poNo", "header.mfgDate", "order_lots.M"]);
  });
});

describe("secret box", () => {
  it("opens with the same secret only", () => {
    const sealed = sealSecret("sk-ant-api03-example", "secret-one");
    expect(openSecret(sealed, "secret-one")).toBe("sk-ant-api03-example");
    expect(openSecret(sealed, "secret-two")).toBeNull();
    expect(openSecret(`${sealed}x`, "secret-one")).toBeNull();
  });
});
