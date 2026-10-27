// The form's panels as the server renders them, in the states the live
// database cannot show on demand: a draft or unreadable template, ties, an
// admin's choice, and Source Documents before and after the first document.
// The page and its flows run end to end in e2e/new.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The Adds run end to end in reference-actions.test.ts; here only the markup.
vi.mock("../reference-actions", () => ({ addClientFromDocument: vi.fn(), addManufacturerFromDocument: vi.fn() }));

import { FILE_ACCEPT } from "@/components/capture/files/file-add-controls";
import { chooseTemplate, type TemplateChoice } from "@/lib/inspections/create";
import { directoryFromRows, manufacturerDraft } from "@/lib/inspections/reference-match";
import { buildSeedBundle, SAFEDON_EG_SEED, STD_EG_REPORT_SEED, STD_SG_SEED } from "@/lib/templates/definitions";
import { MODULE_REGISTRY } from "@/modules/registry";
import { toTemplateOption } from "../_lib/options";
import type { TemplateOption } from "../_lib/types";
import type { HeldDocument } from "../_lib/sources";
import { ChoiceCard } from "./choice-card";
import { NewClientEntry, NewManufacturerEntry } from "./new-entries";
import { SourceDocumentsPanel, type SummaryLine } from "./source-documents-panel";
import { TemplatePanel, type PickState } from "./template-panel";
import type { HeldSources } from "./use-held-sources";
import { RadioGroup } from "@/components/ui/radio-group";

const CLIENT = "20000000-0000-4000-8000-000000000001";
const noop = () => {};

/**
 * The templates the example reports were made on: STD_EG as versions 1 to 4
 * have it (EN 455, with a factory glove code), SAFEDON_EG and STD_SG. The
 * panel and the copy plan read any template the same way.
 */
const TEMPLATES_OF_THE_REPORTS = [STD_EG_REPORT_SEED, SAFEDON_EG_SEED, STD_SG_SEED];
const bundle = new Map(buildSeedBundle(TEMPLATES_OF_THE_REPORTS, MODULE_REGISTRY).templates.map((entry) => [entry.code, entry]));
let nextId = 1;

function option(code: "STD_EG" | "SAFEDON_EG" | "STD_SG", extra: Record<string, unknown> = {}): TemplateOption {
  const entry = bundle.get(code)!;
  const row = {
    id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
    code,
    version: 1,
    status: "active",
    product_type: entry.definition.scope.productType,
    standard: entry.definition.scope.standard,
    client_id: null,
    manufacturer_id: null,
    resolved: entry.resolved,
    ...extra,
  } as Parameters<typeof toTemplateOption>[0];
  return toTemplateOption(row)!;
}

const ALL_PICKED: PickState[] = [
  { label: "Client", done: true },
  { label: "Manufacturer", done: true },
  { label: "Product Type", done: true },
];

function panel(props: {
  role?: "inspector" | "admin";
  picks?: PickState[];
  templates: TemplateOption[];
  overrideId?: string;
  productType?: "examination" | "surgical";
}) {
  const role = props.role ?? "inspector";
  const productType = props.productType ?? "examination";
  const choice: TemplateChoice = chooseTemplate(
    props.templates,
    { productType, templateId: props.overrideId || undefined },
    role,
  );
  const chosen = choice.ok ? (props.templates.find((template) => template.id === choice.template.id) ?? null) : null;
  return renderToStaticMarkup(
    <TemplatePanel
      id="t"
      role={role}
      picks={props.picks ?? ALL_PICKED}
      productType={productType}
      choice={choice}
      chosen={chosen}
      overrides={props.templates}
      overrideId={props.overrideId ?? ""}
      onOverrideChange={noop}
    />,
  );
}

