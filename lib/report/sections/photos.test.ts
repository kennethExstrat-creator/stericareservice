// The photo records from the placeholder example reports (STD_EG's five
// photos, two marked In Report and a flagged HEIC original; SAFEDON_EG has
// none) and placeholder photos tagged as the capture screen and Source
// Documents' Media tag them: each photo in its group, the captions, the
// notes, Photos per Group, the numbering and the pages.
import { describe, expect, it } from "vitest";
import { counted } from "@/lib/report/format";
import { at, num } from "@/lib/report/read";
import type { ExportPhoto, InspectionExport } from "@/lib/schemas/export";
import { REPORT_PHOTO_GROUPS, type ReportPhotoGroupKey } from "@/lib/schemas/report-options";
import { makeSafedonExport, makeStdEgExport, withReportOptions } from "../__fixtures__/exports";
import { buildReportModel, type PhotoBlock } from "../model";
import {
  buildPhotos,
  MEDIA_PHOTO_BLOCK,
  MODULE_PHOTO_BLOCK,
  PHOTO_BLOCKS,
  PHOTO_ROOM,
  photoBlockHeight,
  photoPages,
  photoRecordsOf,
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

const blockIn = (doc: InspectionExport, key: string): PhotoBlock => {
  const found = photoRecordsOf(doc)
    .flatMap((record) => record.blocks)
    .find((block) => block.key === key);
  if (!found) throw new Error(`No ${key} group.`);
  return found;
};

describe("the photo records", () => {
  it("print STD_EG's photos marked In Report in the design's groups, a page each, numbered among those shown", () => {
    const doc = makeStdEgExport();
    const section = buildPhotos(doc);
    expect(section?.pageCount).toBe(2);
    expect(
      section?.pages.map((page) => [
        page.kicker,
        page.title,
        page.blocks.map((block) => [block.key, block.title, block.note, block.photos.map((tile) => [tile.caption, tile.strong])]),
      ]),
    ).toEqual([
      ["Photo Record 1 of 2", "Packing, Visual & Ageing", [["visual", "Glove Visual Inspection", null, [["Thin spot on glove body", true]]]]],
      [
        "Photo Record 2 of 2",
        "Watertight & Laboratory Testing",
        [["watertight", "Watertight Testing for Pinholes", "1 pinhole in 500 gloves", [["Pin hole on a finger after the watertight test", true]]]],
      ],
    ]);
    // The export's own signed link, as the print route renders it.
    expect(section?.pages[0].blocks[0].photos[0].url).toBe(doc.photos.find((entry) => entry.moduleKey === "visual")?.url);
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
    sizeM.agedSample = { layeringResult: "pass", dispensingResult: "pass", stickinessResult: "pass", result: "pass" };
    expect(blockIn(doc, "layering").note).toBe(`${counted(tested, "box", "boxes")} tested`);
    expect(blockIn(doc, "aged").note).toBe("One box, size M");
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
    expect(buildPhotos(withPhotos(list))?.pages.map((page) => page.kicker)).toEqual(["Photo Record 1 of 3", "Photo Record 2 of 3", "Photo Record 3 of 3"]);
    expect(buildPhotos(withPhotos(list, 8, { samplingPackaging: false }))?.pages.map((page) => [page.kicker, page.key])).toEqual([
      ["Photo Record 1 of 2", "packingVisualAgeing"],
      ["Photo Record 2 of 2", "watertightLaboratory"],
    ]);
    expect(buildPhotos(withPhotos([photo("visual"), photo("watertight")]))?.pages.map((page) => page.key)).toEqual(["packingVisualAgeing", "watertightLaboratory"]);
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
      photos: Array.from({ length: 6 }, (_, index) => ({ id: String(index), url: "https://storage.example.com/p.jpg", caption: null, strong: false, alt: "Photo" })),
    };
    const tile = (184 - 3 * PHOTO_ROOM.columnGap) / 4 / 1.5;
    // The large photo and four beside it fill two rows; the sixth starts a third.
    expect(photoBlockHeight(block, 184)).toBeCloseTo(PHOTO_ROOM.blockHeading + PHOTO_ROOM.blockGap + 3 * tile + 2 * PHOTO_ROOM.rowGap);
    const captioned = { ...block, lead: false, photos: block.photos.slice(0, 4).map((entry) => ({ ...entry, caption: "Size M" })) };
    expect(photoBlockHeight(captioned, 184)).toBeCloseTo(PHOTO_ROOM.blockHeading + PHOTO_ROOM.blockGap + tile + PHOTO_ROOM.captionGap + PHOTO_ROOM.captionLine);
  });

  it("continue a record on the next page where its groups outrun the page, under its heading again", () => {
    const doc = withPhotos([photo("media_warehouse"), photo("labeling", "size:M/level:carton"), photo("labeling", "size:M/level:inner")]);
    const records = photoRecordsOf(doc);
    expect(photoPages(records, 236, 184).map((page) => page.blocks.length)).toEqual([3]);
    const pages = photoPages(records, 70, 184);
    expect(pages.map((page) => [page.kicker, page.title, page.blocks.map((block) => block.key)])).toEqual([
      ["Photo Record 1 of 1", "Sampling & Packaging", ["finishedGoods"]],
      ["Photo Record 1 of 1", "Sampling & Packaging (Continued)", ["cartonLabels"]],
      ["Photo Record 1 of 1", "Sampling & Packaging (Continued)", ["dispenserArtwork"]],
    ]);
  });

  it("are planned as built, a page each, and drawn from the same slot", () => {
    const doc = makeStdEgExport();
    const model = buildReportModel(doc);
    expect(model.plan.find((entry) => entry.key === "photos")).toMatchObject({ kind: "photos", built: true, pageCount: 2 });
    expect(model.sections.photos).toEqual(buildPhotos(doc));
    const entry = model.plan.find((candidate) => candidate.kind === "photos");
    if (entry?.kind === "photos") expect(photos.build(doc, entry)).toEqual(buildPhotos(doc));
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
