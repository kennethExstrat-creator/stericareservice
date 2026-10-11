// Source Documents' Media as the server draws it, with the inspection's
// photos and files as the browser would have loaded them: the four
// categories in order, each one compact row until it holds something, and
// Other only while photos or videos are in no category.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => ({ media: null as import("@/components/capture/photos/media-store").MediaState | null }));
vi.mock("@/components/capture/photos/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/capture/photos/hooks")>();
  return {
    ...actual,
    useInspectionMedia: (inspectionId: string) => {
      const media = actual.useInspectionMedia(inspectionId);
      return loaded.media ?? media;
    },
  };
});

import type { MediaState } from "@/components/capture/photos/media-store";
import { EMPTY_TAG_OPTIONS, type MediaFile, type MediaPhoto } from "@/lib/inspections/photos/view";
import { MEDIA_CATEGORIES, SOURCE_DOCUMENTS_KEY, SOURCE_MEDIA_KEY } from "@/lib/inspections/source-documents";
import { SourceMedia } from "./source-media";

const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const INSPECTOR = "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c";

function photo(id: string, moduleKey: string | null, target: string | null = null): MediaPhoto {
  return {
    id,
    inspectionId: INSPECTION,
    moduleKey,
    target,
    caption: null,
    takenAt: null,
    width: 2048,
    height: 1536,
    flagged: false,
    includeInReport: false,
    createdBy: INSPECTOR,
    createdAt: "2026-10-11T01:14:05.123456+00:00",
    storagePath: `${INSPECTION}/${id}.jpg`,
    thumbPath: `${INSPECTION}/thumbs/${id}.jpg`,
    thumbUrl: `https://storage.example/thumb/${id}`,
    fullUrl: `https://storage.example/full/${id}`,
  };
}

function file(id: string, moduleKey: string, name: string, kind: MediaFile["kind"] = "other"): MediaFile {
  return {
    id,
    inspectionId: INSPECTION,
    moduleKey,
    kind,
    name,
    createdBy: INSPECTOR,
    createdAt: "2026-10-11T01:15:00.000000+00:00",
    storagePath: `${INSPECTION}/${id}`,
    url: `https://storage.example/file/${id}`,
  };
}

function ready(photos: MediaPhoto[], files: MediaFile[], canEdit = true): MediaState {
  return {
    status: "ready",
    error: null,
    media: {
      inspection: { id: INSPECTION, refNo: "INS-2026-0042", status: "draft", inspectorId: INSPECTOR },
      access: { canEdit, isAdmin: false },
      photos,
      files,
      options: EMPTY_TAG_OPTIONS,
      signedAt: 0,
      problems: [],
    },
  };
}

const render = (readOnly = false) => renderToStaticMarkup(<SourceMedia inspectionId={INSPECTION} readOnly={readOnly} />);

/** Each section's markup, by its data-category. */
function sections(html: string): Record<string, string> {
  const parts = html.split('data-slot="media-category"').slice(1);
  return Object.fromEntries(parts.map((part) => [/data-category="([^"]+)"/.exec(part)?.[1] ?? "?", part]));
}

const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const POSITIONING = ["relative", "absolute", "fixed", "sticky", "sr-only"];

/** sr-only elements with no positioned ancestor in the markup (docs/DESIGN.md, design review D1). */
function unanchoredSrOnly(html: string): string[] {
  const open: { tag: string; positioned: boolean }[] = [];
  const found: string[] = [];
  for (const [, closing, tag, attributes, selfClosing] of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    if (closing) {
      const index = open.map((element) => element.tag).lastIndexOf(tag);
      if (index !== -1) open.length = index;
      continue;
    }
    const classes = (/\sclass="([^"]*)"/.exec(attributes)?.[1] ?? "").split(/\s+/);
    if (classes.includes("sr-only") && !open.some((element) => element.positioned)) found.push(`<${tag}${attributes}>`);
    if (VOID_ELEMENTS.has(tag) || selfClosing) continue;
    open.push({ tag, positioned: classes.some((name) => POSITIONING.includes(name)) });
  }
  return found;
}

afterEach(() => {
  loaded.media = null;
});

