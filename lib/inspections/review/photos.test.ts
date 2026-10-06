import { describe, expect, it } from "vitest";
import { MODULE_REGISTRY } from "@/modules/registry";
import { evaluated } from "./__fixtures__/review";
import { describePhoto, sectionWording, UNTAGGED, unlabelledDefects, type PhotoRow } from "./photos";

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
    expect(describePhoto(photo(), wording)).toEqual({
      id: photo().id,
      alt: "Photo: Visual Inspection (AQL), size M, right hand, Thin spot on glove body, box 253",
      tags: { module: "Visual Inspection (AQL)", size: "M", hand: "R", defect: "Thin spot on glove body", box: "253" },
      caption: null,
      flagged: false,
      takenAt: "2026-10-05T02:10:00Z",
    });
  });

  it("leads the text alternative with the caption", () => {
    expect(describePhoto(photo({ caption: "  Thin spot near the cuff " }), wording)).toMatchObject({
      caption: "Thin spot near the cuff",
      alt: "Thin spot near the cuff (Visual Inspection (AQL), size M, right hand, Thin spot on glove body, box 253)",
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
