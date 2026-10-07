// Server-rendered markup of the documents capture: the template's items in
// its order and wording, status by tapping, expiry dates from a date picker,
// calc's result per item (chip and selected colour) and its warnings beside
// the field, rows that keep their size when focus moves, and read-only.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CaptureFocus, CaptureProps, InspectionContext, ModuleEvaluation } from "@/modules/_framework";
import { FileSlotProvider, type FileSlotRequest } from "@/modules/_framework/file-slot";
import { makeTestContext } from "@/modules/_framework/testing";
import { calcDocuments, type DocumentsComputed } from "./calc";
import Capture, { DocumentRow, documentTagLine } from "./Capture";
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
    evaluated = data,
    context = CONTEXT,
    slots,
    changes,
    focus,
  }: {
    readOnly?: boolean;
    labels?: Record<string, string>;
    config?: DocumentsConfig;
    broken?: boolean;
    /** The data calc last saw, when it lags behind the data on screen. */
    evaluated?: DocumentsData;
    context?: InspectionContext;
    /** Renders inside a screen's file slot, collecting its requests. */
    slots?: FileSlotRequest[];
    /** Collects every onChange. */
    changes?: DocumentsData[];
    focus?: CaptureFocus;
  } = {},
): string {
  const output = calcDocuments({
    data: evaluated,
    config,
    title: DOCUMENTS_TITLE,
    labels,
    context,
    results: {},
    hasData: true,
  });
  const evaluation: ModuleEvaluation<DocumentsComputed> = {
    key: "documents",
    title: DOCUMENTS_TITLE,
    labels,
    config,
    data: evaluated,
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
    context,
    evaluation,
    focusPath: null,
    readOnly,
    focus,
    onChange: changes ? (next) => changes.push(next) : noop,
  };
  if (!slots) return renderToStaticMarkup(<Capture {...props} />);
  return renderToStaticMarkup(
    <FileSlotProvider
      render={(request) => {
        slots.push(request);
        return <span data-test="screen-slot" />;
      }}
    >
      <Capture {...props} />
    </FileSlotProvider>,
  );
}

const FILE = "00000000-0000-4000-8000-000000000501";

