import { describe, expect, it } from "vitest";
import { labelOverrides } from "@/lib/coverage";
import {
  baseContext,
  buildInspectionContext,
  evaluateInspection,
  inspectionRowValues,
  type CalcInput,
  type InspectionMeta,
} from "@/modules/_framework";
import { checkModuleContract, makeTestTemplate } from "@/modules/_framework/testing";
import { MODULE_REGISTRY } from "@/modules/registry";
import { SAFEDON_EG_EXAMPLE, STD_EG_EXAMPLE, STD_EG_EXPECTED } from "@/tests/fixtures/examples";
import { headerData, headerMeta } from "./__fixtures__/examples";
import { calcHeader, contributeHeader } from "./calc";
import { HEADER_DEFAULT_CONFIG, HEADER_LABELS, type HeaderConfig } from "./config";
import { definition } from "./index";
import { emptyHeader, type HeaderData } from "./schema";

const TEMPLATE = makeTestTemplate(MODULE_REGISTRY, []);

const STD_EG_DATA = headerData(STD_EG_EXAMPLE.header);
const STD_EG_META = headerMeta(STD_EG_EXAMPLE.header);
const SAFEDON_DATA = headerData(SAFEDON_EG_EXAMPLE.header);
const SAFEDON_META = headerMeta(SAFEDON_EG_EXAMPLE.header);

/** SAFEDON_EG's header: no client or factory glove code rows, month and year dates, its own wording. */
const SAFEDON_CONFIG: HeaderConfig = {
  fields: { ...HEADER_DEFAULT_CONFIG.fields, client: false, factoryGloveCode: false },
  mfgExpiryPrecision: "month",
};
const SAFEDON_LABELS = { ...HEADER_LABELS, ...labelOverrides("SAFEDON_EG", "header") };

function withFields(fields: Partial<HeaderConfig["fields"]>, config: HeaderConfig = HEADER_DEFAULT_CONFIG): HeaderConfig {
  return { ...config, fields: { ...config.fields, ...fields } };
}

function input(
  data: Partial<HeaderData>,
  {
    config = HEADER_DEFAULT_CONFIG,
    labels = HEADER_LABELS,
    meta = STD_EG_META,
  }: { config?: HeaderConfig; labels?: Record<string, string>; meta?: InspectionMeta } = {},
): CalcInput<HeaderData, HeaderConfig> {
  return {
    data: { ...emptyHeader(), ...data },
    config,
    title: "Manufacturer Information",
    labels,
    context: baseContext({ template: TEMPLATE, meta }),
    results: {},
    hasData: true,
  };
}

