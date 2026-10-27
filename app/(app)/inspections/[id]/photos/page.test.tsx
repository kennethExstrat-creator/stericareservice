// The gallery as the server renders it: the session check comes first, an
// inspection the user may not read is the same 404 as one that does not
// exist, and the markup each role gets (what the e2e cannot set up on
// demand: an approved inspection, a template that no longer parses).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn(), authorizeAction: vi.fn(), userCan: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/inspections/photos/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/inspections/photos/queries")>()),
  loadInspectionMedia: vi.fn(),
}));

import { requireUser } from "@/lib/auth/session";
import { loadInspectionMedia, type InspectionMedia } from "@/lib/inspections/photos/queries";
import { tagOptionsFromTemplate, type MediaFile, type MediaPhoto } from "@/lib/inspections/photos/view";
import { createClient } from "@/lib/supabase/server";
import InspectionPhotosPage, { generateMetadata } from "./page";

const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const INSPECTOR = "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c";

const options = tagOptionsFromTemplate(
  {
    format: 2,
    code: "PHOTOS_TEST",
    name: "Photos test",
    chain: ["PHOTOS_TEST"],
    bases: [],
    scope: { productType: "examination", standard: "EN455" },
    unit: "pcs",
    sizes: [{ value: "M", label: "M" }],
    modules: [
      { key: "header", include: true, title: "Preshipment Inspection", labels: {}, config: {} },
      { key: "dimensions", include: true, title: "Dimensions", labels: {}, config: {} },
      { key: "force_at_break", include: true, title: "Force at Break", labels: {}, config: {} },
      { key: "visual", include: true, title: "Visual Inspection", labels: { thin_spot: "Thin spot" }, config: {} },
      { key: "conclusion", include: true, title: "Conclusion", labels: {}, config: {} },
    ],
    customModules: [],
    report: { title: "Preshipment Inspection", showClientLogo: false },
    sourceFile: null,
  },
  {},
  [{ code: "thin_spot", name: "Thin spot on glove body" }],
);

function photo(id: string, patch: Partial<MediaPhoto> = {}): MediaPhoto {
  return {
    id,
    inspectionId: INSPECTION,
    moduleKey: "dimensions",
    target: "size:M",
    caption: null,
    takenAt: null,
    width: 2048,
    height: 1536,
    flagged: false,
    includeInReport: false,
    createdBy: INSPECTOR,
    createdAt: "2026-10-06T01:14:05.123456+00:00",
    storagePath: `${INSPECTION}/${id}.jpg`,
    thumbPath: `${INSPECTION}/thumbs/${id}.jpg`,
    thumbUrl: `https://storage.example/thumb/${id}`,
    fullUrl: `https://storage.example/full/${id}`,
    description: null,
    describedAt: null,
    ...patch,
  };
}

const labReport: MediaFile = {
  id: "f1",
  inspectionId: INSPECTION,
  moduleKey: "force_at_break",
  kind: "lab_report",
  name: "Force at break.pdf",
  createdBy: INSPECTOR,
  createdAt: "2026-10-06T01:15:00.000000+00:00",
  storagePath: `${INSPECTION}/f1.pdf`,
  url: "https://storage.example/file/f1",
};

function media(patch: Partial<InspectionMedia> = {}): InspectionMedia {
  return {
    inspection: { id: INSPECTION, refNo: "INS-2026-0042", status: "draft", inspectorId: INSPECTOR },
    access: { canEdit: true, isAdmin: false },
    photos: [
      photo("a"),
      photo("b", { moduleKey: "visual", target: "size:M/defect:thin_spot", caption: "Near the cuff", includeInReport: true }),
      photo("c", { moduleKey: null, target: null }),
    ],
    files: [labReport],
    options,
    signedAt: 1_000,
    problems: [],
    ...patch,
  };
}

const params = { params: Promise.resolve({ id: INSPECTION }) } as PageProps<"/inspections/[id]/photos">;

