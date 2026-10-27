// The photo records from the placeholder example reports (STD_EG's five
// photos, two marked In Report and a flagged HEIC original; SAFEDON_EG has
// none) and placeholder photos tagged as the capture screen and Source
// Documents' Media tag them: each photo in its group, the captions, the
// notes, Photos per Group, the numbering and the pages: the records sharing
// them (INS-2026-2442's two records on one page, three with its sampling
// photos), a record starting the next page where its opening does not fit,
// and a group breaking between its rows.
import { describe, expect, it } from "vitest";
import { counted } from "@/lib/report/format";
import { textWidth } from "@/lib/report/measure";
import { at, num } from "@/lib/report/read";
import type { ExportPhoto, InspectionExport } from "@/lib/schemas/export";
import { REPORT_PHOTO_GROUPS, type ReportPhotoGroupKey } from "@/lib/schemas/report-options";
import { makeSafedonExport, makeStdEgExport, withReportOptions } from "../__fixtures__/exports";
import { buildReportModel, type PhotoBlock, type PhotosSection } from "../model";
import { describedDefectsExport, fourSizeProductDefectsExport } from "./__fixtures__/holes-visual";
import {
  buildPhotos,
  CONTINUED_GROUP,
  MEDIA_PHOTO_BLOCK,
  MODULE_PHOTO_BLOCK,
  PHOTO_BLOCKS,
  PHOTO_ROOM,
  photoBlockHeight,
  photoPages,
  photoRecordsOf,
  photoRows,
  photos,
  shared,
} from "./photos";

let next = 0;

/** A placeholder photo tagged as the capture screen tags it. */
function photo(moduleKey: string | null, target: string | null = null, caption: string | null = null, extra: Partial<ExportPhoto> = {}): ExportPhoto {
  next += 1;
  return {
    id: `00000000-0000-4000-8000-${String(900000 + next).padStart(12, "0")}`,
    url: `https://storage.example.com/inspection-photos/placeholder-${next}.jpg?token=placeholder`,
    moduleKey,
    target,
    caption,
    takenAt: null,
    includeInReport: false,
    flagged: false,
    description: null,
    markers: [],
    size: { width: 4032, height: 3024 },
    ...extra,
  };
}

const ALL_ON = { samplingPackaging: true, packingVisualAgeing: true, watertightLaboratory: true };

/** STD_EG with these photos, every record on, at most `perGroup` a record. */
function withPhotos(list: ExportPhoto[], perGroup: 4 | 8 | 12 = 12, groups: Partial<Record<ReportPhotoGroupKey, boolean>> = {}): InspectionExport {
  const doc = makeStdEgExport();
  doc.photos = list;
  return withReportOptions(doc, { photos: { groups: { ...ALL_ON, ...groups }, perGroup } });
}

/** Each record's groups as keys, and each group's photos by their ids. */
const layoutOf = (doc: InspectionExport) =>
  Object.fromEntries(photoRecordsOf(doc).map((record) => [record.key, Object.fromEntries(record.blocks.map((block) => [block.key, block.photos.map((tile) => tile.id)]))]));

/** The records as the pages print them, page after page: a record going on to the next page comes twice. */
const partsOf = (section: PhotosSection | null) => (section?.pages ?? []).flatMap((page) => page.records);

const blockIn = (doc: InspectionExport, key: string): PhotoBlock => {
  const found = photoRecordsOf(doc)
    .flatMap((record) => record.blocks)
    .find((block) => block.key === key);
  if (!found) throw new Error(`No ${key} group.`);
  return found;
};