describe("header", () => {
  it("satisfies the module contract", () => {
    expect(checkModuleContract(definition)).toEqual([]);
  });

  it("is info for the STD_EG example, whose client and factory glove code are blank", () => {
    expect(STD_EG_DATA).toMatchObject({ factoryGloveCode: null, productCode: "PC-A01" });
    expect(STD_EG_META.client).toBeNull();
    expect(calcHeader(input(STD_EG_DATA))).toEqual({
      result: {
        status: "info",
        summary: "PO-0001 (SO-0001): Brand A PC-A01 Blue Nitrile; Manufacturer A (Factory A1); Inspection Date 11 Apr 2025.",
      },
      computed: {
        manufacturer: "Manufacturer A (Factory A1)",
        client: null,
        inspector: "Inspector A",
        inspectionDate: "2025-04-11",
        mfgDate: "2025-04-01",
        expiryDate: "2030-03-01",
      },
      issues: [],
    });
  });

  it("is info for the SAFEDON_EG example: month and year dates, no product code of its own", () => {
    const output = calcHeader(input(SAFEDON_DATA, { config: SAFEDON_CONFIG, labels: SAFEDON_LABELS, meta: SAFEDON_META }));
    expect(output.result.status).toBe("info");
    // The day in the words the list and the review show it in ("19 Feb 2025"), never ISO; the computed values keep ISO.
    expect(output.result.summary).toMatch(/; Inspection Date 19 Feb 2025\.$/);
    expect(output.result.summary).not.toContain("2025-02-19");
    expect(output.issues).toEqual([]);
    expect(output.computed).toEqual({
      manufacturer: "Manufacturer B",
      client: "Client A",
      inspector: "Inspector A",
      inspectionDate: "2025-02-19",
      mfgDate: "2025-02",
      expiryDate: "2030-01",
    });
  });

  it("is not done while a row the template shows is empty, naming it in the template's wording (6.2 rule 5)", () => {
    const output = calcHeader(
      input({ ...SAFEDON_DATA, poNo: "  ", expiryDate: null }, { config: SAFEDON_CONFIG, labels: SAFEDON_LABELS, meta: SAFEDON_META }),
    );
    expect(output.result).toEqual({ status: "not_done", summary: "Missing: PO Number, Expiry Date." });
    expect(calcHeader(input({})).result).toEqual({
      status: "not_done",
      summary:
        "Missing: Supplier Factory Address / Location, PO / SO Number, Product Name (Brand, Code & Description), Manufacturing Date, Expiry Date.",
    });
  });

  it("asks only for the rows the template shows", () => {
    // STD_SG: no factory address, client or factory glove code on the SG form.
    const sg = withFields({ factoryAddress: false, client: false, factoryGloveCode: false });
    expect(calcHeader(input({ ...STD_EG_DATA, factoryAddress: null }, { config: sg })).result.status).toBe("info");
    const none = withFields(Object.fromEntries(Object.keys(HEADER_DEFAULT_CONFIG.fields).map((field) => [field, false])));
    expect(calcHeader(input({}, { config: none })).result).toEqual({ status: "info", summary: "No fields are switched on." });
  });

  it("shows the manufacturer, the client and the inspector from the inspection, never typed (6.2 rules 10 and 11)", () => {
    const noManufacturer = calcHeader(input(STD_EG_DATA, { meta: { ...STD_EG_META, manufacturer: null } }));
    expect(noManufacturer.result).toEqual({ status: "not_done", summary: "Missing: Manufacturer / Supplier." });
    const noInspector = calcHeader(input(STD_EG_DATA, { meta: { ...STD_EG_META, inspector: null } }));
    expect(noInspector.result).toEqual({ status: "not_done", summary: "Missing: Inspected By." });
    expect(noInspector.computed.inspector).toBeNull();
    // With its row off the inspector is still recorded; the framework reports one that is missing.
    const rowOff = calcHeader(input(STD_EG_DATA, { config: withFields({ inspector: false }) }));
    expect(rowOff).toMatchObject({ result: { status: "info" }, computed: { inspector: "Inspector A" } });
  });

  it("takes the inspection row's date while the header has none of its own", () => {
    const fromRow = calcHeader(input({ ...STD_EG_DATA, inspectionDate: null }));
    expect(fromRow.result.status).toBe("info");
    expect(fromRow.computed.inspectionDate).toBe("2025-04-11");
    const own = calcHeader(input({ ...STD_EG_DATA, inspectionDate: "2025-04-12" }));
    expect(own.computed.inspectionDate).toBe("2025-04-12");
    const neither = calcHeader(input({ ...STD_EG_DATA, inspectionDate: null }, { meta: { ...STD_EG_META, inspectionDate: null } }));
    expect(neither.result).toEqual({ status: "not_done", summary: "Missing: Inspection Date." });
  });

  it("warns when the expiry date is not after the manufacturing date, with a link to it (BUILD_SPEC 6.1)", () => {
    for (const [expiryDate, words] of [
      ["2025-04-01", "1 Apr 2025"],
      ["2024-04-01", "1 Apr 2024"],
    ]) {
      const output = calcHeader(input({ ...STD_EG_DATA, expiryDate }));
      const message = `Expiry Date ${words} is not after Manufacturing Date 1 Apr 2025.`;
      expect(output.result).toEqual({ status: "warn", summary: message });
      expect(output.issues).toEqual([{ level: "warning", code: "expiry_not_after_mfg", message, path: ["expiryDate"] }]);
    }
    // Still raised while the header is not done; missing data comes first.
    const incomplete = calcHeader(input({ ...STD_EG_DATA, poNo: null, expiryDate: "2025-04-01" }));
    expect(incomplete.result.status).toBe("not_done");
    expect(incomplete.issues.map((issue) => issue.code)).toEqual(["expiry_not_after_mfg"]);
  });

  it("compares months when the template prints month and year (SAFEDON_EG)", () => {
    const options = { config: SAFEDON_CONFIG, labels: SAFEDON_LABELS, meta: SAFEDON_META };
    const sameMonth = calcHeader(input({ ...SAFEDON_DATA, mfgDate: "2025-01-01", expiryDate: "2025-01-20" }, options));
    expect(sameMonth.issues).toEqual([
      {
        level: "warning",
        code: "expiry_not_after_mfg",
        message: "Expiry Date Jan 2025 is not after Manufacturing Date Jan 2025.",
        path: ["expiryDate"],
      },
    ]);
    const nextMonth = calcHeader(input({ ...SAFEDON_DATA, mfgDate: "2025-01-01", expiryDate: "2025-02-01" }, options));
    expect(nextMonth.issues).toEqual([]);
  });

  it("warns when the gloves were made after the inspection date: a mistyped year or month", () => {
    const output = calcHeader(input({ ...STD_EG_DATA, mfgDate: "2026-04-01" }));
    expect(output.result.status).toBe("warn");
    expect(output.issues).toEqual([
      {
        level: "warning",
        code: "mfg_after_inspection",
        message: "Manufacturing Date 1 Apr 2026 is after Inspection Date 11 Apr 2025.",
        path: ["mfgDate"],
      },
    ]);
    // Month precision: February 2025 is not after 19 February 2025; March is.
    const options = { config: SAFEDON_CONFIG, labels: SAFEDON_LABELS, meta: SAFEDON_META };
    expect(calcHeader(input(SAFEDON_DATA, options)).issues).toEqual([]);
    expect(calcHeader(input({ ...SAFEDON_DATA, mfgDate: "2025-03-01" }, options)).issues).toEqual([
      expect.objectContaining({ message: "Manufacturing Date Mar 2025 is after Inspection Date 19 Feb 2025." }),
    ]);
  });

  it("checks no date the template does not show", () => {
    const config = withFields({ mfgDate: false });
    expect(calcHeader(input({ ...STD_EG_DATA, mfgDate: "2031-01-01" }, { config })).issues).toEqual([]);
  });

  it("passes PO, product name, product code and dates forward, trimmed, blanks left out (6.2 rule 10)", () => {
    expect(contributeHeader({ data: STD_EG_DATA, config: HEADER_DEFAULT_CONFIG })).toEqual({
      header: {
        poNo: "PO-0001 (SO-0001)",
        productName: "Brand A PC-A01 Blue Nitrile",
        productCode: "PC-A01",
        inspectionDate: "2025-04-11",
        mfgDate: "2025-04-01",
        expiryDate: "2030-03-01",
      },
    });
    expect(contributeHeader({ data: { ...SAFEDON_DATA, poNo: " PO-0002 (REF-0002) " }, config: SAFEDON_CONFIG })).toEqual({
      header: {
        poNo: "PO-0002 (REF-0002)",
        productName: "Brand B Nitrile PF Examination Gloves",
        inspectionDate: "2025-02-19",
        mfgDate: "2025-02-01",
        expiryDate: "2030-01-01",
      },
    });
    expect(contributeHeader({ data: STD_EG_DATA, config: withFields({ productCode: false, mfgDate: false }) }).header).not.toHaveProperty(
      "productCode",
    );
    expect(contributeHeader({ data: emptyHeader(), config: HEADER_DEFAULT_CONFIG })).toEqual({ header: {} });
  });
});