describe("SourceMedia", () => {
  it("shows the four categories in order, each one row: title, count, hint, Add Photos and Add Videos", () => {
    loaded.media = ready([], []);
    const html = render();
    const shown = sections(html);
    expect(Object.keys(shown)).toEqual(MEDIA_CATEGORIES.map((category) => category.key));
    for (const { key, title, hint } of MEDIA_CATEGORIES) {
      const part = shown[key];
      expect(part, key).toMatch(new RegExp(`<h3[^>]*>${title}</h3>`));
      expect(part, key).toContain(">0 photos · 0 videos<");
      expect(part, key).toContain(`>${hint}<`);
      // Read out with where they go: four sections share the buttons' words.
      expect(part, key).toContain(`Add Photos<span class="sr-only"> to ${title}</span>`);
      expect(part, key).toContain(`Add Videos<span class="sr-only"> to ${title}</span>`);
      // Nothing listed yet: no photo or video block under the row.
      expect(part, key).not.toContain('data-slot="module-photos"');
      expect(part, key).not.toContain('data-slot="file-slot"');
    }
    // The iPad's pickers: photos and videos, several at once.
    expect(html.match(/<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*multiple=""/g)).toHaveLength(4);
    expect(html.match(/<input[^>]*type="file"[^>]*accept="video\/\*"[^>]*multiple=""/g)).toHaveLength(4);
    expect(html).not.toContain(">Other</h3>");
    expect(unanchoredSrOnly(html)).toEqual([]);
  });

  it("lists a category's photos and videos under its row, and only its own", () => {
    loaded.media = ready(
      [photo("p1", "media_warehouse"), photo("p2", "media_warehouse"), photo("p3", "media_defects")],
      [file("v1", "media_warehouse", "IMG_0001.MOV")],
    );
    const shown = sections(render());
    expect(shown.media_warehouse).toContain(">2 photos · 1 video<");
    expect(shown.media_warehouse).toContain('data-slot="module-photos" data-variant="capture" data-module="media_warehouse"');
    expect(shown.media_warehouse.match(/data-slot="photo-card"/g)).toHaveLength(2);
    expect(shown.media_warehouse).toContain('data-slot="file-slot" data-module="media_warehouse"');
    expect(shown.media_warehouse).toContain("IMG_0001.MOV");
    // The tile names the category by its title, never its key.
    expect(shown.media_warehouse).toContain('alt="Warehouse"');
    expect(shown.media_defects).toContain(">1 photo · 0 videos<");
    expect(shown.media_defects).not.toContain("IMG_0001.MOV");
    expect(shown.media_samples).toContain(">0 photos · 0 videos<");
    // Compact rows for a list of photos: no heading of their own, no "loading" or "none" line.
    expect(shown.media_warehouse).not.toMatch(/<h3[^>]*>Photos<\/h3>|<h3[^>]*>Videos<\/h3>|No videos yet|Loading photos/);
  });

  it("shows Other only while photos or videos are in no category: untagged, a step's, the first tab's videos", () => {
    loaded.media = ready(
      [photo("p1", "media_proof"), photo("p2", null), photo("p3", "visual", "size:M")],
      [
        file("v1", SOURCE_MEDIA_KEY, "Walkthrough.mp4"),
        // Not media: Source Documents' papers and a step's lab report.
        file("d1", SOURCE_DOCUMENTS_KEY, "PO-0001.pdf"),
        file("l1", "tensile", "Tensile.pdf", "lab_report"),
      ],
    );
    const html = render();
    const other = sections(html).other;
    expect(other).toMatch(/<h3[^>]*>Other<\/h3>/);
    expect(other).toContain(">2 photos · 1 video<");
    expect(other).toContain(">Not in a category yet. Edit a photo to move it into one.<");
    // Each tile names its own tag: the list mixes them.
    expect(other).toContain(">Not Tagged<");
    expect(other).toContain(">Visual · Size M<");
    expect(other).toContain("Walkthrough.mp4");
    // Nothing is added to Other: photos and videos go in a category.
    expect(other).not.toContain("Add Photos");
    expect(html).not.toContain("PO-0001.pdf");
    expect(html).not.toContain("Tensile.pdf");

    loaded.media = ready([photo("p1", "media_proof")], [file("v2", "media_samples", "Samples.mov")]);
    expect(render()).not.toContain(">Other</h3>");
  });

  it("adds nothing on a read-only screen", () => {
    loaded.media = ready([photo("p2", null)], [], false);
    const html = render(true);
    expect(html).not.toContain("Add Photos");
    expect(html).not.toContain('type="file"');
    expect(sections(html).other).toContain(">Not in a category.<");
  });

  it("says Loading… in each row until the photos are known, never 0", () => {
    const html = render();
    expect(html.match(/>Loading…</g)).toHaveLength(MEDIA_CATEGORIES.length);
    expect(html).not.toContain("0 photos");
  });
});