describe("the photo records", () => {
  it("print STD_EG's photos marked In Report in the design's groups, numbered among those shown, the two records on one page", () => {
    const doc = makeStdEgExport();
    const section = buildPhotos(doc);
    expect(section?.pageCount).toBe(1);
    expect(
      section?.pages.map((page) =>
        page.records.map((record) => [
          record.kicker,
          record.title,
          record.blocks.map((block) => [block.key, block.title, block.note, block.photos.map((tile) => [tile.caption, tile.strong])]),
        ]),
      ),
    ).toEqual([
      [
        ["Photo Record 1 of 2", "Packing, Visual & Ageing", [["visual", "Glove Visual Inspection", null, [["Thin spot on glove body", true]]]]],
        [
          "Photo Record 2 of 2",
          "Watertight & Laboratory Testing",
          [["watertight", "Watertight Testing for Pinholes", "1 pinhole in 500 gloves", [["Pin hole on a finger after the watertight test", true]]]],
        ],
      ],
    ]);
    // The export's own signed link, as the print route renders it.
    expect(section?.pages[0].records[0].blocks[0].photos[0].url).toBe(doc.photos.find((entry) => entry.moduleKey === "visual")?.url);
  });

  it("take every photo the browser can show until some are marked, a flagged original never", () => {
    const doc = makeStdEgExport();
    doc.photos = doc.photos.map((entry) => ({ ...entry, includeInReport: false }));
    expect(Object.keys(layoutOf(doc))).toEqual(["samplingPackaging", "packingVisualAgeing", "watertightLaboratory"]);
    expect(layoutOf(doc).packingVisualAgeing).toEqual({
      visual: [doc.photos.find((entry) => entry.moduleKey === "visual")?.id],
      weight: [doc.photos.find((entry) => entry.moduleKey === "weight")?.id],
    });
    // The packing check's only photo is the HEIC original the browser could not convert.
    expect(JSON.stringify(layoutOf(doc))).not.toContain(doc.photos.find((entry) => entry.flagged)?.id);
  });

  it("print none without photos, or with every record switched off", () => {
    expect(buildPhotos(makeSafedonExport())).toBeNull();
    expect(buildReportModel(makeSafedonExport()).sections.photos).toBeUndefined();
    expect(buildPhotos(withPhotos([photo("visual")], 8, { samplingPackaging: false, packingVisualAgeing: false, watertightLaboratory: false }))).toBeNull();
    expect(buildPhotos(withPhotos([photo("visual", null, null, { flagged: true })]))).toBeNull();
  });
});

describe("each photo's group", () => {
  const warehouse = photo("media_warehouse");
  const sampling = photo("carton_sampling", "size:M/box:12");
  const proof = photo("media_proof");
  const samples = photo("media_samples");
  const header = photo("header");
  const cartonTagged = photo("labeling", "size:M/level:carton");
  const innerByBox = photo("labeling", "size:M/box:686");
  const cartonByBox = photo("labeling", "size:M/box:1324");
  const untold = photo("labeling", "size:M");
  const box = photo("dispensing_packing", "size:M/box:13");
  const aged = photo("dispensing_packing", "size:M", "Aged sample after 7 days");
  const visual = photo("visual", "size:M/defect:thin_spot");
  const defect = photo("media_defects", null, "Stain on the cuff");
  const weight = photo("weight", "size:M");
  const pinhole = photo("watertight", "size:M/defect:hole_finger");
  const force = photo("force_at_break", "size:M");
  const dimension = photo("dimensions", "size:M");
  const custom = photo("site_notes", null, "Bench lighting");
  const left = [photo(null), photo("conclusion"), photo("source_media"), photo("not_a_module")];

  const doc = withPhotos([proof, warehouse, sampling, samples, header, cartonTagged, innerByBox, cartonByBox, untold, box, aged, visual, defect, weight, pinhole, force, dimension, custom, ...left]);
  doc.custom = [{ key: "site_notes", title: "Site Notes", after: "visual", layout: "fields", fields: [], values: {} }];

  it("goes by the module it was taken in, Source Documents' Media category and its tags, in the design's groups", () => {
    expect(layoutOf(doc)).toEqual({
      samplingPackaging: {
        // The warehouse first: the large photo, as TG35 lays it.
        finishedGoods: [warehouse.id, sampling.id, header.id, samples.id, proof.id],
        // Labelling by its packaging level: as tagged, else by the box/carton number's level, else the carton.
        cartonLabels: [cartonTagged.id, cartonByBox.id, untold.id],
        dispenserArtwork: [innerByBox.id],
      },
      packingVisualAgeing: {
        layering: [box.id],
        // A custom module's photos go with the module it follows.
        visual: [visual.id, defect.id, custom.id],
        aged: [aged.id],
        weight: [weight.id],
      },
      watertightLaboratory: { watertight: [pinhole.id], forceAtBreak: [force.id], dimensions: [dimension.id] },
    });
    for (const entry of left) expect(JSON.stringify(layoutOf(doc))).not.toContain(entry.id);
  });

  it("captions labels by their size, a defect by its name in the template's wording, in bold, else the inspector's words", () => {
    const tiles = photoRecordsOf(doc).flatMap((record) => record.blocks.flatMap((block) => block.photos));
    const tile = (entry: ExportPhoto) => tiles.find((candidate) => candidate.id === entry.id);
    expect(tile(cartonTagged)).toMatchObject({ caption: "Size M", strong: false, alt: "Carton Labels, Size M" });
    expect(tile(visual)).toMatchObject({ caption: "Thin Spot on Glove Body", strong: true });
    expect(tile(pinhole)).toMatchObject({ caption: "Pin Hole, Finger", strong: true });
    expect(tile(defect)).toMatchObject({ caption: "Stain on the cuff", strong: true });
    expect(tile(custom)).toMatchObject({ caption: "Bench lighting", strong: false });
    expect(tile(weight)).toMatchObject({ caption: null, strong: false, alt: "Weight, Size M" });
    expect(blockIn(doc, "weight").title).toBe("Weight");
    expect(blockIn(doc, "dimensions").title).toBe("Dimension");
  });

  it("adds the artwork's own words after its size, names a label check that failed, and keeps a caption to three lines", () => {
    const front = photo("labeling", "size:M/level:inner", "front");
    const wrong = photo("labeling", "size:M/level:carton/defect:lot_no");
    const long = photo("watertight", "size:M", "The rig before the test, ".repeat(10).trim());
    const tiles = photoRecordsOf(withPhotos([front, wrong, long])).flatMap((record) => record.blocks.flatMap((block) => block.photos));
    expect(tiles.find((tile) => tile.id === front.id)?.caption).toBe("Size M, front");
    expect(tiles.find((tile) => tile.id === wrong.id)).toMatchObject({ caption: "Size M, Wrong / No Lot Number", strong: true });
    const clipped = tiles.find((tile) => tile.id === long.id);
    expect(clipped?.caption?.endsWith("…")).toBe(true);
    expect(clipped?.caption?.length).toBeLessThan(long.caption?.length ?? 0);
    expect(clipped?.alt).toContain(long.caption);
  });

  it("lays the warehouse large once four more sit beside it", () => {
    expect(blockIn(doc, "finishedGoods")).toMatchObject({ columns: 4, aspect: "3/2", lead: true });
    expect(blockIn(withPhotos([warehouse, sampling, samples, proof]), "finishedGoods").lead).toBe(false);
    expect(blockIn(doc, "watertight")).toMatchObject({ columns: 5, aspect: "1/1", lead: false });
  });
});

