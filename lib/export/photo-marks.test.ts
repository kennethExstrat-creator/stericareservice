import { describe, expect, it } from "vitest";
import { makeStdEgExport } from "@/lib/ai/__fixtures__/std-eg-export";
import { ExportSchema } from "@/lib/schemas/export";
import { withPhotoMarks } from "./photo-marks";

// The Report page's live export takes each photo's defect marks and natural
// size from the photos the capture screen holds (Kenneth, 27 October 2026).

describe("withPhotoMarks", () => {
  const doc = makeStdEgExport();
  const [first, second] = doc.photos;
  const circle = { x: 0.3, y: 0.7, r: 0.15 };

  it("gives each photo its marks and size, by id, and leaves the others as they are", () => {
    const marked = withPhotoMarks(doc, [
      { id: first.id, markers: [circle], width: 2048, height: 1536 },
      { id: "not-in-the-export", markers: [circle], width: 10, height: 10 },
    ]);
    expect(marked.photos[0]).toEqual({ ...first, markers: [circle], size: { width: 2048, height: 1536 } });
    expect(marked.photos[1]).toBe(second);
    expect(ExportSchema.safeParse(marked).success).toBe(true);
    // The document handed in is not changed.
    expect(doc.photos[0]).toBe(first);
  });

  it("keeps the photo's size where the screen has none, and gives no marks where it holds none", () => {
    const sized = { ...doc, photos: [{ ...first, size: { width: 4032, height: 3024 } }] };
    expect(withPhotoMarks(sized, [{ id: first.id, width: null, height: null }]).photos[0]).toMatchObject({
      markers: [],
      size: { width: 4032, height: 3024 },
    });
  });

  it("is the document itself with no photos to lay over it", () => {
    expect(withPhotoMarks(doc, [])).toBe(doc);
  });
});
