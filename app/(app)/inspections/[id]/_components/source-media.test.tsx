// Source Documents' Media as the server draws it, with the inspection's
// photos and files as the browser would have loaded them: Auto-Sort, then
// the four categories in order, each one compact row until it holds
// something and then its photos and videos as rows, and Other, always last,
// for what the AI could not place.
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
  it("shows Auto-Sort, then the four categories and Other in order, each one row: title, count, hint and Add", () => {
    loaded.media = ready([], []);
    const html = render();
    const shown = sections(html);
    expect(Object.keys(shown)).toEqual([...MEDIA_CATEGORIES.map((category) => category.key), "other"]);
    for (const { key, title, hint } of MEDIA_CATEGORIES) {
      const part = shown[key];
      expect(part, key).toMatch(new RegExp(`<h3[^>]*>${title}</h3>`));
      expect(part, key).toContain(">0 photos · 0 videos<");
      expect(part, key).toContain(`>${hint}<`);
      // Read out with where it goes: four sections share the button's word.
      expect(part, key).toContain(`Add<span class="sr-only"> Photos and Videos to ${title}</span>`);
      expect(part, key).not.toContain('data-slot="media-row"');
    }
    // Auto-Sort first, with its own picker.
    expect(html.indexOf('data-slot="auto-sort"')).toBeLessThan(html.indexOf('data-slot="media-category"'));
    expect(html).toMatch(/<h3[^>]*>Auto-Sort<\/h3>/);
    expect(html).toContain(">Drop all photos and videos here. AI sorts each into its category.<");
    expect(html).toContain("Add Photos and Videos");
    // The iPad's pickers: photos and videos together, several at once; one a category, and Auto-Sort's.
    expect(html.match(/<input[^>]*type="file"[^>]*accept="image\/\*,video\/\*"[^>]*multiple=""/g)).toHaveLength(6);
    expect(sections(html).other).toMatch(/<h3[^>]*>Other<\/h3>/);
    expect(sections(html).other).toContain(">Anything the AI could not place.<");
    expect(unanchoredSrOnly(html)).toEqual([]);
  });

  it("lists a category's photos and videos as rows, with a grip, Preview, Download and Delete", () => {
    loaded.media = ready(
      [photo("p1", "media_warehouse"), photo("p2", "media_warehouse"), photo("p3", "media_defects")],
      [file("v1", "media_warehouse", "IMG_0001.MOV")],
    );
    const html = render();
    const shown = sections(html);
    expect(shown.media_warehouse).toContain(">2 photos · 1 video<");
    expect(shown.media_warehouse.match(/data-slot="media-row"/g)).toHaveLength(3);
    // A photo has no stored name: numbered in upload order across Media. A video keeps its file name.
    expect(shown.media_warehouse).toContain(">Photo 1<");
    expect(shown.media_warehouse).toContain(">Photo 2<");
    expect(shown.media_warehouse).toContain(">IMG_0001.MOV<");
    expect(shown.media_warehouse).toContain('src="https://storage.example/thumb/p1"');
    for (const name of ["Photo 1", "IMG_0001.MOV"]) {
      expect(shown.media_warehouse).toContain(`Move ${name}</span>`);
      expect(shown.media_warehouse).toContain(`Preview ${name}</span>`);
      expect(shown.media_warehouse).toContain(`Download ${name}</span>`);
      expect(shown.media_warehouse).toContain(`Delete ${name}</span>`);
    }
    // Saved under its name, with the stored photo's type.
    expect(shown.media_warehouse).toContain('href="https://storage.example/full/p1?download=Photo%201.jpg"');
    expect(shown.media_warehouse).toContain('href="https://storage.example/file/v1?download=IMG_0001.MOV"');
    // The grip drags; on a touch screen a finger on it does not scroll the page.
    expect(html).toMatch(/<button[^>]*class="[^"]*touch-none[^"]*"[^>]*data-media-grip=""/);
    expect(shown.media_defects).toContain(">1 photo · 0 videos<");
    expect(shown.media_defects).toContain(">Photo 3<");
    expect(shown.media_defects).not.toContain("IMG_0001.MOV");
    expect(shown.media_samples).toContain(">0 photos · 0 videos<");
    expect(unanchoredSrOnly(html)).toEqual([]);
  });

  it("lists in Other what is in no category: untagged, a step's, the first tab's videos", () => {
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
    expect(other).toContain(">Anything the AI could not place.<");
    expect(other).toContain(">Photo 2<");
    // A step's photo says which step it came from.
    expect(other).toContain(">Photo 3<");
    expect(other).toContain(">Visual · Size M<");
    expect(other).toContain(">Walkthrough.mp4<");
    // Photos and videos can be added to Other too.
    expect(other).toContain(" Photos and Videos to Other");
    expect(html).not.toContain("PO-0001.pdf");
    expect(html).not.toContain("Tensile.pdf");

    loaded.media = ready([photo("p1", "media_proof")], [file("v2", "media_samples", "Samples.mov")]);
    expect(sections(render()).other).toContain(">0 photos · 0 videos<");
  });

  it("on a read-only screen adds, moves and deletes nothing; Preview and Download stay", () => {
    loaded.media = ready([photo("p2", null)], [file("v1", "media_proof", "Proof.mp4")], false);
    const html = render(true);
    expect(html).not.toContain('data-slot="auto-sort"');
    expect(html).not.toContain(" Photos and Videos to ");
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("data-media-grip");
    expect(html).not.toContain("Delete ");
    expect(html).toContain("Preview Photo 1</span>");
    expect(html).toContain("Download Proof.mp4</span>");
    expect(sections(html).other).toContain(">Anything the AI could not place.<");
  });

  it("says Loading… in each row until the photos are known, never 0", () => {
    const html = render();
    expect(html.match(/>Loading…</g)).toHaveLength(MEDIA_CATEGORIES.length + 1);
    expect(html).not.toContain("0 photos");
  });
});
