import { describe, expect, it } from "vitest";
import { MODULE_REGISTRY } from "@/modules/registry";
import { buildInspectionContext, evaluateInspection, type CalcInput, type InspectionContext } from "@/modules/_framework";
import { checkModuleContract, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { SAFEDON_EG_EXAMPLE, STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { calcDocuments, isExpired } from "./calc";
import { DOCUMENT_ITEMS, DOCUMENTS_DEFAULT_CONFIG, DOCUMENTS_LABELS, type DocumentItem, type DocumentsConfig } from "./config";
import { definition } from "./index";
import { emptyDocuments, type DocumentEntry, type DocumentsData } from "./schema";

// The example reports' inspection dates (fictional, as in the fixtures).
const STD_EG_INSPECTED = STD_EG_EXAMPLE.header.inspectionDate.iso;
const SAFEDON_EG_INSPECTED = SAFEDON_EG_EXAMPLE.header.inspectionDate.iso;

function dayBefore(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function documents(entries: Partial<Record<DocumentItem, Partial<DocumentEntry>>>): DocumentsData {
  const data = emptyDocuments();
  for (const [key, entry] of Object.entries(entries) as [DocumentItem, Partial<DocumentEntry>][]) {
    data.items[key] = { ...data.items[key], ...entry };
  }
  return data;
}

function allVerified(): Partial<Record<DocumentItem, Partial<DocumentEntry>>> {
  return Object.fromEntries(DOCUMENT_ITEMS.map((key) => [key, { status: "verified" }]));
}

function input(
  data: DocumentsData,
  {
    config = DOCUMENTS_DEFAULT_CONFIG,
    inspectionDate = STD_EG_INSPECTED,
    labels = DOCUMENTS_LABELS,
  }: { config?: DocumentsConfig; inspectionDate?: string | null; labels?: Record<string, string> } = {},
): CalcInput<DocumentsData, DocumentsConfig> {
  const blank = makeTestContext();
  return {
    data,
    config,
    title: "Documents",
    labels,
    context: makeTestContext({ header: { ...blank.header, inspectionDate } }),
    results: {},
    hasData: true,
  };
}

function withItems(items: DocumentsConfig["items"]): DocumentsConfig {
  return { items };
}

const REQUIRE_ISO_AND_FDA = withItems(
  DOCUMENT_ITEMS.map((key) => ({ key, include: true, required: key === "iso13485" || key === "fdaCe" })),
);

describe("documents", () => {
  it("satisfies the module contract", () => {
    expect(checkModuleContract(definition)).toEqual([]);
    expect(definition.perSize).toBe(false);
  });

  it("passes once every item has a status and nothing required is unverified", () => {
    expect(calcDocuments(input(documents(allVerified())))).toEqual({
      result: { status: "pass", summary: "6 Verified." },
      computed: {
        expired: Object.fromEntries(DOCUMENT_ITEMS.map((key) => [key, null])),
        counts: { verified: 6, not_verified: 0, na: 0, open: 0 },
      },
      issues: [],
    });
    const mixed = documents({ ...allVerified(), sterilisation: { status: "na" }, declarationOfOrigin: { status: "not_verified" } });
    expect(calcDocuments(input(mixed, { config: REQUIRE_ISO_AND_FDA })).result).toEqual({
      status: "pass",
      summary: "4 Verified, 1 Not verified, 1 NA.",
    });
  });

  it("fails when a required item is not verified, or marked NA", () => {
    const notVerified = documents({ ...allVerified(), iso13485: { status: "not_verified" } });
    expect(calcDocuments(input(notVerified, { config: REQUIRE_ISO_AND_FDA })).result).toEqual({
      status: "fail",
      summary: "Required, not verified: ISO 13485.",
    });
    const na = documents({ ...allVerified(), iso13485: { status: "na" }, fdaCe: { status: "not_verified" } });
    expect(calcDocuments(input(na, { config: REQUIRE_ISO_AND_FDA })).result).toEqual({
      status: "fail",
      summary: "Required, not verified: ISO 13485, FDA / CE certificates.",
    });
  });

  it("is not done while an item on the checklist has no status (6.2 rule 5)", () => {
    const output = calcDocuments(input(documents({ iso13485: { status: "verified", referenceNo: "CERT-0001" } })));
    expect(output.result).toEqual({
      status: "not_done",
      summary:
        "Missing: Certificate of analysis, Lab test reports, Sterilisation certificate and records, FDA / CE certificates, Declaration of origin.",
    });
    expect(output.computed.counts).toEqual({ verified: 1, not_verified: 0, na: 0, open: 5 });
    expect(calcDocuments(input(emptyDocuments())).result.status).toBe("not_done");
  });

  it("fails before it is complete when a required item is already unverified", () => {
    const output = calcDocuments(input(documents({ iso13485: { status: "not_verified" } }), { config: REQUIRE_ISO_AND_FDA }));
    expect(output.result.status).toBe("fail");
    expect(output.result.summary).toMatch(/^Required, not verified: ISO 13485\. Missing: Certificate of analysis, /);
  });

  it("warns when an expiry date is before the inspection date, with a link to the date", () => {
    const expiredDay = dayBefore(STD_EG_INSPECTED);
    const data = documents({
      ...allVerified(),
      iso13485: { status: "verified", referenceNo: "CERT-0001", expiryDate: expiredDay },
      fdaCe: { status: "verified", expiryDate: STD_EG_INSPECTED },
    });
    const output = calcDocuments(input(data));
    expect(output.result).toEqual({ status: "warn", summary: `Expired: ISO 13485 (${expiredDay}). 6 Verified.` });
    expect(output.computed.expired).toMatchObject({ iso13485: true, fdaCe: false, labTestReports: null });
    expect(output.issues).toEqual([
      {
        level: "warning",
        code: "document_expired",
        message: `ISO 13485: Expiry date ${expiredDay} is before the inspection date ${STD_EG_INSPECTED}.`,
        path: ["items", "iso13485", "expiryDate"],
      },
    ]);
  });

  it("compares with the inspection date from the context, as each example report would", () => {
    // A certificate valid on the SAFEDON_EG inspection date but lapsed by the STD_EG one.
    const expiry = dayBefore(STD_EG_INSPECTED);
    expect(SAFEDON_EG_INSPECTED < expiry).toBe(true);
    const data = documents({ ...allVerified(), iso13485: { status: "verified", expiryDate: expiry } });
    expect(calcDocuments(input(data, { inspectionDate: SAFEDON_EG_INSPECTED })).result.status).toBe("pass");
    expect(calcDocuments(input(data, { inspectionDate: STD_EG_INSPECTED })).result.status).toBe("warn");
    // No inspection date to compare with: nothing is called expired.
    const unknown = calcDocuments(input(data, { inspectionDate: null }));
    expect(unknown.result.status).toBe("pass");
    expect(unknown.computed.expired.iso13485).toBeNull();
  });

  it("ignores the expiry date of an item marked NA", () => {
    const data = documents({ ...allVerified(), sterilisation: { status: "na", expiryDate: "2001-01-01" } });
    const output = calcDocuments(input(data));
    expect(output.result.status).toBe("pass");
    expect(output.computed.expired.sterilisation).toBeNull();
    expect(output.issues).toEqual([]);
  });

  it("names a fail and an expired item together", () => {
    const data = documents({
      ...allVerified(),
      iso13485: { status: "not_verified" },
      fdaCe: { status: "verified", expiryDate: "2020-06-30" },
    });
    const output = calcDocuments(input(data, { config: REQUIRE_ISO_AND_FDA }));
    expect(output.result).toEqual({
      status: "fail",
      summary: "Required, not verified: ISO 13485. Expired: FDA / CE certificates (2020-06-30).",
    });
    expect(output.issues.map((issue) => issue.code)).toEqual(["document_expired"]);
  });

  it("checks only the items the template switches on, in its order", () => {
    const config = withItems([
      { key: "iso13485", include: true, required: true },
      { key: "certificateOfAnalysis", include: true, required: false },
      { key: "sterilisation", include: false, required: true },
    ]);
    const data = documents({ iso13485: { status: "verified" }, sterilisation: { status: "not_verified" } });
    const output = calcDocuments(input(data, { config }));
    expect(output.result).toEqual({ status: "not_done", summary: "Missing: Certificate of analysis." });
    expect(Object.keys(output.computed.expired)).toEqual(["iso13485", "certificateOfAnalysis"]);
    const done = documents({ iso13485: { status: "verified" }, certificateOfAnalysis: { status: "na" } });
    expect(calcDocuments(input(done, { config })).result).toEqual({ status: "pass", summary: "1 Verified, 1 NA." });
  });

  it("has no verdict when the template switches every item off", () => {
    const config = withItems(DOCUMENT_ITEMS.map((key) => ({ key, include: false, required: false })));
    expect(calcDocuments(input(emptyDocuments(), { config })).result).toEqual({
      status: "info",
      summary: "No documents are switched on.",
    });
  });

  it("speaks the template's wording", () => {
    const labels = {
      ...DOCUMENTS_LABELS,
      iso13485: "Quality system certificate",
      expiryDate: "Valid until",
      "status.verified": "OK",
      "status.na": "N/A",
    };
    const data = documents({ ...allVerified(), iso13485: { status: "verified", expiryDate: "2024-01-31" }, fdaCe: { status: "na" } });
    const output = calcDocuments(input(data, { labels }));
    expect(output.result.summary).toBe("Expired: Quality system certificate (2024-01-31). 5 OK, 1 N/A.");
    expect(output.issues[0]?.message).toBe(
      `Quality system certificate: Valid until 2024-01-31 is before the inspection date ${STD_EG_INSPECTED}.`,
    );
  });

  it("reads expiry against the inspection date only when both are dates", () => {
    expect(isExpired("2025-04-10", "2025-04-11")).toBe(true);
    expect(isExpired("2025-04-11", "2025-04-11")).toBe(false);
    expect(isExpired("2030-01-01", "2025-04-11")).toBe(false);
    expect(isExpired(null, "2025-04-11")).toBeNull();
    expect(isExpired("2025-04-10", null)).toBeNull();
    expect(isExpired("Jan-30", "2025-04-11")).toBeNull();
  });

  it("works through the engine, with the inspection date from the inspection row", () => {
    const template = makeTestTemplate(MODULE_REGISTRY, [
      { key: "documents", config: REQUIRE_ISO_AND_FDA, labels: { ...DOCUMENTS_LABELS, fdaCe: "CE certificate" } },
    ]);
    const data = {
      modules: {
        documents: {
          ...documents({ ...allVerified(), fdaCe: { status: "not_verified", referenceNo: "CE-0001" } }),
          comment: "CE certificate held by the client.",
        },
      },
      custom: {},
    };
    const context: InspectionContext = buildInspectionContext(
      { template, data, meta: { inspectionDate: SAFEDON_EG_INSPECTED } },
      MODULE_REGISTRY,
    );
    const evaluation = evaluateInspection({ template, data, context }, MODULE_REGISTRY);
    const found = evaluation.modules.find((entry) => entry.key === "documents");
    expect(found).toMatchObject({
      result: { status: "fail", summary: "Required, not verified: CE certificate." },
      comment: "CE certificate held by the client.",
      issues: [],
    });
    expect(evaluation.suggested.result).toBe("fail");
  });

  it("refuses a typed date saved where a picked one belongs, through the engine (6.2 rule 3)", () => {
    const template = makeTestTemplate(MODULE_REGISTRY, ["documents"]);
    const data = { modules: { documents: { items: { iso13485: { expiryDate: "Jan-30" } } } }, custom: {} };
    const context = buildInspectionContext({ template, data }, MODULE_REGISTRY);
    const found = evaluateInspection({ template, data, context }, MODULE_REGISTRY).modules.find(
      (entry) => entry.key === "documents",
    );
    expect(found?.result.status).toBe("not_done");
    expect(found?.issues).toContainEqual(
      expect.objectContaining({ level: "error", code: "invalid_data", path: ["items", "iso13485", "expiryDate"] }),
    );
  });
});
