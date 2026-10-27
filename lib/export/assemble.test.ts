// The template block's sizes, unit and running header (BUILD_SPEC 9.1,
// Phase 3: the report can be written without opening the app): the report's
// fixed size rows, whatever was ordered.
import { describe, expect, it } from "vitest";
import { ExportSchema } from "@/lib/schemas/export";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import { assembleExport, templateDetails } from "./assemble";
import { STD_EG_IDS as IDS, stdEgRecord } from "./__fixtures__/std-eg";
import { evaluateRecord } from "./evaluate";
import type { InspectionRecord } from "./record";
import { seedTemplate } from "@/tests/acceptance/examples";

const LINKS = { photos: new Map(), files: new Map(), clientLogo: null, sourceFile: null };

/** The STD_EG example assembled, before the export's schema validates it. */
function assembled(template?: (resolved: ResolvedTemplate) => ResolvedTemplate) {
  const base = stdEgRecord();
  const record = template && base.template ? { ...base, template: { ...base.template, resolved: template(base.template.resolved as ResolvedTemplate) } } : base;
  const evaluation = evaluateRecord(record);
  if (!evaluation.ok) throw new Error(evaluation.message);
  return assembleExport({ record, evaluated: evaluation.evaluated, links: LINKS, exportedAt: "2025-04-12T09:15:00.000Z" });
}

describe("templateDetails", () => {
  it("gives every size of the template in its order, with the name the report shows, and the unit", () => {
    expect(templateDetails(seedTemplate("STD_EG"))).toEqual({
      sizes: ["XS", "S", "M", "L", "XL"].map((value) => ({ value, label: value })),
      unit: "pcs",
      pageHeader: null,
    });
    // STD_SG counts pairs, in eight half sizes.
    const surgical = templateDetails(seedTemplate("STD_SG"));
    expect(surgical.unit).toBe("pairs");
    expect(surgical.sizes.map((size) => size.value)).toEqual(["5.5", "6.0", "6.5", "7.0", "7.5", "8.0", "8.5", "9.0"]);
  });

  it("carries a size's 'Shown As' and the header on later pages when the template sets them", () => {
    const template = seedTemplate("STD_EG");
    const details = templateDetails({
      ...template,
      sizes: template.sizes.map((size) => (size.value === "M" ? { ...size, label: "Medium" } : size)),
      report: { ...template.report, pageHeader: "Pre-shipment Inspection : {po} {product}" },
    });
    expect(details.sizes).toContainEqual({ value: "M", label: "Medium" });
    expect(details.pageHeader).toBe("Pre-shipment Inspection : {po} {product}");
  });
});

describe("assembleExport: the template block", () => {
  it("lists the template's sizes, unit and running header beside its code and title, not only the sizes ordered", () => {
    const doc = assembled((resolved) => ({ ...resolved, report: { ...resolved.report, pageHeader: "PSI : {po}" } }));
    expect(doc.template).toMatchObject({
      code: "STD_EG",
      sizes: ["XS", "S", "M", "L", "XL"].map((value) => ({ value, label: value })),
      unit: "pcs",
      pageHeader: "PSI : {po}",
    });
    // Only size M was ordered: the report's other rows come from the template.
    expect(Object.keys((doc.modules.find((module) => module.key === "order_lots")?.data.sizes ?? {}) as object)).toEqual(["M"]);
  });
});

describe("assembleExport: the Report page's options (Kenneth, 27 October 2026)", () => {
  /** The STD_EG example with these options saved beside its modules. */
  function withOptions(report: Record<string, unknown>, moduleOverrides: InspectionRecord["moduleOverrides"] = {}) {
    const base = stdEgRecord({ moduleOverrides });
    const record = { ...base, data: { ...(base.data as object), report } };
    const evaluation = evaluateRecord(record);
    if (!evaluation.ok) throw new Error(evaluation.message);
    return assembleExport({ record, evaluated: evaluation.evaluated, links: LINKS, exportedAt: "2025-04-12T09:15:00.000Z" });
  }

  it("gives an inspection saved before the Report page its defaults", () => {
    expect(assembled().report).toEqual({
      template: "standard_preshipment",
      pageSize: "a4",
      omittedSections: [],
      includePhotos: true,
      photosPerStep: 4,
      photoSize: "medium",
      title: "Pre-Shipment Inspection Report",
      showClientName: true,
      includeSummary: true,
      includeSignature: true,
      footerNote: null,
    });
  });

  it("carries the options saved with the inspection, the title and footer note trimmed", () => {
    const doc = withOptions({
      pageSize: "letter",
      includePhotos: false,
      photosPerStep: 6,
      photoSize: "small",
      title: "  Lot Release Report ",
      showClientName: false,
      includeSummary: false,
      includeSignature: false,
      footerNote: " Prepared for the client only. ",
    });
    expect(doc.report).toMatchObject({
      pageSize: "letter",
      includePhotos: false,
      photosPerStep: 6,
      photoSize: "small",
      title: "Lot Release Report",
      showClientName: false,
      includeSummary: false,
      includeSignature: false,
      footerNote: "Prepared for the client only.",
    });
    expect(ExportSchema.parse(doc).report).toEqual(doc.report);
    // A blank title is the default one.
    expect(withOptions({ title: "  " }).report?.title).toBe("Pre-Shipment Inspection Report");
  });

  it("leaves out every section on the page of a step switched off, by key, in export order", () => {
    const doc = withOptions({ omittedSteps: ["weight", "order_lots", "source_documents"] });
    // The order's page holds Glove Information and packing configuration; Source Documents' holds General Information.
    expect(doc.report?.omittedSections).toEqual(["header", "glove_info", "order_lots", "packing_config", "weight"]);
    const sections = doc.modules.map((module) => module.key as string);
    expect(doc.report?.omittedSections?.every((key) => sections.includes(key))).toBe(true);
    // Packing configuration switched off for the inspection: not in the report anyway, so not listed.
    const off = withOptions({ omittedSteps: ["order_lots"] }, { packing_config: { reason: "Not ordered.", by: IDS.inspector, at: "2025-04-11T01:00:00.000Z" } });
    expect(off.report?.omittedSections).toEqual(["glove_info", "order_lots"]);
    expect(off.excludedModules.map((module) => module.key)).toEqual(["packing_config"]);
  });
});
