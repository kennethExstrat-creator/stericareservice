import { describe, expect, it } from "vitest";
import { openSecret, sealSecret } from "@/lib/ai/secret-box";
import type { DocumentReading } from "@/lib/schemas/document-fill";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import { emptyHeader } from "@/modules/header/schema";
import { applyDocumentFill, checkReading } from "./document-fill";
import { directoryFromRows } from "./reference-match";

const lists = {
  clients: [{ id: "client-1", name: "Client A" }],
  // Manufacturer A: its company with one factory, "Manufacturer A · Factory 1".
  directory: directoryFromRows([
    {
      id: "brand-1",
      name: "Manufacturer A",
      companies: [{ id: "company-1", name: "Manufacturer A Sdn. Bhd.", factories: [{ id: "maker-1", factory_name: "Factory 1", country: "Malaysia" }] }],
    },
  ]),
};

const NOTHING_PRINTED = { brand: "", company: "", factory: "", address: "", country: "" };

const reading: DocumentReading = {
  clientId: "client-1",
  clientName: "  Client   A ",
  manufacturerId: "not-in-the-list",
  manufacturerName: "Manufacturer Z",
  manufacturerDetails: { ...NOTHING_PRINTED, company: " Manufacturer  Z Sdn. Bhd. " },
  productType: "examination",
  productName: "Brand X Nitrile Exam Glove",
  productCode: "CODE-001",
  factoryGloveCode: null,
  poNo: "PO-0001 (SO-0001)",
  inspectionDate: "2026-10-09",
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
    expect(form).toMatchObject({
      clientId: "client-1",
      clientName: "Client A",
      clientMatch: { label: "Client A", by: "steri_ai" },
      manufacturerId: null,
      manufacturerName: "Manufacturer Z",
      manufacturerMatch: null,
    });
    expect(fill.header).toEqual({
      poNo: "PO-0001 (SO-0001)",
      productCode: "CODE-001",
      factoryGloveCode: null,
      inspectionDate: "2026-10-09",
      mfgDate: "2026-02-01",
      expiryDate: null,
    });
    expect(fill.sizes).toEqual({
      M: { qtyCases: 120, lotNumbers: ["LOT-A01", "LOT-A02"] },
      L: { qtyCases: null, lotNumbers: [] },
    });
  });

  // Kenneth, 27 October 2026: "the Steri AI should be able to read doc to use existing client and manufacturer or create new one".
  it("finds by name a listed client or factory Steri-AI missed, and says so", () => {
    const { form } = checkReading(
      {
        ...reading,
        clientId: null,
        clientName: "CLIENT A SDN. BHD.",
        manufacturerId: null,
        manufacturerName: "Manufacturer A Sdn Bhd, Factory 1",
        manufacturerDetails: { ...NOTHING_PRINTED, company: "MANUFACTURER A SDN BHD", factory: "factory 1" },
      },
      lists,
      "po.pdf",
    );
    expect(form).toMatchObject({
      clientId: "client-1",
      clientMatch: { label: "Client A", by: "name" },
      manufacturerId: "maker-1",
      manufacturerMatch: { label: "Manufacturer A · Factory 1", by: "name" },
      // Matched: nothing to add.
      manufacturerDetails: null,
    });
  });

  it("passes on what the document prints about a manufacturer no entry matches, each part cleaned, for New Manufacturer", () => {
    const { form } = checkReading(
      {
        ...reading,
        clientId: "someone-else",
        clientName: "New Buyer Sdn. Bhd.",
        manufacturerDetails: {
          brand: "Brand Z",
          company: " Manufacturer  Z Sdn. Bhd. ",
          factory: "F-40",
          address: " Lot 1,  Placeholder Park \n\n 41000 Klang ",
          country: "",
        },
      },
      lists,
      "po.pdf",
    );
    // An id not in the list, and a name no listed client reads like: New Client.
    expect(form).toMatchObject({ clientId: null, clientMatch: null, clientName: "New Buyer Sdn. Bhd." });
    expect(form.manufacturerDetails).toEqual({
      brand: "Brand Z",
      company: "Manufacturer Z Sdn. Bhd.",
      factory: "F-40",
      address: "Lot 1, Placeholder Park\n41000 Klang",
      country: null,
    });
    // Nothing printed at all.
    expect(checkReading({ ...reading, manufacturerDetails: NOTHING_PRINTED }, lists, "po.pdf").form.manufacturerDetails).toBeNull();
  });

  it("matches nothing by a name that several listed clients read like", () => {
    const twins = { ...lists, clients: [{ id: "c1", name: "Twin Buyer Sdn. Bhd." }, { id: "c2", name: "Twin Buyer Pte. Ltd." }] };
    expect(checkReading({ ...reading, clientId: null, clientName: "Twin Buyer" }, twins, "po.pdf").form).toMatchObject({
      clientId: null,
      clientMatch: null,
      clientName: "Twin Buyer",
    });
  });
});

describe("applyDocumentFill", () => {
  it("fills empty fields the template shows and sizes it offers, never over a value", () => {
    const { fill } = checkReading(reading, lists, "po.pdf");
    const data = {
      modules: {
        // The inspection date starts as the day it is created; the form's date replaces it.
        header: { ...emptyHeader(), productCode: "KEPT", inspectionDate: "2026-10-11", comment: "note" },
        order_lots: { sizes: { L: { qtyCases: 7, lotNumbers: [], packingSite: null } } },
      },
      custom: {},
    };
    const result = applyDocumentFill(data, fill, template({ expiryDate: false }));
    expect(result.data.modules.header).toMatchObject({
      poNo: "PO-0001 (SO-0001)",
      productCode: "KEPT",
      inspectionDate: "2026-10-09",
      mfgDate: "2026-02-01",
      comment: "note",
    });
    expect(result.data.modules.order_lots).toEqual({
      sizes: {
        M: { qtyCases: 120, lotNumbers: ["LOT-A01", "LOT-A02"], packingSite: null },
        L: { qtyCases: 7, lotNumbers: [], packingSite: null },
      },
    });
    expect(result.filled).toEqual(["header.poNo", "header.inspectionDate", "header.mfgDate", "order_lots.M"]);
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
