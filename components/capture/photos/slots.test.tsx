// The slots the capture screen drops into every module, as the server
// renders them (the queue and the inspection's media load in the browser):
// the iPad's two buttons with the right inputs, what new photos are tagged
// with, and nothing to add on a read-only screen.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EMPTY_TAG_OPTIONS, tagOptionsFromTemplate } from "@/lib/inspections/photos/view";
import { FileSlot, useInspectionFiles } from "../files";
import { useUploadsWaiting } from "./hooks";
import { nextTagLine, toViewerPhoto } from "./module-photos";
import type { SlotPhoto } from "./photo-model";
import { PhotoSlot } from "./photo-slot";

const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";

const render = (element: ReactElement) => renderToStaticMarkup(element);

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

describe("PhotoSlot", () => {
  const focus = { size: "M", hand: "R" as const, defect: "hole_palm", box: 253 };

  it("takes the capture screen's props and offers the two iPad buttons and the desktop drop zone", () => {
    const html = render(<PhotoSlot inspectionId={INSPECTION} moduleKey="watertight" focus={focus} />);
    expect(html).toContain('data-module="watertight"');
    expect(html).toContain("Take Photo");
    expect(html).toContain("Add From Library");
    expect(html).toContain("Choose Photos");
    expect(html).toContain("Drop photos here, several at once");
    // The rear camera for one photo, the library for several.
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*capture="environment"[^>]*data-photo-input="camera"/);
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*multiple=""[^>]*data-photo-input="library"/);
    // The browser loads the photos: until then the slot never says there are none.
    expect(html).toContain("Loading photos…");
    expect(html).not.toContain("No photos");
    expect(unanchoredSrOnly(html)).toEqual([]);
  });

  it("says what new photos are tagged with: what the module records of the focus", () => {
    // Watertight records size, hand and defect; the box stays behind.
    const html = render(<PhotoSlot inspectionId={INSPECTION} moduleKey="watertight" focus={focus} />);
    expect(html).toContain("New photos are tagged Size M · Right hand · hole_palm.");
    expect(render(<PhotoSlot inspectionId={INSPECTION} moduleKey="header" focus={focus} />)).not.toContain("New photos are tagged");
  });

  it("adds nothing on a read-only screen", () => {
    const html = render(<PhotoSlot inspectionId={INSPECTION} moduleKey="watertight" focus={focus} readOnly />);
    expect(html).not.toMatch(/Take photo/i);
    expect(html).not.toContain("data-photo-input");
    expect(html).not.toContain("New photos are tagged");
  });

  it("leaves the buttons to the module card when asked, and still says how photos are tagged", () => {
    const html = render(<PhotoSlot inspectionId={INSPECTION} moduleKey="dimensions" focus={{ size: "S" }} showAddControls={false} />);
    expect(html).not.toMatch(/Take photo/i);
    expect(html).toContain("New photos are tagged Size S.");
  });
});

describe("nextTagLine", () => {
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
        { key: "visual", include: true, title: "Visual Inspection", labels: { thin_spot: "Thin spot" }, config: {} },
        { key: "labeling", include: true, title: "Labelling", labels: {}, config: {} },
        { key: "conclusion", include: true, title: "Conclusion", labels: {}, config: {} },
      ],
      customModules: [],
      report: { title: "Preshipment Inspection", showClientLogo: false },
      sourceFile: null,
    },
    {},
    [{ code: "thin_spot", name: "Thin spot on glove body" }],
  );

  it("names the defect in the module's wording and drops what the module does not record", () => {
    expect(nextTagLine("visual", { size: "M", hand: "L", defect: "thin_spot", box: 4 }, options)).toBe(
      "Size M · Left hand · Thin spot",
    );
    expect(nextTagLine("labeling", { size: "M", hand: "L", box: 4 }, options)).toBe("Size M · Box 4");
  });

  it("is empty without focus, for modules that record none, and for the untagged slot", () => {
    expect(nextTagLine("visual", null, options)).toBe("");
    expect(nextTagLine("visual", { size: null, hand: null }, options)).toBe("");
    expect(nextTagLine("header", { size: "M" }, options)).toBe("");
    expect(nextTagLine(null, { size: "M" }, options)).toBe("");
  });

  it("leaves out a focus value that is not valid rather than failing", () => {
    expect(nextTagLine("labeling", { size: "M", box: 0 }, options)).toBe("Size M");
  });

  it("says labelling's packaging level in the module's words", () => {
    expect(nextTagLine("labeling", { size: "M", box: 4, level: "carton" }, options)).toBe("Size M · Box 4 · Carton Box");
  });
});

