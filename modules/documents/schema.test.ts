import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DOCUMENT_ITEMS as DICTIONARY_ITEMS, dataField, dataKeys, defaultConfig, defaultLabels, moduleTitle, TEMPLATES } from "@/lib/coverage";
import { Constants } from "@/lib/supabase/database.types";
import { lookupFrom, resolveTemplate } from "@/lib/templates";
import { MODULE_REGISTRY } from "@/modules/registry";
import { STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import {
  DOCUMENT_FIELDS,
  DOCUMENT_FILE_KIND,
  DOCUMENT_ITEMS,
  DOCUMENT_STATUSES,
  DOCUMENTS_DEFAULT_CONFIG,
  DOCUMENTS_LABELS,
  DOCUMENTS_TITLE,
  DocumentsConfigSchema,
} from "./config";
import { DocumentEntrySchema, DocumentItemsSchema, DocumentsDataSchema, emptyDocumentEntry, emptyDocuments } from "./schema";

describe("documents data", () => {
  it("starts with an empty slot for every item and accepts a draft with anything missing", () => {
    const empty = emptyDocuments();
    expect(Object.keys(empty.items)).toEqual([...DOCUMENT_ITEMS]);
    for (const item of DOCUMENT_ITEMS) {
      expect(empty.items[item]).toEqual({ status: null, referenceNo: null, expiryDate: null, file: null });
    }
    expect(DocumentsDataSchema.parse({ items: { iso13485: { status: "verified" } } }).items.iso13485).toEqual({
      ...emptyDocumentEntry(),
      status: "verified",
    });
  });

  it("uses the dictionary's items and entered keys (the file as its inspection_files id)", () => {
    expect([...DOCUMENT_ITEMS]).toEqual([...DICTIONARY_ITEMS]);
    expect(Object.keys(DocumentItemsSchema.shape)).toEqual([...DICTIONARY_ITEMS]);
    expect(Object.keys(DocumentEntrySchema.shape)).toEqual([...DOCUMENT_FIELDS]);
    expect(dataKeys("documents", "entered")).toEqual([...DOCUMENT_FIELDS]);
    expect(dataField("documents", "status")?.options).toEqual([...DOCUMENT_STATUSES]);
  });

  it("files each item's attachment as a certificate or a lab report (dictionary: file)", () => {
    const kinds: readonly string[] = Constants.public.Enums.inspection_file_kind;
    for (const item of DOCUMENT_ITEMS) expect(kinds).toContain(DOCUMENT_FILE_KIND[item]);
    expect(DOCUMENT_FILE_KIND.labTestReports).toBe("lab_report");
    expect(DOCUMENT_FILE_KIND.iso13485).toBe("certificate");
  });

  it("takes verified, not verified or NA, and nothing else", () => {
    for (const status of DOCUMENT_STATUSES) {
      expect(DocumentEntrySchema.safeParse({ status }).success).toBe(true);
    }
    for (const status of ["Verified", "ok", "yes", true, 1]) {
      expect(DocumentEntrySchema.safeParse({ status }).success).toBe(false);
    }
  });

  it("stores expiry dates from a date picker, never typed text or counts (6.2 rule 3)", () => {
    const date = (expiryDate: unknown) => DocumentEntrySchema.safeParse({ expiryDate }).success;
    expect(date(STD_EG_EXAMPLE.header.expiryDate.iso)).toBe(true);
    // The fixtures' dates as the reports printed them are not dates the app stores.
    expect(date(STD_EG_EXAMPLE.header.expiryDate.printed)).toBe(false);
    expect(date(STD_EG_EXAMPLE.header.inspectionDate.printed)).toBe(false);
    for (const value of ["Jan-30", "2030-01", "2030-02-30", 2030, "1/80"]) expect(date(value)).toBe(false);
  });

  it("rejects items and fields it does not have, the reserved comment included", () => {
    expect(DocumentsDataSchema.safeParse({ items: { packingList: { status: "verified" } } }).success).toBe(false);
    // A file is kept by its inspection_files id, never by name.
    expect(DocumentsDataSchema.safeParse({ items: { iso13485: { file: "x.pdf" } } }).success).toBe(false);
    expect(
      DocumentsDataSchema.safeParse({ items: { iso13485: { file: "00000000-0000-4000-8000-000000000501" } } }).success,
    ).toBe(true);
    expect(DocumentsDataSchema.safeParse({ items: {}, comment: "x" }).success).toBe(false);
  });
});

describe("documents config", () => {
  it("lists every item, on and not required, by default", () => {
    expect(DocumentsConfigSchema.parse(DOCUMENTS_DEFAULT_CONFIG)).toEqual(DOCUMENTS_DEFAULT_CONFIG);
    expect(DOCUMENTS_DEFAULT_CONFIG).toEqual(defaultConfig("documents"));
  });

  it("accepts every template's values in lib/coverage (no seed template includes the module yet)", () => {
    const configs = Object.values(TEMPLATES).flatMap((template) =>
      template.modules.flatMap((entry) => (entry.key === "documents" ? [entry.config] : [])),
    );
    for (const config of [defaultConfig("documents"), ...configs]) {
      expect(DocumentsConfigSchema.safeParse(config).success).toBe(true);
    }
  });

  it("switches items off, makes them required and reorders them", () => {
    const config = {
      items: [
        { key: "iso13485", include: true, required: true },
        { key: "certificateOfAnalysis", include: true, required: false },
        { key: "sterilisation", include: false, required: false },
      ],
    };
    expect(DocumentsConfigSchema.parse(config)).toEqual(config);
  });

  it("rejects an item listed twice, an unknown item and a mistyped key", () => {
    const twice = DocumentsConfigSchema.safeParse({
      items: [
        { key: "iso13485", include: true, required: true },
        { key: "iso13485", include: true, required: false },
      ],
    });
    expect(twice.success).toBe(false);
    expect(twice.error?.issues[0]?.path).toEqual(["items", 1, "key"]);
    expect(DocumentsConfigSchema.safeParse({ items: [{ key: "packingList", include: true, required: false }] }).success).toBe(
      false,
    );
    expect(DocumentsConfigSchema.safeParse({ items: [{ key: "fdaCe", include: true, mandatory: true }] }).success).toBe(false);
  });

  it("resolves in a template, a child replacing the item list whole", () => {
    const base = {
      code: "BASE_EG",
      name: TEMPLATES.STD_EG.name,
      scope: { productType: "examination", standard: "EN455" },
      unit: "pcs",
      sizes: TEMPLATES.STD_EG.sizes,
      modules: [{ key: "documents", include: true }],
    };
    const child = (items: unknown) => ({
      ...base,
      code: "CLIENT_EG",
      extends: "BASE_EG",
      modules: [{ key: "documents", include: true, labels: { fdaCe: "CE certificate" }, config: { items } }],
    });
    const resolve = (definition: unknown) =>
      resolveTemplate(definition, { getBase: lookupFrom([{ definition: base, version: 1 }]), registry: MODULE_REGISTRY });
    const documentsOf = (resolution: ReturnType<typeof resolve>) =>
      resolution.ok ? resolution.template.modules.find((entry) => entry.key === "documents") : undefined;

    expect(documentsOf(resolve(base))?.config).toEqual(DOCUMENTS_DEFAULT_CONFIG);
    const items = [
      { key: "fdaCe", include: true, required: true },
      { key: "certificateOfAnalysis", include: true, required: false },
    ];
    expect(documentsOf(resolve(child(items)))).toMatchObject({
      config: { items },
      labels: { fdaCe: "CE certificate", iso13485: "ISO 13485" },
    });
    expect(resolve(child([...items, items[0]])).ok).toBe(false);
  });

  it("becomes JSON Schema with descriptions, for the template editor's form", () => {
    const schema = z.toJSONSchema(DocumentsConfigSchema) as unknown as {
      properties: { items: { description?: string; items: { properties: Record<string, { description?: string }> } } };
    };
    expect(schema.properties.items.description).toContain("required");
    expect(schema.properties.items.items.properties.required.description).toContain("verified");
  });
});

describe("documents wording", () => {
  it("defaults to the data dictionary's title and labels, with words for each status", () => {
    expect(DOCUMENTS_TITLE).toBe(moduleTitle("STD_EG", "documents"));
    expect({ ...DOCUMENTS_LABELS }).toEqual(defaultLabels("documents"));
    expect(DOCUMENT_STATUSES.map((status) => DOCUMENTS_LABELS[`status.${status}`])).toEqual(["Verified", "Not Verified", "NA"]);
    expect(DOCUMENTS_LABELS.required).toBe("Required");
  });
});