describe("the notes beside each group's heading", () => {
  it("say where and when the goods were sampled, and what the labels were checked for", () => {
    const doc = withPhotos([photo("media_warehouse"), photo("labeling", "size:M/level:carton"), photo("labeling", "size:M/level:inner")]);
    expect(blockIn(doc, "finishedGoods").note).toBe("Manufacturer A · Factory A1 warehouse, 11 April 2025");
    expect(blockIn(withPhotos([photo("carton_sampling")]), "finishedGoods").note).toBe("Manufacturer A · Factory A1, 11 April 2025");
    expect(blockIn(doc, "cartonLabels").note).toBe("Lot number, manufacturing date, artwork and box/carton number");
    expect(blockIn(doc, "dispenserArtwork").note).toBe("Lot number, manufacturing date and artwork");
  });

  it("count what was tested: boxes, aged boxes, pinholes, specimens", () => {
    const doc = withPhotos([photo("dispensing_packing", "size:M/box:13"), photo("dispensing_packing", null, "Ageing"), photo("watertight"), photo("force_at_break")]);
    const packing = doc.modules.find((candidate) => candidate.key === "dispensing_packing");
    const tested = num(at(packing?.computed, "sizes", "M", "boxesTested")) ?? 0;
    const sizeM = at(packing?.computed, "sizes", "M") as Record<string, unknown>;
    // The ageing as TG35 states it, alone while no aged sample is recorded (the example carries one: take it away).
    sizeM.agedSample = null;
    expect(blockIn(doc, "aged").note).toBe("Aged at 70 °C for 7 days");
    sizeM.agedSample = { layeringResult: "pass", dispensingResult: "pass", stickinessResult: "pass", result: "pass" };
    expect(blockIn(doc, "layering").note).toBe(`${counted(tested, "box", "boxes")} tested`);
    expect(blockIn(doc, "aged").note).toBe("Aged at 70 °C for 7 days, one box, size M");
    expect(blockIn(doc, "watertight").note).toBe("1 pinhole in 500 gloves");
    expect(blockIn(doc, "forceAtBreak").note).toBe("13 specimens tested");
    expect(blockIn(doc, "watertight").title).toBe("Watertight Testing for Pinholes");
  });
});