async function render(loaded: Awaited<ReturnType<typeof loadInspectionMedia>>): Promise<string> {
  vi.mocked(loadInspectionMedia).mockResolvedValue(loaded);
  return renderToStaticMarkup(await InspectionPhotosPage(params));
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

beforeEach(() => {
  vi.mocked(requireUser).mockReset();
  vi.mocked(loadInspectionMedia).mockReset();
  vi.mocked(requireUser).mockResolvedValue({
    id: INSPECTOR,
    email: "inspector@test.local",
    fullName: "Test Inspector",
    role: "inspector",
  });
  vi.mocked(createClient).mockResolvedValue({} as never);
});

describe("/inspections/[id]/photos", () => {
  it("checks the session before it reads the inspection, for the title too", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(generateMetadata(params)).rejects.toThrow("NEXT_REDIRECT");
    await expect(render({ kind: "ok", media: media() })).rejects.toThrow("NEXT_REDIRECT");
    expect(loadInspectionMedia).not.toHaveBeenCalled();
  });

  it("names the inspection in the title", async () => {
    vi.mocked(loadInspectionMedia).mockResolvedValue({ kind: "ok", media: media() });
    expect(await generateMetadata(params)).toEqual({ title: "Photos · INS-2026-0042" });
    expect(vi.mocked(loadInspectionMedia).mock.calls[0][1]).toBe(INSPECTION);
  });

  it("is a 404 for an inspection the user may not read, in the title and the page", async () => {
    vi.mocked(loadInspectionMedia).mockResolvedValue({ kind: "not_found" });
    await expect(generateMetadata(params)).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    await expect(render({ kind: "not_found" })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("hands a failed load to the error screen, which offers to try again", async () => {
    await expect(render({ kind: "error", message: "The photos could not be loaded." })).rejects.toThrow(
      "The photos could not be loaded.",
    );
  });

  it("shows the owner every photo by module in template order, untagged last, and nothing to add", async () => {
    const html = await render({ kind: "ok", media: media() });
    expect(html).toContain("Photos and Files");
    expect(html).toContain("Back to Inspection");
    expect(html).toContain("INS-2026-0042");
    expect(html).toContain(`href="/inspections/${INSPECTION}"`);
    expect([...html.matchAll(/data-group="([^"]+)"/g)].map(([, key]) => key)).toEqual(["dimensions", "visual", "untagged"]);
    expect(html).toContain("3 photos in 2 modules · 1 file");
    // A viewer: photos, videos and files are added on Source Documents (12 October 2026).
    expect(html).not.toContain('type="file"');
    expect(html).not.toMatch(/Add Photos|Take Photo|Add From Library|Drop photos here|Choose Photos|Add Lab Report|Category or Module/);
    expect(html).not.toContain("Go to Source Documents");
    // Tags in words, under the module's heading.
    expect(html).toContain("Size M · Thin spot");
    expect(html).toContain("Near the cuff");
    // The tile's badge (components/qc/photo-tile.tsx); never the admin's "Include in Report".
    expect(html).toContain(">In Report<");
    expect(html).toContain("Edit a photo to tag it with the category or module it belongs to.");
    // The files in one list, each with where it belongs, as on Source Documents: Preview, Download, Delete.
    expect(html).toContain(">Files</h2>");
    expect(html).toMatch(/data-slot="file-row"[\s\S]*?>Force at Break<\/span>/);
    expect(html).toContain("Preview Force at break.pdf</span>");
    expect(html).toContain("Download Force at break.pdf</span>");
    expect(html).toContain('<span class="sr-only">Delete Force at break.pdf</span>');
    expect(html).not.toContain("in a new tab");
    expect(unanchoredSrOnly(html)).toEqual([]);
  });

  it("shows Source Documents' Media categories first, by their titles and hints, never their keys", async () => {
    const html = await render({
      kind: "ok",
      media: media({
        photos: [
          ...media().photos,
          photo("d", { moduleKey: "media_defects", target: null }),
          photo("e", { moduleKey: "media_warehouse", target: null, caption: "Pallets by the door" }),
        ],
        files: [labReport, { ...labReport, id: "f2", moduleKey: "media_warehouse", kind: "other", name: "IMG_0005.MOV" }],
      }),
    });
    expect([...html.matchAll(/data-group="([^"]+)"/g)].map(([, key]) => key)).toEqual([
      "media_warehouse",
      "media_defects",
      "dimensions",
      "visual",
      "untagged",
    ]);
    expect(html).toContain("5 photos in 2 categories and 2 modules · 2 files");
    expect(html).toContain(">Warehouse<");
    expect(html).toContain(">Product Defects<");
    expect(html).toContain("Stored cartons, pallets and storage conditions.");
    // The tile's text alternative names the category when the photo has no caption.
    expect(html).toContain('alt="Product Defects"');
    // A category's video, in the files' own list.
    expect(html).toMatch(/data-slot="file-row"[\s\S]*?>Warehouse<\/span>/);
    // The keys stay in the data attributes only.
    expect(html.replace(/data-(group|module)="[^"]*"/g, "")).not.toMatch(/media_|Media Warehouse|Media Defects/);
  });

  it("lets the inspector edit and delete, but not choose report photos", async () => {
    const html = await render({ kind: "ok", media: media() });
    expect(html).toContain("Edit tags and caption");
    expect(html).toContain("Delete photo");
    expect(html).not.toContain('role="switch"');
  });

  it("shows a submitted inspection read-only, with the reason", async () => {
    const html = await render({
      kind: "ok",
      media: media({ inspection: { ...media().inspection, status: "submitted" }, access: { canEdit: false, isAdmin: false } }),
    });
    expect(html).toContain("This inspection has been submitted, so its photos and files can no longer change.");
    expect(html).not.toMatch(/Add photos/i);
    expect(html).not.toMatch(/Take photo/i);
    expect(html).not.toMatch(/Edit tags and caption/i);
    expect(html).not.toMatch(/Delete photo/i);
    expect(html).not.toMatch(/Add lab report/i);
    expect(html).not.toContain("Go to Source Documents");
    expect(html).toContain('title="Preview"');
  });

  it("lets an admin choose report photos on an approved inspection, and nothing else", async () => {
    const html = await render({
      kind: "ok",
      media: media({ inspection: { ...media().inspection, status: "approved" }, access: { canEdit: false, isAdmin: true } }),
    });
    expect(html).toContain("You can still choose which photos go into the report.");
    expect(html.match(/role="switch"/g)).toHaveLength(3);
    expect(html).not.toMatch(/Edit tags and caption/i);
    expect(html).not.toMatch(/Take photo/i);
  });

  it("says what could not be loaded, and points once to Source Documents, where photos and files are added", async () => {
    const html = await render({
      kind: "ok",
      media: media({ photos: [], files: [], problems: ["Some photos could not be shown. Reload the page to try again."] }),
    });
    expect(html).toContain("Some photos could not be shown.");
    expect(html).toContain(">No Photos Yet</h2>");
    expect(html).toContain("No files yet.");
    expect(html.match(/Go to Source Documents/g)).toHaveLength(1);
    expect(html).toContain(`href="/inspections/${INSPECTION}?module=source_documents"`);
    // With photos, the empty files list has the button.
    const noFiles = await render({ kind: "ok", media: media({ files: [] }) });
    expect(noFiles).toContain("No files yet.");
    expect(noFiles.match(/Go to Source Documents/g)).toHaveLength(1);
  });
});
