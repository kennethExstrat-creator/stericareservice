// The Report page's layout preview (Kenneth, 27 October 2026: the design
// follows, the framework first): the pages it lays out follow the options.
import { describe, expect, it } from "vitest";
import { DEFAULT_REPORT_OPTIONS, type ReportOptions } from "@/lib/schemas/report-options";
import type { ReportStep } from "./report";
import { PHOTOS_PER_ROW, PREVIEW_LAYOUT, reportPreview, type PlacedBlock, type ReportPreview } from "./report-preview";

/** STD_EG's steps, as the Report page lists them. */
const STEPS: ReportStep[] = [
  ["source_documents", "Source Documents", "Source Documents"],
  ["order_lots", "Order Information", "Order"],
  ["sampling_plan", "Sampling Plan", "Sampling Plan"],
  ["carton_sampling", "Finished Goods Sampling Information (Box/Carton #)", "Box/Carton Numbers"],
  ["dimensions", "Dimension Measurement", "Dimension"],
  ["force_at_break", "Physical Properties", "Physical Properties"],
  ["weight", "Weight (g)", "Weight"],
  ["watertight", "Watertight Test", "Watertight Test"],
  ["visual", "Visual Inspection", "Visual Inspection"],
  ["conclusion", "Conclusion", "Conclusion"],
].map(([key, title, shortTitle]) => ({ key, title, shortTitle, sectionKeys: [key] }));

function preview(patch: Partial<ReportOptions> = {}): ReportPreview {
  return reportPreview({
    options: { ...DEFAULT_REPORT_OPTIONS, ...patch },
    steps: STEPS,
    refNo: "INS-2026-0042",
    clientName: "Client A",
    inspectorName: "Inspector A",
  });
}

const blocks = (doc: ReportPreview): PlacedBlock[] => doc.pages.flatMap((page) => page.blocks);
const sectionLabels = (doc: ReportPreview) => blocks(doc).flatMap((block) => (block.kind === "section" ? [block.label] : []));
/** Every step's photos, added up across the pages they run over. */
const photosOf = (doc: ReportPreview) => {
  const counts = new Map<string, number>();
  for (const block of blocks(doc)) if (block.kind === "photos") counts.set(block.key, (counts.get(block.key) ?? 0) + block.count);
  return counts;
};