describe("Photos per Group and the numbering", () => {
  it("shares the photos among a record's groups in turn, so each keeps its first", () => {
    expect(shared([[1, 2, 3], [4], [5, 6]], 4)).toEqual([[1, 2], [4], [5]]);
    expect(shared([[1, 2], [3]], 12)).toEqual([[1, 2], [3]]);
    expect(shared([[1], []], 0)).toEqual([[], []]);
    const many = withPhotos(
      [...Array.from({ length: 6 }, () => photo("media_warehouse")), ...Array.from({ length: 3 }, () => photo("labeling", "size:M/level:carton")), photo("labeling", "size:M/level:inner")],
      4,
    );
    const counts = Object.fromEntries(photoRecordsOf(many)[0].blocks.map((block) => [block.key, block.photos.length]));
    expect(counts).toEqual({ finishedGoods: 2, cartonLabels: 1, dispenserArtwork: 1 });
  });

  it("numbers the records among those shown, leaving out one switched off or with no photos", () => {
    const list = [photo("media_warehouse"), photo("visual"), photo("watertight")];
    expect(partsOf(buildPhotos(withPhotos(list))).map((record) => record.kicker)).toEqual(["Photo Record 1 of 3", "Photo Record 2 of 3", "Photo Record 3 of 3"]);
    expect(partsOf(buildPhotos(withPhotos(list, 8, { samplingPackaging: false }))).map((record) => [record.kicker, record.key])).toEqual([
      ["Photo Record 1 of 2", "packingVisualAgeing"],
      ["Photo Record 2 of 2", "watertightLaboratory"],
    ]);
    expect(partsOf(buildPhotos(withPhotos([photo("visual"), photo("watertight")]))).map((record) => record.key)).toEqual(["packingVisualAgeing", "watertightLaboratory"]);
  });
});