describe("the template panel", () => {
  it("waits for the choices it needs, saying which are made", () => {
    const html = panel({
      templates: [option("STD_EG")],
      picks: [
        { label: "Client", done: true },
        { label: "Manufacturer", done: false },
        { label: "Product Type", done: false },
      ],
    });
    expect(html).toContain("The template follows from the product type.");
    expect(html).toContain("Client<span class=\"sr-only\">: chosen</span>");
    expect(html).toContain("Manufacturer<span class=\"sr-only\">: not chosen yet</span>");
    expect(html).not.toContain('data-testid="chosen-template"');
    // Nothing to announce yet.
    expect(html).toContain('<p role="status" class="sr-only"></p>');
  });

  // Kenneth, 26 October 2026: every client gets the standard template; a client's own one never applies.
  it("names the template the rule picks, why, its sizes and its sections", () => {
    const html = panel({ templates: [option("STD_EG"), option("SAFEDON_EG", { client_id: CLIENT })] });
    expect(html).toContain('data-code="STD_EG"');
    expect(html).not.toContain('data-code="SAFEDON_EG"');
    expect(html).toContain("Standard examination gloves (EN 455)");
    // A label names the version in Title Case; the announcement is a sentence.
    expect(html).toContain("STD_EG Version 1 · EN 455");
    expect(html).toContain("Standard Template for Examination Gloves");
    expect(html).toContain("XS, S, M, L, XL");
    expect(html).toContain("(pieces)");
    expect(html).toContain("Show the Sections");
    expect(html).toContain("Template: Standard examination gloves (EN 455), STD_EG version 1.");
    expect(html).not.toContain("Use Another Template");
  });

  it("says when no active template fits, and tells an admin what to do", () => {
    const inspector = panel({ templates: [option("STD_EG")], productType: "surgical" });
    expect(inspector).toContain('data-testid="no-template"');
    expect(inspector).toContain("No active template for surgical gloves yet.");
    expect(inspector).not.toContain("Choose a template below");
    const admin = panel({ role: "admin", templates: [option("STD_EG")], productType: "surgical" });
    expect(admin).toContain("Choose a template below.");
    expect(admin).toContain("Use Another Template");
  });

  it("gives an admin the choice of another template, and shows ties to admins only", () => {
    const templates = [option("STD_EG"), option("STD_EG", { code: "OTHER_EG" })];
    const admin = panel({ role: "admin", templates });
    // The picker's options render when it opens (e2e/new checks "Automatic: <code> Version <n>";
    // options.test.ts the options' words).
    expect(admin).toContain("Use Another Template");
    expect(admin).toContain('data-code="OTHER_EG"');
    expect(admin).toContain("Also applies just as closely: STD_EG version 1. The first by code was taken.");
    const inspector = panel({ templates });
    expect(inspector).not.toContain("Also applies just as closely");
  });

  it("puts the admin's picker as far below its label as every other field's, the hint as far below it", () => {
    const html = panel({ role: "admin", templates: [option("STD_EG")] });
    // A Field, as Client, Manufacturer and Product Name are: 12 px (gap-3) between its parts, not 6.
    const field = /<div role="group" data-slot="field"[^>]*class="([^"]*)"[^>]*><label data-slot="field-label"[^>]*for="t-template"/.exec(
      html,
    )?.[1].split(" ");
    expect(field).toContain("gap-3");
    expect(field).not.toContain("gap-1.5");
    expect(field).toContain("border-t");
  });

  it("warns when an admin picks a draft: using it freezes it", () => {
    const draft = option("STD_EG", { code: "DRAFT_EG", status: "draft" });
    const html = panel({ role: "admin", templates: [option("STD_EG"), draft], overrideId: draft.id });
    expect(html).toContain("Chosen by an Admin");
    expect(html).toContain("DRAFT_EG Version 1 · EN 455 · Draft");
    expect(html).toContain("A draft is frozen once an inspection uses it: later edits become a new version.");
  });

  it("names a standard still to be confirmed in Title Case, like the others' names", () => {
    const html = panel({ templates: [option("STD_EG", { standard: "custom" })] });
    expect(html).toContain("STD_EG Version 1 · Standard to Be Confirmed");
  });

  it("says when the version picked cannot be used yet", () => {
    const html = panel({ templates: [option("STD_EG", { resolved: { code: "STD_EG" } })] });
    expect(html).toContain("This version cannot be used yet: an admin needs to save it again.");
    expect(html).not.toContain("Show the Sections");
  });
});

describe("a choice card", () => {
  it("is a labelled radio with a red edge when the group needs a choice", () => {
    const html = renderToStaticMarkup(
      <RadioGroup>
        <ChoiceCard id="c" value="examination" title="Examination Gloves" description="Counted in pieces." invalid />
      </RadioGroup>,
    );
    expect(html).toContain('for="c"');
    expect(html).toContain('role="radio"');
    expect(html).toContain("border-destructive");
    expect(html).toContain("Counted in pieces.");
  });
});

