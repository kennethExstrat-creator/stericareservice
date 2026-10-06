// Server-rendered markup of the documents capture: the template's items in
// its order and wording, status by tapping, expiry dates from a date picker,
// calc's warnings beside the field, and read-only.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CaptureProps, ModuleEvaluation } from "@/modules/_framework";
import { makeTestContext } from "@/modules/_framework/testing";
import { calcDocuments, type DocumentsComputed } from "./calc";
import Capture from "./Capture";
import { DOCUMENTS_DEFAULT_CONFIG, DOCUMENTS_LABELS, DOCUMENTS_TITLE, type DocumentsConfig } from "./config";
import { emptyDocuments, type DocumentsData } from "./schema";

const noop = () => {};
const BLANK = makeTestContext();
const CONTEXT = makeTestContext({ header: { ...BLANK.header, inspectionDate: "2025-04-11" } });

function render(
  data: DocumentsData,
  {
    readOnly = false,
    labels = DOCUMENTS_LABELS,
    config = DOCUMENTS_DEFAULT_CONFIG,
    broken = false,
  }: { readOnly?: boolean; labels?: Record<string, string>; config?: DocumentsConfig; broken?: boolean } = {},
): string {
  const output = calcDocuments({ data, config, title: DOCUMENTS_TITLE, labels, context: CONTEXT, results: {}, hasData: true });
  const evaluation: ModuleEvaluation<DocumentsComputed> = {
    key: "documents",
    title: DOCUMENTS_TITLE,
    labels,
    config,
    data,
    hasData: true,
    comment: null,
    // What the engine hands over when the module cannot be evaluated: nothing computed.
    computed: broken ? ({} as DocumentsComputed) : output.computed,
    result: output.result,
    issues: output.issues.map((issue) => ({ ...issue, moduleKey: "documents" })),
    stub: false,
  };
  const props: CaptureProps<DocumentsData, DocumentsConfig, DocumentsComputed> = {
    data,
    config,
    title: DOCUMENTS_TITLE,
    labels,
    context: CONTEXT,
    evaluation,
    focusPath: null,
    readOnly,
    onChange: noop,
  };
  return renderToStaticMarkup(<Capture {...props} />);
}

function withIso(entry: Partial<DocumentsData["items"]["iso13485"]>): DocumentsData {
  const data = emptyDocuments();
  data.items.iso13485 = { ...data.items.iso13485, ...entry };
  return data;
}

const REQUIRED_ISO: DocumentsConfig = {
  items: [
    { key: "iso13485", include: true, required: true },
    { key: "certificateOfAnalysis", include: true, required: false },
    { key: "sterilisation", include: false, required: false },
  ],
};

describe("documents capture", () => {
  it("lists the template's items in its order, and only those", () => {
    const html = render(emptyDocuments(), { config: REQUIRED_ISO });
    const iso = html.indexOf("ISO 13485");
    const coa = html.indexOf("Certificate of analysis");
    expect(iso).toBeGreaterThan(-1);
    expect(coa).toBeGreaterThan(iso);
    expect(html).not.toContain("Sterilisation certificate and records");
    expect(html.match(/Required/g)).toHaveLength(1);
  });

  it("records the status by tapping verified, not verified or NA, in the template's wording", () => {
    const labels = { ...DOCUMENTS_LABELS, "status.verified": "OK", "status.na": "N/A", iso13485: "Quality certificate" };
    const html = render(withIso({ status: "verified" }), { labels, config: REQUIRED_ISO });
    expect(html).toContain("Quality certificate");
    for (const word of ["OK", "Not verified", "N/A"]) expect(html).toContain(`>${word}</button>`);
    const pressed = Array.from(html.matchAll(/<button[^>]*data-state="on"[^>]*>([^<]*)<\/button>/g), (match) => match[1]);
    expect(pressed).toEqual(["OK"]);
  });

  it("takes the expiry date from a date picker and shows calc's warning beside it", () => {
    const html = render(withIso({ status: "verified", expiryDate: "2025-01-31" }));
    expect(html).toMatch(/<input[^>]*type="date"[^>]*value="2025-01-31"/);
    expect(html).toContain("ISO 13485: Expiry date 2025-01-31 is before the inspection date 2025-04-11.");
    expect(html).toContain('data-issue-path="[&quot;items&quot;,&quot;iso13485&quot;,&quot;expiryDate&quot;]"');
  });

  it("marks a required item that is not verified as failed", () => {
    const html = render(withIso({ status: "not_verified" }), { config: REQUIRED_ISO });
    const pills = Array.from(
      html.matchAll(/<span data-slot="status-pill" data-status="([a-z_]+)"[^>]*>.*?<span>([^<]*)<\/span><\/span>/g),
      (match) => [match[1], match[2]],
    );
    expect(pills).toEqual([
      ["fail", "Not verified"],
      ["not_done", "Not done"],
    ]);
  });

  it("is read-only on an approved inspection: the status becomes its word, fields read-only", () => {
    const html = render(withIso({ status: "verified", referenceNo: "CERT-0001" }), { readOnly: true });
    const inputs = Array.from(html.matchAll(/<input[^>]*>/g), (match) => match[0]);
    expect(inputs).toHaveLength(12);
    expect(inputs.every((tag) => /readonly=""/i.test(tag))).toBe(true);
    expect(html).not.toContain('data-slot="toggle-group-item"');
    expect(html).toMatch(/<p class="[^"]*">Verified<\/p>/);
    expect(html).toContain("No value");
    expect(html).not.toContain("are tagged");
  });

  it("still renders when calc could not run", () => {
    const html = render(withIso({ status: "verified", expiryDate: "2025-01-31" }), { broken: true });
    expect(html).toContain("ISO 13485");
    expect(html).toMatch(/<input[^>]*type="date"[^>]*value="2025-01-31"/);
  });

  it("says so when the template switches every item off", () => {
    const config = { items: DOCUMENTS_DEFAULT_CONFIG.items.map((item) => ({ ...item, include: false })) };
    expect(render(emptyDocuments(), { config })).toContain("No documents are switched on for this template.");
  });
});