const tagsWith = (html: string, attribute: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<[^>]*${attribute}[^>]*>`, "g")), (match) => match[0]);
const escapeAttribute = (value: string) => value.replaceAll('"', "&quot;");

describe("documents capture: files", () => {
  it("says where files are attached when the screen gives no file slot (preview, review)", () => {
    const html = render(emptyDocuments());
    expect(html).toContain("Attach files on the inspection screen.");
    // Nor a tag line: photos are added on the inspection screen too.
    expect(html).not.toContain('data-slot="document-tags"');
  });

  it("offers the screen's file slot, adding only once a document is chosen, deleting always", () => {
    const slots: FileSlotRequest[] = [];
    const html = render(emptyDocuments(), { slots });
    expect(html).toContain('<span data-test="screen-slot"></span>');
    expect(html).toContain(
      "Choose a document above first: its photos are then tagged with it, and its file filed under it.",
    );
    // Nothing chosen yet: nothing to file a new file under, but the files listed can still be deleted.
    expect(slots).toEqual([
      expect.objectContaining({
        moduleKey: "documents",
        kind: "certificate",
        title: DOCUMENTS_TITLE,
        focus: null,
        readOnly: false,
        addable: false,
      }),
    ]);
    const approved: FileSlotRequest[] = [];
    render(emptyDocuments(), { slots: approved, readOnly: true });
    expect(approved[0]).toMatchObject({ readOnly: true, addable: false });
  });

  it("files a new file under the document in focus, for that document's kind", () => {
    const slots: FileSlotRequest[] = [];
    const changes: DocumentsData[] = [];
    const data = emptyDocuments();
    const html = render(data, { slots, changes, focus: { item: "labTestReports" } });
    expect(html).toContain("New photos are tagged “Lab test reports”, and new files are filed under it.");
    expect(slots[0]).toMatchObject({ kind: "lab_report", focus: { item: "labTestReports" }, readOnly: false, addable: true });
    slots[0].onAdded({ id: FILE, name: "Lab test report.pdf", kind: "lab_report" });
    expect(changes).toEqual([{ ...data, items: { ...data.items, labTestReports: { ...data.items.labTestReports, file: FILE } } }]);
  });

  it("opens on no document when the one in focus is not on the checklist", () => {
    const slots: FileSlotRequest[] = [];
    const changes: DocumentsData[] = [];
    render(emptyDocuments(), { slots, changes, focus: { item: "sterilisation" }, config: REQUIRED_ISO });
    expect(slots[0]).toMatchObject({ focus: null, addable: false });
    slots[0].onAdded({ id: FILE, name: "Certificate.pdf", kind: "certificate" });
    expect(changes).toEqual([]);
  });

  it("lets go of a deleted file wherever an item kept it", () => {
    const data = emptyDocuments();
    data.items.iso13485 = { ...data.items.iso13485, status: "verified", file: FILE };
    const slots: FileSlotRequest[] = [];
    const changes: DocumentsData[] = [];
    render(data, { slots, changes });
    slots[0].onRemoved(FILE);
    expect(changes.at(-1)?.items.iso13485).toEqual({ ...data.items.iso13485, file: null });
  });

  it("says on the row that its file is attached, or missing", () => {
    const data = emptyDocuments();
    data.items.iso13485 = { ...data.items.iso13485, status: "verified", file: FILE };
    expect(render(data)).toContain('data-file-state="attached"');
    // The kit's attachment line: the file in the template's wording, and Attached.
    const [line] = tagsWith(render(data), 'data-slot="attachment-status"');
    expect(line).toContain('data-attached="true"');
    expect(render(data)).toMatch(/>File<\/span><span[^>]*>Attached<\/span>/);
    const gone = render(data, { context: makeTestContext({ ...CONTEXT, files: [] }) });
    expect(gone).toContain('data-file-state="missing"');
    expect(gone).toMatch(/>File<\/span><span[^>]*>Not Attached<\/span>/);
    // calc's warning, in the template's wording, replaces the line's own words.
    expect(gone).toContain("ISO 13485: the file attached here is not among this inspection&#x27;s files. It may still be uploading from another device; if it was deleted, attach it again.");
    expect(gone).not.toContain("The file attached here is not among");
  });

  it("gives the issue link to a missing file something to focus: the file line, which the row's status names", () => {
    const data = emptyDocuments();
    data.items.iso13485 = { ...data.items.iso13485, status: "verified", file: FILE };
    const gone = render(data, { context: makeTestContext({ ...CONTEXT, files: [] }) });
    // The kit's attachment line takes the focus itself (tabIndex -1), with a visible ring.
    const [line] = tagsWith(gone, 'data-slot="attachment-status"');
    expect(line).toContain('data-state="missing"');
    expect(line).toContain('tabindex="-1"');
    expect(line).toContain(`data-issue-path="${escapeAttribute(JSON.stringify(["items", "iso13485", "file"]))}"`);
    expect(line).toContain("focus-ring");
    // The row's status is described by it.
    const [wrapper] = tagsWith(gone, 'data-file-state="missing"');
    const id = /\sid="([^"]+)"/.exec(wrapper)?.[1];
    expect(id).toBeDefined();
    expect(tagsWith(gone, `aria-describedby="${id}"`)).toHaveLength(1);
    // Attached: nothing to point at from the status.
    expect(render(data)).not.toContain("aria-describedby");
  });
});

/** Each pressed status button's words and the status colour it wears (null: none). */
function selected(html: string): [string, string | null][] {
  return Array.from(html.matchAll(/<button([^>]*)data-state="on"([^>]*)>([^<]*)<\/button>/g), (match) => [
    match[3],
    /data-\[state=on\]:text-(pass|fail|warn|info)\b/.exec(`${match[1]}${match[2]}`)?.[1] ?? null,
  ]);
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
  it("heads the desktop columns in the template's wording", () => {
    const labels = { ...DOCUMENTS_LABELS, referenceNo: "Certificate no.", expiryDate: "Valid until" };
    const html = render(emptyDocuments(), { labels });
    const headings = /<div aria-hidden="true"[^>]*>(.*?)<\/div>/.exec(html)?.[1];
    expect(Array.from(headings?.matchAll(/<span>([^<]*)<\/span>/g) ?? [], (match) => match[1])).toEqual([
      "Documents",
      "Status",
      "Certificate no.",
      "Valid until",
    ]);
  });

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
    // The kit's DateField: four-digit years only, calc's warning in amber, the field described by it.
    expect(html).toMatch(/<input[^>]*type="date"[^>]*max="9999-12-31"/);
    expect(html).toMatch(/<input[^>]*type="date"[^>]*aria-describedby="[^"]*-calc-warning"/);
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
      ["not_done", "Not Done"],
    ]);
  });

  it("colours a selected status with calc's result for the item: red only where the item fails", () => {
    // Not verified: red on the required item, neutral (info) on the optional one, as their chips.
    const data = withIso({ status: "not_verified" });
    data.items.certificateOfAnalysis = { ...data.items.certificateOfAnalysis, status: "not_verified" };
    expect(selected(render(data, { config: REQUIRED_ISO }))).toEqual([
      ["Not verified", "fail"],
      ["Not verified", "info"],
    ]);
    expect(selected(render(withIso({ status: "na" }), { config: REQUIRED_ISO }))).toEqual([["NA", "fail"]]);
    expect(selected(render(withIso({ status: "verified" })))).toEqual([["Verified", "pass"]]);
    // Verified but expired: the warning's amber, as the chip says "Expired".
    expect(selected(render(withIso({ status: "verified", expiryDate: "2025-01-31" })))).toEqual([["Verified", "warn"]]);
    // NA was just tapped; calc still says verified: no verdict colour until calc catches up.
    const lagging = render(withIso({ status: "na" }), { config: REQUIRED_ISO, evaluated: withIso({ status: "verified" }) });
    expect(selected(lagging)).toEqual([["NA", null]]);
    expect(selected(render(withIso({ status: "not_verified" }), { broken: true }))).toEqual([["Not verified", null]]);
  });

  it("draws a row the same whether or not it is in focus, so a tap never moves the rows below it", () => {
    const row = (active: boolean) =>
      renderToStaticMarkup(
        <DocumentRow
          item={{ key: "iso13485", include: true, required: true }}
          entry={{ status: "verified", referenceNo: "CERT-0001", expiryDate: "2025-01-31", file: null }}
          status="warn"
          expired
          labels={DOCUMENTS_LABELS}
          issues={[]}
          active={active}
          readOnly={false}
          onFocusItem={noop}
          onUpdate={noop}
        />,
      );
    expect(row(true)).toContain('data-active="true"');
    expect(row(true).replace(' data-active="true"', "")).toBe(row(false));
  });

  it("says once, under the list, which document new photos and files go under", () => {
    // Inside no row: the line never moves a row while it is pressed.
    const chosen = render(withIso({ status: "verified" }), { slots: [], focus: { item: "iso13485" } });
    expect(chosen.match(/are tagged/g)).toHaveLength(1);
    expect(chosen).toMatch(/<\/ul><\/div><div[^>]*><p data-slot="document-tags"[^>]*>New photos are tagged “ISO 13485/);
    expect(documentTagLine("Lab test reports")).toBe("New photos are tagged “Lab test reports”, and new files are filed under it.");
    expect(documentTagLine(null)).toBe(
      "Choose a document above first: its photos are then tagged with it, and its file filed under it.",
    );
  });

  it("shows calc's result for each item, in the template's words, and its own word while calc catches up", () => {
    const pills = (html: string) =>
      Array.from(
        html.matchAll(/<span data-slot="status-pill" data-status="([a-z_]+)"[^>]*>.*?<span>([^<]*)<\/span><\/span>/g),
        (match) => [match[1], match[2]],
      );
    const labels = { ...DOCUMENTS_LABELS, required: "Mandatory", expired: "Lapsed" };
    const verified = withIso({ status: "verified" });
    expect(pills(render(verified, { config: REQUIRED_ISO, labels }))).toEqual([
      ["pass", "Verified"],
      ["not_done", "Not Done"],
    ]);
    // NA was just tapped; calc still says verified: the chip keeps calc's verdict in its own word.
    expect(pills(render(withIso({ status: "na" }), { config: REQUIRED_ISO, evaluated: verified }))[0]).toEqual([
      "pass",
      "Passed",
    ]);
    const lapsed = render(withIso({ status: "verified", expiryDate: "2025-01-31" }), { config: REQUIRED_ISO, labels });
    expect(pills(lapsed)[0]).toEqual(["warn", "Lapsed"]);
    expect(lapsed).toContain("Mandatory");
    expect(lapsed).not.toContain("Required");
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

  it("makes each item one row only where the module itself is wide enough, never by the screen's width alone", () => {
    const html = render(emptyDocuments());
    // The capture screen's section list leaves the module about 616 px at 1280 px and 702 px at
    // 1366 px, too narrow for the four columns (about 47rem): those keep the stacked rows.
    expect(html).toMatch(/^<div class="@container /);
    const classes = Array.from(html.matchAll(/class="([^"]*)"/g), (match) => match[1].split(" ")).flat();
    const desktop = classes.filter((name) => name.startsWith("xl:"));
    expect(desktop.length).toBeGreaterThan(10);
    expect(desktop.filter((name) => !name.startsWith("xl:@3xl:"))).toEqual([]);
    // A template's longer status words scroll the table rather than hide the expiry date.
    expect(classes).toContain("xl:@3xl:overflow-x-auto");
  });
});