describe("header through the engine", () => {
  function evaluate(data: HeaderData, meta: InspectionMeta) {
    const template = makeTestTemplate(MODULE_REGISTRY, ["header"]);
    const inspection = { modules: { header: { ...data, comment: "Checked against the PO." } }, custom: {} };
    const context = buildInspectionContext({ template, data: inspection, meta }, MODULE_REGISTRY);
    return { context, evaluation: evaluateInspection({ template, data: inspection, context }, MODULE_REGISTRY) };
  }

  it("enters the product code once and uses that one value everywhere (STD_EG: PC-A02 in the file name)", () => {
    const { context, evaluation } = evaluate(STD_EG_DATA, STD_EG_META);
    expect(context.header).toEqual({
      client: null,
      manufacturer: "Manufacturer A (Factory A1)",
      poNo: "PO-0001 (SO-0001)",
      productName: "Brand A PC-A01 Blue Nitrile",
      productCode: STD_EG_EXPECTED.productCode.code,
      inspectionDate: "2025-04-11",
      mfgDate: "2025-04-01",
      expiryDate: "2030-03-01",
    });
    expect(context.header.productCode).not.toBe(STD_EG_EXAMPLE.header.productCodeElsewhere?.code);
    expect(inspectionRowValues(context)).toMatchObject({ po_no: "PO-0001 (SO-0001)", product_name: "Brand A PC-A01 Blue Nitrile" });
    const header = evaluation.modules.find((entry) => entry.key === "header");
    expect(header).toMatchObject({ result: { status: "info" }, comment: "Checked against the PO.", issues: [] });
  });

  it("records the inspector automatically; without one, submit is blocked (6.2 rule 11)", () => {
    expect(STD_EG_EXPECTED.inspector.recordedAutomatically).toBe(true);
    const recorded = evaluate(STD_EG_DATA, STD_EG_META).evaluation;
    expect(recorded.modules[0].computed).toMatchObject({ inspector: "Inspector A" });
    expect(recorded.issues.filter((issue) => issue.code === "inspector_missing")).toEqual([]);

    const missing = evaluate(STD_EG_DATA, { ...STD_EG_META, inspector: null }).evaluation;
    expect(missing.issues).toContainEqual(
      expect.objectContaining({ level: "error", moduleKey: "header", code: "inspector_missing" }),
    );
  });

  it("keeps the inspection row's date in the context while the header has none", () => {
    const { context } = evaluate({ ...STD_EG_DATA, inspectionDate: null }, STD_EG_META);
    expect(context.header.inspectionDate).toBe("2025-04-11");
  });
});