describe("the pages", () => {
  it("estimate a group from its rows as the grid lays them, the large photo over two", () => {
    const block: PhotoBlock = {
      key: "finishedGoods",
      title: "Finished Goods Sampling",
      note: null,
      columns: 4,
      aspect: "3/2",
      lead: true,
      continued: false,
      photos: Array.from({ length: 6 }, (_, index) => ({ id: String(index), url: "https://storage.example.com/p.jpg", caption: null, strong: false, alt: "Photo", markers: [], size: null })),
    };
    const tile = (184 - 3 * PHOTO_ROOM.columnGap) / 4 / 1.5;
    // The large photo and four beside it fill two rows, one row to break at; the sixth starts a third.
    expect(photoRows(block, 184).map((row) => row.count)).toEqual([5, 1]);
    expect(photoBlockHeight(block, 184)).toBeCloseTo(PHOTO_ROOM.blockHeading + PHOTO_ROOM.blockGap + 3 * tile + 2 * PHOTO_ROOM.rowGap);
    const captioned = { ...block, lead: false, photos: block.photos.slice(0, 4).map((entry) => ({ ...entry, caption: "Size M" })) };
    expect(photoBlockHeight(captioned, 184)).toBeCloseTo(PHOTO_ROOM.blockHeading + PHOTO_ROOM.blockGap + tile + PHOTO_ROOM.captionGap + PHOTO_ROOM.captionLine);
  });

  it("continue a record on the next page where its groups outrun the page, under its heading again", () => {
    const doc = withPhotos([photo("media_warehouse"), photo("labeling", "size:M/level:carton"), photo("labeling", "size:M/level:inner")]);
    const records = photoRecordsOf(doc);
    expect(photoPages(records, 236, 184).map((page) => page.records.map((record) => record.blocks.length))).toEqual([[3]]);
    const pages = photoPages(records, 70, 184);
    expect(pages.map((page) => page.records.map((record) => [record.kicker, record.title, record.blocks.map((block) => block.key)]))).toEqual([
      [["Photo Record 1 of 1", "Sampling & Packaging", ["finishedGoods"]]],
      [["Photo Record 1 of 1", "Sampling & Packaging (Continued)", ["cartonLabels"]]],
      [["Photo Record 1 of 1", "Sampling & Packaging (Continued)", ["dispenserArtwork"]]],
    ]);
  });

  it("let a record start under the one before: INS-2026-2442's two records share a page, three with its sampling photos", () => {
    const two = buildPhotos(describedDefectsExport());
    expect(two?.pages.map((page) => page.records.map((record) => [record.kicker, record.title, record.blocks.map((block) => [block.key, block.photos.length])]))).toEqual([
      [
        ["Photo Record 1 of 2", "Packing, Visual & Ageing", [["visual", 1]]],
        ["Photo Record 2 of 2", "Watertight & Laboratory Testing", [["watertight", 5]]],
      ],
    ]);
    // On the inspection, a row of samples on a page two-thirds blank, then "Thin area, glove body" on a page of its own:
    // now one page, a record under another.
    const three = buildPhotos(describedDefectsExport({ sampling: true }));
    expect(three?.pageCount).toBe(1);
    expect(three?.pages[0].records.map((record) => [record.kicker, record.title, record.blocks.map((block) => block.photos.map((tile) => tile.caption))])).toEqual([
      ["Photo Record 1 of 3", "Sampling & Packaging", [["Carton label, size M", "Carton label, size L", "Dispenser box artwork"]]],
      ["Photo Record 2 of 3", "Packing, Visual & Ageing", [["Thin area, glove body"]]],
      ["Photo Record 3 of 3", "Watertight & Laboratory Testing", [["Pinhole, cuff", "Pinhole, palm area", "Pinhole, between fingers", "Pinhole, side of thumb", "Watertight test"]]],
    ]);
  });

  it("start a record on the next page where its heading, its first group's heading and first row do not fit under the one before", () => {
    const records = photoRecordsOf(describedDefectsExport());
    const [visual, watertight] = records.map((record) => record.blocks[0]);
    const first = PHOTO_ROOM.heading + PHOTO_ROOM.gap + photoBlockHeight(visual, 184);
    // The watertight photos are one row of five: the group whole is the record's opening.
    expect(photoRows(watertight, 184)).toHaveLength(1);
    const both = first + PHOTO_ROOM.recordGap + PHOTO_ROOM.heading + PHOTO_ROOM.gap + photoBlockHeight(watertight, 184);
    const titles = (room: number) => photoPages(records, room, 184).map((page) => page.records.map((record) => record.title));
    expect(titles(both + 0.01)).toEqual([["Packing, Visual & Ageing", "Watertight & Laboratory Testing"]]);
    expect(titles(both - 0.01)).toEqual([["Packing, Visual & Ageing"], ["Watertight & Laboratory Testing"]]);
  });

  it("break a group between its rows where the page cannot hold it whole: the rest on the next page under both headings again, Continued beside the group's", () => {
    const thin = photo("visual", "size:M/defect:thin_spot");
    const tested = Array.from({ length: 10 }, () => photo("watertight", "size:M"));
    const records = photoRecordsOf(withPhotos([thin, ...tested]));
    const [visual, watertight] = records.map((record) => record.blocks[0]);
    expect(photoRows(watertight, 184).map((row) => row.count)).toEqual([5, 5]);
    // Room under the visual record for the watertight record's heading, its group's heading and first row, not its second.
    const firstRow = photoBlockHeight({ ...watertight, photos: watertight.photos.slice(0, 5) }, 184);
    const room = PHOTO_ROOM.heading + PHOTO_ROOM.gap + photoBlockHeight(visual, 184) + PHOTO_ROOM.recordGap + PHOTO_ROOM.heading + PHOTO_ROOM.gap + firstRow + 1;
    const pages = photoPages(records, room, 184);
    expect(pages.map((page) => page.records.map((record) => [record.kicker, record.title, record.blocks.map((block) => [block.key, block.photos.length, block.continued, block.note])]))).toEqual([
      [
        ["Photo Record 1 of 2", "Packing, Visual & Ageing", [["visual", 1, false, null]]],
        ["Photo Record 2 of 2", "Watertight & Laboratory Testing", [["watertight", 5, false, "1 pinhole in 500 gloves"]]],
      ],
      [["Photo Record 2 of 2", "Watertight & Laboratory Testing (Continued)", [["watertight", 5, true, null]]]],
    ]);
    // The photos in their order across the break.
    expect(pages.flatMap((page) => page.records.flatMap((record) => record.blocks.filter((block) => block.key === "watertight").flatMap((block) => block.photos.map((tile) => tile.id))))).toEqual(
      tested.map((entry) => entry.id),
    );
    // A group's rest is headed "Continued" in place of its note, as Section 06's tables are.
    expect(CONTINUED_GROUP).toBe("Continued");
  });

  it("keep the large photo's two rows together, the rest a plain grid", () => {
    const records = photoRecordsOf(withPhotos(Array.from({ length: 7 }, () => photo("media_warehouse"))));
    const [goods] = records[0].blocks;
    expect(goods.lead).toBe(true);
    expect(photoRows(goods, 184).map((row) => row.count)).toEqual([5, 2]);
    const room = PHOTO_ROOM.heading + PHOTO_ROOM.gap + photoBlockHeight({ ...goods, photos: goods.photos.slice(0, 5) }, 184) + 1;
    const pages = photoPages(records, room, 184);
    expect(pages.map((page) => page.records.map((record) => record.blocks.map((block) => [block.photos.length, block.lead, block.continued])))).toEqual([
      [[[5, true, false]]],
      [[[2, false, true]]],
    ]);
  });

  it("are planned as built, the records sharing a page, and drawn from the same slot", () => {
    const doc = makeStdEgExport();
    const model = buildReportModel(doc);
    expect(model.plan.find((entry) => entry.key === "photos")).toMatchObject({ kind: "photos", built: true, pageCount: 1 });
    expect(model.sections.photos).toEqual(buildPhotos(doc));
    const entry = model.plan.find((candidate) => candidate.kind === "photos");
    if (entry?.kind === "photos") expect(photos.build(doc, entry)).toEqual(buildPhotos(doc));
    // INS-2026-2442's shape: the plan counts the one page its two records share, and the report its pages.
    const ins = buildReportModel(describedDefectsExport());
    expect(ins.plan.find((candidate) => candidate.kind === "photos")).toMatchObject({ built: true, pageCount: 1 });
    expect(ins.pageCount).toBe(ins.plan.reduce((sum, candidate) => sum + candidate.pageCount, 0));
  });
});