describe("Source Documents", () => {
  const order = new File(["%PDF-1.4"], "Purchase Order.pdf", { type: "application/pdf" });

  function panel(documents: HeldDocument[], filled: SummaryLine[] = [], aiReading = true, entries: ReactNode = null) {
    const sources: HeldSources = {
      documents,
      media: [],
      preparing: 0,
      aiReading,
      canRead: aiReading,
      fill: null,
      addDocuments: noop,
      addMedia: noop,
      removeDocument: noop,
      removeMedia: noop,
      readAgain: noop,
      handOver: async () => {},
    };
    return renderToStaticMarkup(<SourceDocumentsPanel id="s" sources={sources} disabled={false} filled={filled} entries={entries} />);
  }

  it("opens on a large drop area to start from (Kenneth, 26 October 2026)", () => {
    const html = panel([]);
    expect(html).toContain('data-slot="read-drop" data-roomy="true"');
    expect(html).toContain("Start Here");
    expect(html).toContain("Add Document");
    expect(html).not.toContain('data-testid="fill-summary"');
  });

  it("makes the drop area a row once a document is in, with what Steri-AI filled in beside the files where there is room", () => {
    const html = panel([{ key: "a", file: order, url: "blob:a", state: { step: "reading" } }], [{ label: "Client", value: "Test Client" }]);
    expect(html).toContain('data-slot="read-drop"');
    expect(html).not.toContain("data-roomy");
    expect(html).toContain("More Documents");
    expect(html).toContain('data-testid="fill-summary"');
    expect(html).toContain("@3xl:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]");
  });

  it("takes Excel and CSV files on Files, each shown with a spreadsheet's icon (Kenneth, 26 October 2026)", () => {
    const sheet = new File(["Size,Cases\nM,20\n"], "Order.csv", { type: "text/csv" });
    const html = panel([
      { key: "a", file: order, url: "blob:a", state: { step: "later" } },
      { key: "b", file: sheet, url: "blob:b", state: { step: "waiting" } },
    ]);
    expect(html).toContain(`accept="${FILE_ACCEPT}"`);
    const rows = html.split('data-slot="file-row"').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("lucide-file-text");
    expect(rows[1]).toContain("lucide-file-spreadsheet");
  });

  // A role without Steri-AI Reading (migration 20261027150000): the files only upload.
  it("promises no Steri-AI to a role without Steri-AI Reading: no reading marks, no Read Again", () => {
    const html = panel(
      [
        { key: "a", file: order, url: "blob:a", state: { step: "waiting" } },
        { key: "b", file: order, url: "blob:b", state: { step: "later" } },
      ],
      [],
      false,
    );
    expect(html).toContain("Drop them here.");
    expect(html).not.toContain("Steri-AI");
    expect(html).not.toContain("Read after Create");
    expect(html).not.toContain("Read Again");
    expect(panel([], [], false)).toContain("They upload with the inspection on Create.");
  });

  // Kenneth, 27 October 2026: "the Steri AI should be able to read doc to use existing client and manufacturer or create new one".
  it("puts New Client and New Manufacturer in the summary, after what it filled in, before what goes in on Create", () => {
    const html = panel(
      [{ key: "a", file: order, url: "blob:a", state: { step: "reading" } }],
      [{ label: "Product Type", value: "Examination Gloves" }],
      true,
      <p data-testid="entries">New Client</p>,
    );
    const summary = html.slice(html.indexOf('data-testid="fill-summary"'));
    expect(summary.indexOf("Filled In")).toBeLessThan(summary.indexOf('data-testid="entries"'));
    // The old warning line is gone: the entry offers to add the company instead.
    expect(html).not.toContain("is not in the client list");
    // The entries alone open the summary too.
    expect(panel([{ key: "a", file: order, url: "blob:a", state: { step: "reading" } }], [], true, <p>New Client</p>)).toContain(
      'data-testid="fill-summary"',
    );
  });

  it("notes under a line why it is filled, and lets focus come to it after an Add", () => {
    const html = panel(
      [{ key: "a", file: order, url: "blob:a", state: { step: "reading" } }],
      [{ label: "Client", value: "Test Buyer Sdn. Bhd.", note: "Added to the clients.", id: "s-filled-client" }],
    );
    expect(html).toMatch(/<li id="s-filled-client" tabindex="-1" class="[^"]*focus-ring-inset[^"]*">/);
    expect(html).toContain('<span class="text-foreground">Test Buyer Sdn. Bhd.</span><span class="block text-muted-foreground">Added to the clients.</span>');
  });
});