describe("reportPreview", () => {
  it("starts with the cover: the title, the client and the inspection's reference number", () => {
    const first = preview().pages[0].blocks[0];
    expect(first).toMatchObject({ kind: "cover", title: "Pre-Shipment Inspection Report", client: "Client A", refNo: "INS-2026-0042" });
    expect(preview({ title: " Lot Release Report " }).pages[0].blocks[0]).toMatchObject({ title: "Lot Release Report" });
    expect(preview({ title: "" }).pages[0].blocks[0]).toMatchObject({ title: "Pre-Shipment Inspection Report" });
  });

  it("leaves the client's name off the cover while Show Client Name is off", () => {
    expect(preview({ showClientName: false }).pages[0].blocks[0]).toMatchObject({ kind: "cover", client: null });
  });

  it("shows each step in the report, in step order, by its short name, and none switched off", () => {
    expect(sectionLabels(preview())).toEqual(STEPS.map((step) => step.shortTitle));
    const fewer = preview({ omittedSteps: ["weight", "sampling_plan"] });
    expect(sectionLabels(fewer)).toEqual(STEPS.filter((step) => !["weight", "sampling_plan"].includes(step.key)).map((step) => step.shortTitle));
    expect(blocks(fewer).some((block) => "key" in block && block.key === "weight")).toBe(false);
    // Every step off: the cover, the summary and the signature on one page.
    const none = preview({ omittedSteps: STEPS.map((step) => step.key) });
    expect(none.pages).toHaveLength(1);
    expect(none.pages[0].blocks.map((block) => block.kind)).toEqual(["cover", "summary", "signature"]);
  });

  it("gives each step the chosen number of photos, as many to a row as their size allows, and none while photos are off", () => {
    for (const photosPerStep of [2, 4, 6] as const) {
      const counts = photosOf(preview({ photosPerStep }));
      expect([...counts.keys()]).toEqual(STEPS.map((step) => step.key));
      expect([...counts.values()].every((count) => count === photosPerStep)).toBe(true);
    }
    expect(PHOTOS_PER_ROW).toEqual({ small: 4, medium: 3, large: 2 });
    for (const photoSize of ["small", "medium", "large"] as const) {
      const grids = blocks(preview({ photoSize })).filter((block) => block.kind === "photos");
      expect(grids.every((grid) => grid.kind === "photos" && grid.perRow === PHOTOS_PER_ROW[photoSize] && grid.size === photoSize)).toBe(true);
    }
    const off = preview({ includePhotos: false });
    expect(photosOf(off).size).toBe(0);
    expect(off.pages.length).toBeLessThan(preview().pages.length);
    // Larger photos take more pages.
    expect(preview({ photoSize: "large", photosPerStep: 6 }).pages.length).toBeGreaterThan(preview({ photoSize: "small", photosPerStep: 2 }).pages.length);
  });

  it("draws the pages at the paper's ratio: A4 210 × 297 mm, Letter 215.9 × 279.4 mm", () => {
    expect(preview()).toMatchObject({ pageSize: "a4", width: 210, height: 297 });
    expect(preview({ pageSize: "letter" })).toMatchObject({ pageSize: "letter", width: 215.9, height: 279.4 });
    expect(preview().width / preview().height).toBeCloseTo(0.707, 3);
    expect(preview({ pageSize: "letter" }).width / preview({ pageSize: "letter" }).height).toBeCloseTo(0.773, 3);
  });

  it("ends with the Inspection Summary and the inspector's signature, together on the last page, each while it is on", () => {
    for (const doc of [preview(), preview({ includePhotos: false }), preview({ pageSize: "letter", photoSize: "large" })]) {
      expect(doc.pages.at(-1)!.blocks.slice(-2)).toMatchObject([{ kind: "summary" }, { kind: "signature", inspector: "Inspector A" }]);
    }
    expect(blocks(preview({ includeSummary: false })).some((block) => block.kind === "summary")).toBe(false);
    expect(blocks(preview({ includeSignature: false })).some((block) => block.kind === "signature")).toBe(false);
  });

  it("carries the reference number in the header and the footer note on every page, trimmed", () => {
    expect(preview()).toMatchObject({ header: "INS-2026-0042", footer: null });
    expect(preview({ footerNote: " Prepared for Client A only. " }).footer).toBe("Prepared for Client A only.");
  });

  it("keeps every block inside the page, numbers the pages, and keeps a step's title with its first row of photos", () => {
    const cases = [
      { doc: preview(), photos: true },
      { doc: preview({ pageSize: "letter", photoSize: "large", photosPerStep: 6 }), photos: true },
      { doc: preview({ includePhotos: false }), photos: false },
    ];
    for (const { doc, photos } of cases) {
      const top = PREVIEW_LAYOUT.margin + PREVIEW_LAYOUT.header + PREVIEW_LAYOUT.gap;
      const bottom = doc.height - PREVIEW_LAYOUT.margin - PREVIEW_LAYOUT.footer - PREVIEW_LAYOUT.gap;
      expect(doc.pages.map((page) => page.number)).toEqual(doc.pages.map((_, index) => index + 1));
      for (const page of doc.pages) {
        expect(page.blocks.length).toBeGreaterThan(0);
        for (const block of page.blocks) {
          expect(block.top).toBeGreaterThanOrEqual(top - 1e-9);
          expect(block.top + block.height).toBeLessThanOrEqual(bottom + 1e-9);
        }
        // A step's title never ends a page while its photos follow it.
        if (photos) expect(page.blocks.at(-1)?.kind).not.toBe("section");
      }
    }
  });
});
