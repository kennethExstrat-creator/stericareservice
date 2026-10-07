// The gallery as the server renders it: the session check comes first, an
// inspection the user may not read is the same 404 as one that does not
// exist, and the markup each role gets (what the e2e cannot set up on
// demand: an approved inspection, a template that no longer parses).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn(), authorizeAction: vi.fn() }));
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

  it("shows the owner every photo by module in template order, untagged last, with the add controls", async () => {
    const html = await render({ kind: "ok", media: media() });
    expect(html).toContain("Photos and Files");
    expect(html).toContain("Back to Inspection");
    expect(html).toContain("Add Photos");
    expect(html).toContain("INS-2026-0042");
    expect(html).toContain(`href="/inspections/${INSPECTION}"`);
    expect([...html.matchAll(/data-group="([^"]+)"/g)].map(([, key]) => key)).toEqual(["dimensions", "visual", "untagged"]);
    expect(html).toContain("3 photos in 2 modules · 1 file");
    // The iPad's two buttons and the desktop's drop zone; the camera input opens the rear camera.
    expect(html).toContain("Take Photo");
    expect(html).toContain("Add From Library");
    expect(html).toContain("Drop photos here, several at once");
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*capture="environment"/);
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*multiple=""/);
    // Tags in words, under the module's heading.
    expect(html).toContain("Size M · Thin spot");
    expect(html).toContain("Near the cuff");
    // The tile's badge, in the kit's case (components/qc/photo-tile.tsx); never the admin's "Include in Report".
    expect(html).toMatch(/>In report</i);
    expect(html).toContain("Edit a photo to tag it with the module it belongs to.");
    // Lab reports: the force at break slot, its file and its own picker.
    expect(html).toContain("Lab Reports and Certificates");
    expect(html).toContain("Force at break.pdf");
    expect(html).toContain('accept="application/pdf,.pdf,image/*"');
    expect(html).toContain("Add Lab Report");
    expect(unanchoredSrOnly(html)).toEqual([]);
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
    expect(html).toContain("Open<span");
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

  it("says what could not be loaded, and invites the first photo", async () => {
    const html = await render({
      kind: "ok",
      media: media({ photos: [], files: [], problems: ["Some photos could not be shown. Reload the page to try again."] }),
    });
    expect(html).toContain("Some photos could not be shown.");
    expect(html).toContain("No photos yet");
    expect(html).toContain("No lab reports yet.");
  });
});
