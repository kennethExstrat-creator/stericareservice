// The template block's sizes, unit and running header (BUILD_SPEC 9.1,
// Phase 3: the report can be written without opening the app): the report's
// fixed size rows, whatever was ordered.
import { describe, expect, it } from "vitest";
import { ExportSchema } from "@/lib/schemas/export";
import { DEFAULT_REPORT_OPTIONS } from "@/lib/schemas/report-options";
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

  it("gives an inspection saved before the Report page its defaults: everything shown", () => {
    const report = ExportSchema.parse(assembled()).report;
    expect(report).toEqual({ ...DEFAULT_REPORT_OPTIONS, footerNote: null });
  });

  it("carries the options saved with the inspection, the title and footer note trimmed", () => {
    const doc = withOptions({
      pageSize: "letter",
      title: "  Lot Release Report ",
      showClient: false,
      footerNote: " Prepared for the client only. ",
      summary: { orderMix: false },
      sections: { packing: { blocks: { agedGloves: false } } },
      photos: { perGroup: 12, groups: { samplingPackaging: false } },
    });
    expect(doc.report).toMatchObject({
      pageSize: "letter",
      title: "Lot Release Report",
      showClient: false,
      footerNote: "Prepared for the client only.",
      summary: { orderMix: false, inspectionSummary: true, resultsByCheck: true },
      photos: { perGroup: 12, groups: { samplingPackaging: false, packingVisualAgeing: true, watertightLaboratory: true } },
    });
    expect(doc.report?.sections?.packing).toEqual({
      include: true,
      blocks: { averageLayeringDispensing: true, perBoxResults: true, agedGloves: false, stickinessGrades: true },
    });
    expect(ExportSchema.parse(doc).report).toEqual(doc.report);
    // A blank title is the default one.
    expect(withOptions({ title: "  " }).report?.title).toBe("Pre-Shipment Inspection Report");
  });

  it("says what the report shows: a section switched off, or none of whose modules the inspection includes, goes out off", () => {
    const off = withOptions({ sections: { dimensions: { include: false } } });
    expect(off.report?.sections?.dimensions?.include).toBe(false);
    expect(off.report?.sections?.measurements?.include).toBe(true);
    // STD_EG versions 1 to 4 have force at break and the packing check: both sections are its own.
    expect(off.report?.sections?.forceAtBreak?.include).toBe(true);
    // Every module of Section 03 switched off for the inspection: out, whatever its switch says.
    const switchedOff = withOptions({}, {
      dimensions: { reason: "Calipers out.", by: IDS.inspector, at: "2025-04-11T01:00:00.000Z" },
      weight: { reason: "Scale out.", by: IDS.inspector, at: "2025-04-11T01:00:00.000Z" },
    });
    expect(switchedOff.report?.sections?.dimensions?.include).toBe(false);
    expect(switchedOff.report?.sections?.measurements?.include).toBe(false);
    expect(switchedOff.report?.sections?.holesVisual?.include).toBe(true);
  });

  it("reads options saved in the first shape (a switch per capture step) into the design's", () => {
    const doc = withOptions({ omittedSteps: ["weight"], showClientName: false, includePhotos: false });
    expect(doc.report?.showClient).toBe(false);
    expect(doc.report?.sections?.dimensions?.blocks).toMatchObject({ weightPerGlove: false, gloveLength: true });
    expect(doc.report?.photos?.groups).toEqual({ samplingPackaging: false, packingVisualAgeing: false, watertightLaboratory: false });
  });
});
