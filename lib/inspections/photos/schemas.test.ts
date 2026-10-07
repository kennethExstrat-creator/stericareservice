import { describe, expect, it } from "vitest";
import {
  CAPTION_MAX_LENGTH,
  FileIdFormSchema,
  formText,
  parseForm,
  parsePhotoTagForm,
  PhotoIdFormSchema,
  PhotoReportFormSchema,
} from "./schemas";

const PHOTO = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

function form(fields: Record<string, string | Blob>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("parsePhotoTagForm", () => {
  it("reads the module, the parts of the target it records and the caption", () => {
    expect(
      parsePhotoTagForm(
        form({ photoId: PHOTO, moduleKey: "visual", size: "M", hand: "R", defect: "thin_spot", caption: "  Near the cuff  " }),
      ),
    ).toEqual({
      ok: true,
      data: {
        photoId: PHOTO,
        moduleKey: "visual",
        target: { size: "M", hand: "R", defect: "thin_spot" },
        caption: "Near the cuff",
      },
    });
  });

  it("reads blank fields as nothing: no module tags the photo as not tagged yet", () => {
    expect(parsePhotoTagForm(form({ photoId: PHOTO, moduleKey: "", size: "", hand: "", defect: "", box: "", caption: " " }))).toEqual({
      ok: true,
      data: { photoId: PHOTO, moduleKey: null, target: {}, caption: null },
    });
  });

  it("drops what the module does not record, so a box does not follow a photo into dimensions", () => {
    const parsed = parsePhotoTagForm(form({ photoId: PHOTO, moduleKey: "dimensions", size: "S", box: "253", defect: "stain" }));
    expect(parsed).toMatchObject({ ok: true, data: { target: { size: "S" } } });
    const boxed = parsePhotoTagForm(form({ photoId: PHOTO, moduleKey: "dispensing_packing", size: "S", box: " 0253 " }));
    expect(boxed).toMatchObject({ ok: true, data: { target: { size: "S", box: 253 } } });
  });

  it("reads labelling's packaging level and the item of documents and loading", () => {
    expect(
      parsePhotoTagForm(form({ photoId: PHOTO, moduleKey: "labeling", size: "M", box: "253", defect: "lot_no", level: "carton" })),
    ).toMatchObject({ ok: true, data: { target: { size: "M", box: 253, defect: "lot_no", level: "carton" } } });
    expect(parsePhotoTagForm(form({ photoId: PHOTO, moduleKey: "loading", item: "doorsClosed", level: "inner" }))).toMatchObject({
      ok: true,
      data: { target: { item: "doorsClosed" } },
    });
    expect(parsePhotoTagForm(form({ photoId: PHOTO, moduleKey: "documents", item: "", level: "" }))).toMatchObject({
      ok: true,
      data: { target: {} },
    });
    expect(parsePhotoTagForm(form({ photoId: PHOTO, moduleKey: "labeling", level: "pallet", item: "../x" }))).toEqual({
      ok: false,
      fieldErrors: { level: "Choose the inner unit or the carton.", item: "Choose an item from the list." },
    });
  });

  it("takes custom module keys, which record the size", () => {
    expect(parsePhotoTagForm(form({ photoId: PHOTO, moduleKey: "pallet_check", size: "L", hand: "L" }))).toMatchObject({
      ok: true,
      data: { moduleKey: "pallet_check", target: { size: "L" } },
    });
  });

  it("names the field that is wrong", () => {
    const parsed = parsePhotoTagForm(
      form({ photoId: PHOTO, moduleKey: "Visual Inspection", hand: "X", box: "12a", caption: "x".repeat(CAPTION_MAX_LENGTH + 1) }),
    );
    expect(parsed).toEqual({
      ok: false,
      fieldErrors: {
        moduleKey: "Choose a module from the list.",
        hand: "Choose the right or the left hand.",
        box: "Enter the box number in digits.",
        caption: `Keep the caption under ${CAPTION_MAX_LENGTH} characters.`,
      },
    });
  });

  it("refuses box 0 and an id that is not a photo's", () => {
    expect(parsePhotoTagForm(form({ photoId: PHOTO, moduleKey: "labeling", box: "0" }))).toEqual({
      ok: false,
      fieldErrors: { box: "Box numbers start at 1." },
    });
    expect(parsePhotoTagForm(form({ photoId: "../../etc", moduleKey: "visual" }))).toEqual({
      ok: false,
      fieldErrors: { photoId: "This photo could not be found." },
    });
    expect(parsePhotoTagForm(form({ moduleKey: "visual" }))).toEqual({
      ok: false,
      fieldErrors: { photoId: "This photo could not be found." },
    });
  });

  it("keeps a caption of exactly the limit", () => {
    const caption = "y".repeat(CAPTION_MAX_LENGTH);
    expect(parsePhotoTagForm(form({ photoId: PHOTO, caption }))).toMatchObject({ ok: true, data: { caption } });
  });
});

describe("the small forms", () => {
  it("reads the report choice as a boolean", () => {
    expect(parseForm(PhotoReportFormSchema, form({ photoId: PHOTO, include: "true" }))).toEqual({
      ok: true,
      data: { photoId: PHOTO, include: true },
    });
    expect(parseForm(PhotoReportFormSchema, form({ photoId: PHOTO, include: "false" }))).toEqual({
      ok: true,
      data: { photoId: PHOTO, include: false },
    });
    expect(parseForm(PhotoReportFormSchema, form({ photoId: PHOTO, include: "yes" }))).toEqual({
      ok: false,
      message: "Say whether the photo goes into the report.",
    });
  });

  it("answers a missing or malformed id with the not-found words", () => {
    expect(parseForm(PhotoIdFormSchema, form({}))).toEqual({ ok: false, message: "This photo could not be found." });
    expect(parseForm(FileIdFormSchema, form({ fileId: PHOTO.toUpperCase() }))).toEqual({
      ok: false,
      message: "This file could not be found.",
    });
    expect(parseForm(FileIdFormSchema, form({ fileId: PHOTO }))).toEqual({ ok: true, data: { fileId: PHOTO } });
  });

  it("reads text fields only: a file posted in a text field counts as missing", () => {
    const data = form({ caption: "Text", photoId: new Blob(["x"]) });
    expect(formText(data, "caption")).toBe("Text");
    expect(formText(data, "photoId")).toBeNull();
    expect(formText(data, "absent")).toBeNull();
  });
});
