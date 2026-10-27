// Reading a photo for the report: what it shows, from the strongest word on
// it (a ring drawn, then Steri-AI's description, then the inspector's tags
// and caption), the words it prints under, the defect it is one photo of,
// and which check a defect code belongs to. Placeholder photos on the
// placeholder STD_EG export.
import { describe, expect, it } from "vitest";
import type { ExportPhoto } from "@/lib/schemas/export";
import { makeSafedonExport, makeStdEgExport } from "./__fixtures__/exports";
import { defectFamily, defectKey, describedFamily, namesDefect, namesSetting, photoShows, photoWords } from "./photo-reading";
import { placeholderPhoto } from "./sections/__fixtures__/holes-visual";

type Description = NonNullable<ExportPhoto["description"]>;
const defect = (text: string, code: string | null, location: string | null = null): Description => ({ text, kind: "defect", defect: code, location, clarity: 0.8 });
const setting = (text: string): Description => ({ text, kind: "context", defect: null, location: null, clarity: 0.9 });
const ring = [{ x: 0.5, y: 0.5, r: 0.05 }];

describe("an inspector's caption", () => {
  it("names a defect: holes, thin areas and spots, stains, the critical defects, the marks the templates list", () => {
    for (const words of ["Pinhole at palm", "Pin hole on a finger", "Thin spot", "Stain on the cuff", "Ringed mark, thin area", "Embedded insect", "Black speck", "Torn cuff edge", "Leak at the thumb"]) {
      expect(namesDefect(words), words).toBe(true);
    }
    for (const words of ["Test rig", "Inspection bench", "Carton shipping marks", "Size M, front", "Aged sample after 7 days", "Box 14 opened"]) {
      expect(namesDefect(words), words).toBe(false);
    }
  });

  it("names the setting where it says a rig, a bench, cartons or labels, and no defect", () => {
    expect(namesSetting("Test rig")).toBe(true);
    expect(namesSetting("Inspection bench")).toBe(true);
    expect(namesSetting("Carton labels")).toBe(true);
    expect(namesSetting("Stain on a carton")).toBe(false);
    expect(namesSetting("Box 14 opened")).toBe(false);
  });
});

describe("what a photo shows", () => {
  it("is a defect where a ring is drawn on it, whatever else it says", () => {
    expect(photoShows(placeholderPhoto(1, { markers: ring, description: setting("Test rig") }), {}, "media_defects")).toBe("defect");
    expect(photoShows(placeholderPhoto(2, { markers: ring }), {}, "media_warehouse")).toBe("defect");
  });

  it("is Steri-AI's word next: a defect close-up, or the setting even where a defect was tagged as the photo was taken", () => {
    expect(photoShows(placeholderPhoto(1, { description: defect("Thin spot", "thin_spot") }), {}, "media_samples")).toBe("defect");
    expect(photoShows(placeholderPhoto(2, { description: setting("Test rig") }), { defect: "hole_palm" }, "watertight")).toBe("setting");
    expect(photoShows(placeholderPhoto(3, { caption: "Pinhole at palm", description: setting("Test rig") }), {}, "watertight")).toBe("setting");
  });

  it("is the inspector's tags and words without either: a defect tagged or named, a captioned Product Defects photo unless it names the setting", () => {
    expect(photoShows(placeholderPhoto(1), { defect: "thin_spot" }, "visual")).toBe("defect");
    expect(photoShows(placeholderPhoto(2, { caption: "Stain on the cuff" }), {}, "dispensing_packing")).toBe("defect");
    expect(photoShows(placeholderPhoto(3, { caption: "Glove sample 3" }), {}, "media_defects")).toBe("defect");
    expect(photoShows(placeholderPhoto(4, { caption: "Test rig" }), {}, "media_defects")).toBe("setting");
    expect(photoShows(placeholderPhoto(5, { caption: "Glove sample 3" }), {}, "watertight")).toBe("unsaid");
    // INS-2026-2442's Product Defects photos, as they were: nothing says what they show.
    expect(photoShows(placeholderPhoto(6), {}, "media_defects")).toBe("unsaid");
  });
});

describe("a photo's words and its defect", () => {
  it("are the inspector's caption first, then Steri-AI's", () => {
    expect(photoWords(placeholderPhoto(1, { caption: " Hole near the thumb ", description: defect("Pinhole, side finger", "hole_finger") }))).toBe("Hole near the thumb");
    expect(photoWords(placeholderPhoto(2, { description: defect("Pinhole, side finger", "hole_finger") }))).toBe("Pinhole, side finger");
    expect(photoWords(placeholderPhoto(3))).toBeNull();
  });

  it("key one photo per defect: Steri-AI's code and a hole's location, else the defect tagged, else the photo alone", () => {
    expect(defectKey(placeholderPhoto(1, { description: defect("Pinhole, palm area", "hole_palm", "hole_palm") }), {})).toBe("hole_palm");
    expect(defectKey(placeholderPhoto(2), { defect: "hole_palm" })).toBe("hole_palm");
    expect(defectKey(placeholderPhoto(3, { description: defect("Pinhole", "pinhole", "hole_cuff") }), {})).toBe("pinhole@hole_cuff");
    expect(defectKey(placeholderPhoto(4, { description: setting("Test rig") }), { defect: "hole_palm" })).toBe("hole_palm");
    const alone = placeholderPhoto(5, { markers: ring });
    expect(defectKey(alone, {})).toBe(`photo:${alone.id}`);
  });

  it("belong to a check by the template's codes: a hole location, a visual class's defect, else neither", () => {
    const std = makeStdEgExport();
    expect(defectFamily(std, "hole_palm")).toBe("holes");
    expect(defectFamily(std, "thin_crotch_ring")).toBe("visual");
    expect(defectFamily(std, "embedded_insect")).toBe("visual");
    expect(defectFamily(std, "torn_carton")).toBeNull();
    expect(defectFamily(std, null)).toBeNull();
    // SAFEDON_EG's own location; a hole code where the template has no watertight test.
    expect(defectFamily(makeSafedonExport(), "glove_burst")).toBe("holes");
    expect(defectFamily({ modules: [] }, "hole_cuff")).toBe("holes");
    expect(describedFamily(std, placeholderPhoto(1, { description: defect("Pinhole, side finger", null, "hole_finger") }))).toBe("holes");
    expect(describedFamily(std, placeholderPhoto(2, { description: setting("Test rig") }))).toBeNull();
  });
});
