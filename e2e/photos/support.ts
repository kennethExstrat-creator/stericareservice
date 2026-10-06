import { expect, test, type Locator, type Page } from "@playwright/test";

export type UploadFile = { name: string; mimeType: string; buffer: Buffer };

export function isTouch(): boolean {
  return Boolean(test.info().project.use.hasTouch);
}

/** A tap on the iPads, a click on the desktop. */
export async function press(locator: Locator): Promise<void> {
  if (isTouch()) await locator.tap();
  else await locator.click();
}

/**
 * Full page on the desktop. A full-page capture drops touch emulation while
 * it resizes (e2e/README.md), so the iPads get viewport shots, scrolled:
 * name.png, or name-1.png, name-2.png ... for a longer page.
 */
export async function shot(page: Page, name: string): Promise<void> {
  const path = (part = "") => `screenshots/photos/${test.info().project.name}-${name}${part}.png`;
  const options = { animations: "disabled", caret: "initial" } as const;
  // Let toasts and dialogs finish their 100-150 ms entrance first.
  await page.waitForTimeout(300);
  if (!isTouch()) {
    await page.screenshot({ ...options, path: path(), fullPage: true });
    return;
  }
  const { height, viewport } = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
  }));
  const parts = Math.max(1, Math.ceil(height / viewport));
  for (let part = 0; part < parts; part++) {
    await page.evaluate((top) => window.scrollTo(0, top), part * viewport);
    await page.screenshot({ ...options, path: path(parts > 1 ? `-${part + 1}` : "") });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** A viewport screenshot (dialogs, which a full-page capture would cut). */
export async function viewportShot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(300);
  await page.screenshot({
    animations: "disabled",
    caret: "initial",
    path: `screenshots/photos/${test.info().project.name}-${name}.png`,
  });
}

/** Collects console errors, so hydration mismatches fail the test. */
export function watchConsole(page: Page): () => string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => errors.filter((text) => /hydrat|did not match|server rendered/i.test(text));
}

export async function expectNoPageScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
}

/** Touch targets on the iPad: at least 44 px high. */
export async function expectTouchTarget(locator: Locator): Promise<void> {
  if (!isTouch()) return;
  const box = await locator.boundingBox();
  expect(box, "the control is on screen").not.toBeNull();
  expect(box!.height, `${await locator.textContent()} is a 44 px target`).toBeGreaterThanOrEqual(44);
}

/**
 * A photo drawn by the browser itself (a gradient and a label), as JPEG or
 * PNG bytes: real images the app's own decoder reads, with no fixture files.
 */
export async function drawImage(
  page: Page,
  { name, type, width, height, label }: { name: string; type: "image/jpeg" | "image/png"; width: number; height: number; label: string },
): Promise<UploadFile> {
  const dataUrl = await page.evaluate(
    ({ type, width, height, label }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No 2D canvas");
      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#0074d6");
      gradient.addColorStop(1, "#00a292");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      context.fillStyle = "#ffffff";
      context.font = `bold ${Math.round(height / 5)}px sans-serif`;
      context.fillText(label, Math.round(width * 0.08), Math.round(height * 0.6));
      return canvas.toDataURL(type, 0.92);
    },
    { type, width, height, label },
  );
  return { name, mimeType: type, buffer: Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64") };
}

/**
 * The JPEG with an Exif block holding a GPS position (latitude ref "N"), as
 * a phone camera writes it. Processing must leave none of it in the upload.
 */
export function withGpsExif(jpeg: Buffer): Buffer {
  // TIFF, little-endian: IFD0 with one entry, the GPS IFD pointer; the GPS IFD with GPSLatitudeRef "N".
  const tiff = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x25, 0x88, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x01, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, 0x00, 0x4e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const segment = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
  // After SOI and the JFIF APP0 segment, where cameras put it.
  const app0Length = jpeg[2] === 0xff && jpeg[3] === 0xe0 ? (jpeg[4] << 8) | jpeg[5] : 0;
  const at = 2 + (app0Length ? app0Length + 2 : 0);
  return Buffer.concat([jpeg.subarray(0, at), segment, jpeg.subarray(at)]);
}

/** A one-page PDF, the shape of a lab report. */
export function labReportPdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = "BT /F1 18 Tf 72 760 Td (Force at break: lab report, e2e fixture) Tj ET";
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** A stand-in HEIC (an ISO box with the heic brand): no browser here decodes it, so it uploads flagged. */
export function undecodableHeic(): Buffer {
  const ftyp = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00, 0x6d, 0x69, 0x66, 0x31,
    0x68, 0x65, 0x69, 0x63,
  ]);
  return Buffer.concat([ftyp, Buffer.alloc(512, 0x11)]);
}

/** Holds the uploads to one bucket until released, so the pending state can be seen. */
export async function holdUploads(page: Page, bucket: string): Promise<{ release: () => Promise<void> }> {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const pattern = `**/storage/v1/object/${bucket}/**`;
  const handler = async (route: import("@playwright/test").Route) => {
    await gate;
    // unroute() may already have let a held request through.
    await route.continue().catch(() => undefined);
  };
  await page.route(pattern, handler);
  return {
    release: async () => {
      open();
      await page.unroute(pattern, handler);
    },
  };
}
