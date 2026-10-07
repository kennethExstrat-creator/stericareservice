import { describe, expect, it } from "vitest";
import { tagLine } from "@/components/qc/photo-tags";
import { stdEgInspectionData, stdEgTemplate } from "@/lib/export/__fixtures__/std-eg";
import { TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { makeTestTemplate } from "@/modules/_framework/testing";
import { MODULE_REGISTRY } from "@/modules/registry";
import { evaluated, storedInspection } from "./__fixtures__/review";
import { evaluateStoredInspection } from "./evaluate";
import {
  describePhoto,
  photoTags,
  photoWording,
  sectionWording,
  UNTAGGED,
  unlabelledDefects,
  type PhotoRow,
} from "./photos";

const INSPECTION = "3f0c2a1e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";

function photo(overrides: Partial<PhotoRow> = {}): PhotoRow {
  return {
    id: "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d",
    module_key: "visual",
    target: "size:M/hand:R/defect:thin_spot/box:253",
    caption: null,
    storage_path: `${INSPECTION}/6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d.jpg`,
    thumb_path: `${INSPECTION}/thumbs/6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d.jpg`,
    taken_at: "2026-10-05T02:10:00Z",
    flagged: false,
    ...overrides,
  };
}

describe("describePhoto", () => {
  const wording = sectionWording(evaluated());

  it("tags a photo with its module and focus in the template's wording", () => {
    // The template labels size M "Medium".
    expect(describePhoto(photo(), wording)).toEqual({
      id: photo().id,
      alt: "Photo: Visual Inspection (AQL), Size Medium, right hand, Thin spot on glove body, Box 253",
      tags: { module: "Visual Inspection (AQL)", size: "Medium", hand: "R", defect: "Thin spot on glove body", box: "253" },
      caption: null,
      flagged: false,
      takenAt: "2026-10-05T02:10:00Z",
    });
  });

  it("leads the text alternative with the caption", () => {
    expect(describePhoto(photo({ caption: "  Thin spot near the cuff " }), wording)).toMatchObject({
      caption: "Thin spot near the cuff",
      alt: "Thin spot near the cuff (Visual Inspection (AQL), Size Medium, right hand, Thin spot on glove body, Box 253)",
    });
  });

  it("names a size the template does not label by its value, and a hand without a size", () => {
    expect(describePhoto(photo({ target: "size:7.0/box:12" }), wording)).toMatchObject({
      alt: "Photo: Visual Inspection (AQL), Size 7.0, Box 12",
      tags: { size: "7.0", box: "12" },
    });
    expect(describePhoto(photo({ target: "hand:L" }), wording)).toMatchObject({
      alt: "Photo: Visual Inspection (AQL), left hand",
      tags: { module: "Visual Inspection (AQL)", hand: "L" },
    });
  });

  it("names a defect the module does not label from defect_codes, and an unmapped one as it was typed", () => {
    const named = new Map([["hole_cuff", "Hole in cuff"]]);
    expect(describePhoto(photo({ target: "defect:hole_cuff" }), wording, named).tags.defect).toBe("Hole in cuff");
    expect(describePhoto(photo({ target: "defect:Black%20speck" }), wording, named).tags.defect).toBe("Black speck");
  });

  it("titles custom sections, switched-off modules and untagged photos too", () => {
    expect(describePhoto(photo({ module_key: "glove_type", target: null }), wording).tags).toEqual({ module: "Glove Type" });
    expect(describePhoto(photo({ module_key: null, target: null }), wording).tags).toEqual({ module: UNTAGGED });
    expect(describePhoto(photo({ module_key: " ", target: null }), wording).tags).toEqual({ module: UNTAGGED });
    // A module the template does not include keeps the module's own title.
    expect(describePhoto(photo({ module_key: "tensile", target: null }), wording).tags.module).toBe(
      MODULE_REGISTRY.tensile.title,
    );
  });

  it("ignores a target it cannot read rather than failing the page", () => {
    expect(describePhoto(photo({ target: "garbage" }), wording).tags).toEqual({ module: "Visual Inspection (AQL)" });
  });
});

describe("describePhoto: packaging levels and list entries, as the gallery words them", () => {
  // STD_EG on the real modules: labelling words its levels "Dispenser Box" and "Carton Box".
  const stdEg = evaluateStoredInspection(
    storedInspection({ resolved: stdEgTemplate(), data: stdEgInspectionData() }),
    MODULE_REGISTRY,
  );
  const wording = sectionWording(stdEg);
  const labeling = stdEg.ok ? stdEg.report.modules.find((entry) => entry.key === "labeling")?.title : undefined;

  it("names the carton or the inner unit a labelling photo shows", () => {
    expect(labeling).toBeTruthy();
    const carton = describePhoto(photo({ module_key: "labeling", target: "size:M/box:1324/level:carton" }), wording);
    expect(carton.tags).toEqual({ module: labeling, size: "M", box: "1324", level: "Carton Box" });
    expect(carton.alt).toBe(`Photo: ${labeling}, Size M, Box 1324, Carton Box`);
    // The tile's tag line, as the gallery's: level last.
    expect(tagLine(carton.tags)).toBe(`${labeling} · Size M · Box 1324 · Carton Box`);
    expect(describePhoto(photo({ module_key: "labeling", target: "size:M/box:686/level:inner" }), wording).tags.level).toBe(
      "Dispenser Box",
    );
  });

  it("names a document or a loading stage by the template's words for it", () => {
    const withLists = sectionWording(
      evaluated({ resolved: makeTestTemplate(TEST_REGISTRY, ["documents", "loading", "conclusion"]) }),
    );
    expect(describePhoto(photo({ module_key: "documents", target: "item:certificateOfAnalysis" }), withLists)).toMatchObject({
      tags: { module: "Documents", item: "Certificate of Analysis" },
      alt: "Photo: Documents, Certificate of Analysis",
    });
    expect(describePhoto(photo({ module_key: "loading", target: "item:doorsClosed" }), withLists).tags).toEqual({
      module: "Loading",
      item: "Doors Closed",
    });
  });

  it("words the same photo the same way for the AI panel", () => {
    const row = { module_key: "visual", target: "size:M/defect:thin_spot" };
    // STD_EG's visual words its defects in its config, so the loaders name them from defect_codes.
    expect(unlabelledDefects([row], wording)).toEqual(["thin_spot"]);
    const named = new Map([["thin_spot", "Thin spot on glove body"]]);
    expect(tagLine(photoTags(row, wording, named))).toBe(`${wording.title("visual")} · Size M · Thin spot on glove body`);
    // Without the results, the module's own name and the codes as tagged.
    expect(photoTags({ module_key: "labeling", target: "level:carton" }, photoWording(null))).toEqual({
      module: MODULE_REGISTRY.labeling.title,
      level: "Carton",
    });
  });
});

describe("unlabelledDefects", () => {
  it("lists the defect codes no module labels, once each", () => {
    const wording = sectionWording(evaluated());
    const rows = [
      photo(),
      photo({ target: "defect:hole_cuff" }),
      photo({ module_key: "watertight", target: "size:M/defect:hole_cuff" }),
      photo({ target: null }),
    ];
    expect(unlabelledDefects(rows, wording)).toEqual(["hole_cuff"]);
  });
});