describe("FileSlot", () => {
  it("lists the module's lab reports and offers PDFs or images", () => {
    const html = render(<FileSlot inspectionId={INSPECTION} moduleKey="tensile" kind="lab_report" />);
    expect(html).toContain('data-module="tensile"');
    expect(html).toContain("Lab Reports");
    expect(html).toContain("No lab reports yet.");
    expect(html).toContain("Add Lab Report");
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="application\/pdf,.pdf,image\/\*"[^>]*multiple=""/);
    expect(unanchoredSrOnly(html)).toEqual([]);
  });

  it("words certificates as certificates, and adds nothing read-only", () => {
    const html = render(<FileSlot inspectionId={INSPECTION} moduleKey="documents" kind="certificate" readOnly />);
    expect(html).toContain("Certificates");
    expect(html).toContain("No certificates yet.");
    expect(html).not.toMatch(/Add certificate/i);
    expect(html).not.toContain("data-file-input");
  });

  it("names its add button in Title Case, whatever the kind", () => {
    expect(render(<FileSlot inspectionId={INSPECTION} moduleKey="documents" kind="certificate" />)).toContain("Add Certificate");
    expect(render(<FileSlot inspectionId={INSPECTION} moduleKey="documents" kind="other" />)).toContain("Add Document");
  });

  it("hides the add controls only while there is nothing to file a new file under (canAdd)", () => {
    const html = render(<FileSlot inspectionId={INSPECTION} moduleKey="documents" kind="certificate" canAdd={false} />);
    expect(html).toContain("Certificates");
    expect(html).not.toContain("data-file-input");
  });
});

describe("what the capture screen reads from the queue and the media", () => {
  function Probe({ id }: { id: string }) {
    const files = useInspectionFiles(id);
    const waiting = useUploadsWaiting(id);
    return <p data-files={JSON.stringify(files)} data-waiting={waiting ?? "none"} />;
  }

  it("knows no files and waits on the queue until the browser has read both", () => {
    const html = render(<Probe id={INSPECTION} />);
    expect(html).toContain('data-files="null"');
    expect(html).toContain('data-waiting="Checking for photos waiting on this device."');
  });
});

describe("toViewerPhoto", () => {
  const photo: SlotPhoto = {
    id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    queued: false,
    moduleKey: "watertight",
    target: null,
    caption: null,
    takenAt: null,
    flagged: false,
    includeInReport: false,
    state: "uploaded",
    progress: 1,
    error: null,
    thumbUrl: "https://signed/thumb",
    fullUrl: "https://signed/full",
    pendingRow: false,
  };

  it("shows the full photo, else its preview, else the 'No preview' panel (an unconverted HEIC has neither)", () => {
    expect(toViewerPhoto(photo, EMPTY_TAG_OPTIONS).src).toBe("https://signed/full");
    expect(toViewerPhoto({ ...photo, fullUrl: null, thumbUrl: "blob:local" }, EMPTY_TAG_OPTIONS).src).toBe("blob:local");
    expect(toViewerPhoto({ ...photo, flagged: true, fullUrl: null, thumbUrl: null }, EMPTY_TAG_OPTIONS)).toMatchObject({ src: null, flagged: true });
  });
});