describe("New Client", () => {
  const entry = (printed: string, clients = [{ id: "c1", label: "Test Buyer" }]) =>
    renderToStaticMarkup(<NewClientEntry printed={printed} clients={clients} disabled={false} onAdded={noop} />);

  it("shows the client read as new, its name filled in and editable, with Add Client", () => {
    const html = entry("New Buyer Sdn. Bhd.");
    expect(html).toContain('data-testid="new-client"');
    expect(html).toMatch(/<h3 id="[^"]+" class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">New Client<\/h3>/);
    expect(html).toContain("“New Buyer Sdn. Bhd.” is not in the client list.");
    expect(html).toContain(">Name</label>");
    expect(html).toContain('value="New Buyer Sdn. Bhd."');
    expect(html).toContain('maxLength="120"');
    expect(html).toContain("Add Client");
    expect(html).toContain('type="button"');
    // Inside the form, but never posted with Create.
    expect(html).not.toMatch(/<input[^>]* name=/);
  });

  it("says before Add when the name reads like a listed client", () => {
    expect(entry("TEST BUYER SDN BHD")).toContain("Already in the list as Test Buyer: Add Client chooses it.");
    expect(
      entry("Twin Buyer", [
        { id: "c1", label: "Twin Buyer Sdn. Bhd." },
        { id: "c2", label: "Twin Buyer Pte. Ltd." },
      ]),
    ).toContain("More than one client in the list reads like this one.");
  });
});

describe("New Manufacturer", () => {
  const directory = directoryFromRows([
    {
      id: "b1",
      name: "Brand A",
      companies: [
        {
          id: "c1",
          name: "Company A Sdn. Bhd.",
          factories: [
            { id: "f1", factory_name: "F-1", country: "Malaysia" },
            { id: "f2", factory_name: "F-2", country: "Malaysia" },
          ],
        },
      ],
    },
  ]);
  const entry = (details: Parameters<typeof manufacturerDraft>[0], printed = "Company A Sdn. Bhd.") =>
    renderToStaticMarkup(
      <NewManufacturerEntry printed={printed} draft={manufacturerDraft(details, printed)} directory={directory} disabled={false} onAdded={noop} />,
    );

  it("shows what the document prints, editable, and says what Add adds: here only the factory, under the listed company", () => {
    const html = entry({ brand: null, company: "Company A Sdn. Bhd.", factory: "F-40", address: "Lot 1, Placeholder Park", country: "Malaysia" });
    expect(html).toContain('data-testid="new-manufacturer"');
    expect(html).toContain(">New Manufacturer</h3>");
    expect(html).toContain("“Company A Sdn. Bhd.” is not in the manufacturer list.");
    for (const label of ["Brand", "Company", "Factory (Optional)", "Country", "Address"]) expect(html, label).toContain(`>${label}</label>`);
    // The brand from the company's short name, when the document prints none.
    expect(html).toContain('value="Company A"');
    expect(html).toContain('value="F-40"');
    expect(html).toContain(">Lot 1, Placeholder Park</textarea>");
    expect(html).toContain("Choose a listed brand, or type a new one.");
    // The brands listed are suggested; a typed one that reads like one of them is that one.
    expect(html).toMatch(/<datalist id="[^"]+-brands"><option value="Brand A"><\/option><\/datalist>/);
    expect(html).toContain("Adds the factory F-40 to Company A Sdn. Bhd. (Brand A).");
    expect(html).toContain("Add Manufacturer");
    // Two to a row once the summary is wide enough (a size container), the company with the most room; one a row when narrow.
    expect(html).toContain("@container");
    expect(html).toContain("@xl:grid-cols-6");
    expect(html).toMatch(/class="[^"]*@xl:col-span-4"><label[^>]*>Company<\/label>/);
    expect(html).not.toMatch(/<(input|textarea)[^>]* name=/);
  });

  it("says under the factory what stops Add when the company has several and none is named", () => {
    const html = entry({ brand: "Brand A", company: "Company A Sdn. Bhd.", factory: null, address: null, country: null });
    expect(html).toMatch(/<p data-slot="field-description" class="[^"]*text-warn[^"]*" id="[^"]+-factory-hint">Company A Sdn\. Bhd\. has 2 factories in the list\./);
    expect(html).not.toContain('data-testid="new-manufacturer-plan"');
  });
});