describe("the groups", () => {
  it("give every module of a photo record a group in that record, and Media's categories groups of their own records", () => {
    const owner = new Map<string, string>(Object.entries(PHOTO_BLOCKS).flatMap(([record, blocks]) => blocks.map((block) => [block.key, record] as const)));
    expect(owner.size).toBe(Object.values(PHOTO_BLOCKS).flat().length);
    for (const group of REPORT_PHOTO_GROUPS) {
      for (const key of group.modules) expect(owner.get(MODULE_PHOTO_BLOCK[key] ?? "none"), key).toBe(group.key);
    }
    expect(Object.fromEntries(Object.entries(MEDIA_PHOTO_BLOCK).map(([category, block]) => [category, owner.get(block)]))).toEqual({
      media_warehouse: "samplingPackaging",
      media_samples: "samplingPackaging",
      media_proof: "samplingPackaging",
      media_defects: "packingVisualAgeing",
    });
  });
});

describe("an inspection whose photos are all in Source Documents' Media", () => {
  it("still prints its photo records: the plan finds them as the builder does", () => {
    const doc = withPhotos([photo("media_warehouse"), photo("media_defects", null, "Stain on the cuff")]);
    const entry = buildReportModel(doc).plan.find((candidate) => candidate.kind === "photos");
    expect(entry).toMatchObject({ key: "photos", built: true });
    expect(entry?.pageCount).toBeGreaterThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ *
 * Steri-AI's descriptions, the rings drawn, and the design's captions
 * ------------------------------------------------------------------ */

type Description = NonNullable<ExportPhoto["description"]>;
const described = (text: string, defect: string | null, location: string | null = null, clarity = 0.8): { description: Description } => ({
  description: { text, kind: "defect", defect, location, clarity, check: null },
});
const setting = (text: string, check: Description["check"] = null): { description: Description } => ({
  description: { text, kind: "context", defect: null, location: null, clarity: 0.9, check },
});
const tilesOf = (doc: InspectionExport) => photoRecordsOf(doc).flatMap((record) => record.blocks.flatMap((block) => block.photos));
const captionsIn = (doc: InspectionExport, key: string) => blockIn(doc, key).photos.map((tile) => [tile.caption, tile.strong]);

describe("a Media photo Steri-AI describes", () => {
  it("goes with the watertight photos for a hole, the visual inspection's for a visual defect; the setting stays in its category's group", () => {
    const pinhole = photo("media_defects", null, null, described("Pinhole, palm area", "hole_palm", "hole_palm"));
    const holeByPlace = photo("media_proof", null, null, described("Pinhole, side finger", null, "hole_finger"));
    const thinSpot = photo("media_samples", null, null, described("Thin spot", "thin_spot"));
    const rig = photo("media_defects", null, null, setting("Test rig"));
    const carton = photo("media_defects", null, null, described("Torn carton corner", null));
    const undescribed = photo("media_defects");
    const doc = withPhotos([pinhole, holeByPlace, thinSpot, rig, carton, undescribed]);
    expect(layoutOf(doc)).toEqual({
      packingVisualAgeing: { visual: [thinSpot.id, rig.id, carton.id, undescribed.id] },
      watertightLaboratory: { watertight: [pinhole.id, holeByPlace.id] },
    });
  });

  it("files a setting shot by the test Steri-AI says it belongs to: the rig with the watertight photos, as TG35 page 11 has it", () => {
    const rig = photo("media_defects", null, null, setting("Test rig", "watertight"));
    const lightBox = photo("media_proof", null, null, setting("Light box", "visual"));
    const unknown = photo("media_defects", null, null, setting("Carton stack"));
    expect(layoutOf(withPhotos([rig, lightBox, unknown]))).toEqual({
      packingVisualAgeing: { visual: [lightBox.id, unknown.id] },
      watertightLaboratory: { watertight: [rig.id] },
    });
  });

  it("stays in its category's group while the record its defect belongs to is switched off", () => {
    const pinhole = photo("media_defects", null, null, described("Pinhole, palm area", "hole_palm", "hole_palm"));
    expect(layoutOf(withPhotos([pinhole], 12, { watertightLaboratory: false }))).toEqual({ packingVisualAgeing: { visual: [pinhole.id] } });
  });

  it("keeps a module's photo with its module whatever Steri-AI says", () => {
    const shot = photo("visual", "size:M", null, described("Pinhole, palm", "hole_palm", "hole_palm"));
    expect(layoutOf(withPhotos([shot]))).toEqual({ packingVisualAgeing: { visual: [shot.id] } });
  });
});

describe("the captions, the design's way (TG35 pages 10 and 11)", () => {
  it("are the inspector's words first, then Steri-AI's, then the defect tagged; a defect in bold, the setting plain", () => {
    const own = photo("watertight", "size:M/defect:hole_palm", "Hole near the thumb", described("Pinhole, side finger", "hole_finger", "hole_finger"));
    const ai = photo("watertight", "size:M/defect:hole_palm", null, described("Pinhole, palm area", "hole_palm", "hole_palm"));
    const rig = photo("watertight", "size:M/defect:hole_palm", null, setting("Test rig"));
    const tagged = photo("watertight", "size:M/defect:hole_crotch");
    const doc = withPhotos([own, ai, rig, tagged]);
    expect(captionsIn(doc, "watertight")).toEqual([
      ["Hole near the thumb", true],
      ["Pinhole, palm area", true],
      // Tagged with the hole in focus as it was taken, the rig is the setting by Steri-AI's word: plain.
      ["Test rig", false],
      ["Pin Hole, Between Fingers (Crotch)", true],
    ]);
  });

  it("are never Media's category on every tile: INS-2026-2442's four Product Defects photos, undescribed, print uncaptioned", () => {
    const doc = fourSizeProductDefectsExport();
    const section = buildPhotos(doc);
    expect(partsOf(section).map((record) => [record.title, record.blocks.map((block) => [block.title, block.note, block.photos.map((tile) => tile.caption)])])).toEqual([
      ["Packing, Visual & Ageing", [["Glove Visual Inspection", null, [null, null, null, null]]]],
    ]);
    expect(JSON.stringify(section)).not.toContain("Product Defects");
  });

  it("place and caption INS-2026-2442's photos once described: the pinholes and the rig with the watertight photos, the rig plain, the ringed mark in bold", () => {
    const doc = fourSizeProductDefectsExport({ described: true });
    expect(partsOf(buildPhotos(doc)).map((record) => [record.title, record.blocks.map((block) => [block.title, block.photos.map((tile) => [tile.caption, tile.strong])])])).toEqual([
      ["Packing, Visual & Ageing", [["Glove Visual Inspection", [["Ringed mark, thin area", true]]]]],
      ["Watertight & Laboratory Testing", [["Watertight Testing for Pinholes", [["Pinhole, palm area", true], ["Test rig", false], ["Pinhole, between fingers", true]]]]],
    ]);
  });

  it("make bold an inspector's caption that names a defect, anywhere; keep a caption naming the setting plain", () => {
    const named = photo("dispensing_packing", "size:M/box:13", "Torn glove in box 13");
    const plain = photo("dispensing_packing", "size:M/box:14", "Box 14 opened");
    const bench = photo("visual", "size:M", "Inspection bench");
    const doc = withPhotos([named, plain, bench]);
    expect(captionsIn(doc, "layering")).toEqual([
      ["Torn glove in box 13", true],
      ["Box 14 opened", false],
    ]);
    expect(captionsIn(doc, "visual")).toEqual([["Inspection bench", false]]);
  });

  it("carry the rings drawn and the image's natural pixels to the tile", () => {
    const ringed = photo("media_defects", null, null, { markers: [{ x: 0.4, y: 0.6, r: 0.05 }], size: { width: 3024, height: 4032 } });
    expect(tilesOf(withPhotos([ringed]))[0]).toMatchObject({ markers: [{ x: 0.4, y: 0.6, r: 0.05 }], size: { width: 3024, height: 4032 } });
  });
});

describe("Photos per Group and the defect photos", () => {
  it("keeps a group's defect photos first, so one Section 06 had no room for still prints; the group keeps its own order", () => {
    const rigs = Array.from({ length: 4 }, () => photo("watertight", "size:M", null, setting("Test rig")));
    const pinhole = photo("media_defects", null, null, described("Pinhole, palm area", "hole_palm", "hole_palm"));
    const tensile = photo("force_at_break", "size:M");
    const kept = layoutOf(withPhotos([...rigs, pinhole, tensile], 4)).watertightLaboratory;
    expect(kept).toEqual({ watertight: [rigs[0].id, rigs[1].id, pinhole.id], forceAtBreak: [tensile.id] });
  });
});

describe("the notes beside each group's heading, one line each", () => {
  /** The room a note has beside its title (BlockHeading: the title at 12 pt, 6 mm, the note at 8.5 pt). */
  const fits = (block: PhotoBlock, width = 184) => textWidth(block.title, 12, "bold") + PHOTO_ROOM.noteGap + textWidth(block.note ?? "", 8.5) <= width;

  it("shorten a long place and day rather than wrap: the place and day, else the maker and day, else the place", () => {
    const doc = withPhotos([photo("media_warehouse")]);
    const header = doc.modules.find((module) => module.key === "header");
    if (!header) throw new Error("No header.");
    header.computed.manufacturer = "Manufacturer A Glove Products International Holdings · Factory A1 Extension Block";
    const block = blockIn(doc, "finishedGoods");
    expect(block.note).toBe("11 April 2025");
    expect(fits(block)).toBe(true);
    header.computed.manufacturer = "Manufacturer A · Factory A1";
    expect(blockIn(doc, "finishedGoods").note).toBe("Manufacturer A · Factory A1 warehouse, 11 April 2025");
  });

  it("name the labels' checks, or the first of them and how many more, never on two lines", () => {
    const doc = withPhotos([photo("labeling", "size:M/level:carton")]);
    expect(blockIn(doc, "cartonLabels").note).toBe("Lot number, manufacturing date, artwork and box/carton number");
    const labeling = doc.modules.find((module) => module.key === "labeling");
    const checks = at(labeling?.config, "levels", "carton", "checks") as { code: string; label: string }[];
    checks.push(...["Shipping Mark and Consignee Address", "Country of Origin", "Net and Gross Weight", "Handling Symbols"].map((label, index) => ({ code: `extra_${index}`, label })));
    const block = blockIn(doc, "cartonLabels");
    expect(block.note).toBe("Lot number, manufacturing date, artwork, box/carton number and 4 more");
    expect(fits(block)).toBe(true);
  });

  it("drop the aged sizes' list before the note would wrap", () => {
    const doc = withPhotos([photo("dispensing_packing", null, "Aged sample")]);
    const packing = doc.modules.find((module) => module.key === "dispensing_packing");
    const sizes = at(packing?.computed, "sizes") as Record<string, Record<string, unknown>>;
    sizes.M.agedSample = { layeringResult: "pass", dispensingResult: "pass", stickinessResult: "pass", result: "pass" };
    expect(blockIn(doc, "aged").note).toBe("Aged at 70 °C for 7 days, one box, size M");
    // A size the template shows in long words: the size gives way, the ageing stays.
    doc.template.sizes = doc.template.sizes?.map((size) => ({ ...size, label: `${size.value}, Medium Long Cuff Extended Grip Textured Fingertips` }));
    const block = blockIn(doc, "aged");
    expect(block.note).toBe("Aged at 70 °C for 7 days");
    expect(fits(block)).toBe(true);
  });

  it("say defects are circled where a photo has rings the tile can place, beside the pinholes' count where both fit", () => {
    const ringed = { markers: [{ x: 0.5, y: 0.5, r: 0.05 }] };
    const doc = withPhotos([photo("visual", "size:M/defect:thin_spot", null, ringed), photo("watertight", "size:M/defect:hole_finger", null, ringed)]);
    expect(blockIn(doc, "visual").note).toBe("Defects circled in red");
    expect(blockIn(doc, "watertight").note).toBe("1 pinhole in 500 gloves; leaks circled in red");
    // Rings with no image size are drawn nowhere, and said nowhere.
    const unplaced = withPhotos([photo("visual", "size:M/defect:thin_spot", null, { ...ringed, size: null })]);
    expect(blockIn(unplaced, "visual").note).toBeNull();
  });
});
