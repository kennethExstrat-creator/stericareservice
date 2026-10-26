// The form's panels as the server renders them, in the states the live
// database cannot show on demand: a draft or unreadable template, ties, an
// admin's choice, and Source Documents before and after the first document.
// The page and its flows run end to end in e2e/new.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { chooseTemplate, type TemplateChoice } from "@/lib/inspections/create";
import { buildSeedBundle, SEED_TEMPLATES } from "@/lib/templates/definitions";
import { MODULE_REGISTRY } from "@/modules/registry";
import { toTemplateOption } from "../_lib/options";
import type { TemplateOption } from "../_lib/types";
import type { HeldDocument } from "../_lib/sources";
import { ChoiceCard } from "./choice-card";
import { SourceDocumentsPanel } from "./source-documents-panel";
import { TemplatePanel, type PickState } from "./template-panel";
import type { HeldSources } from "./use-held-sources";
import { RadioGroup } from "@/components/ui/radio-group";

const CLIENT = "20000000-0000-4000-8000-000000000001";
const MANUFACTURER = "10000000-0000-4000-8000-000000000001";
const noop = () => {};

const bundle = new Map(buildSeedBundle(SEED_TEMPLATES, MODULE_REGISTRY).templates.map((entry) => [entry.code, entry]));
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
    { productType, clientId: CLIENT, manufacturerId: MANUFACTURER, templateId: props.overrideId || undefined },
    role,
  );
  const chosen = choice.ok ? (props.templates.find((template) => template.id === choice.template.id) ?? null) : null;
  return renderToStaticMarkup(
    <TemplatePanel
      id="t"
      role={role}
      picks={props.picks ?? ALL_PICKED}
      productType={productType}
      names={{ client: "Polyco Healthline", manufacturer: "Hartalega NGC" }}
      choice={choice}
      chosen={chosen}
      overrides={props.templates}
      overrideId={props.overrideId ?? ""}
      onOverrideChange={noop}
    />,
  );
}

describe("the template panel", () => {
  it("waits for the three choices, saying which are made", () => {
    const html = panel({
      templates: [option("STD_EG")],
      picks: [
        { label: "Client", done: true },
        { label: "Manufacturer", done: false },
        { label: "Product Type", done: false },
      ],
    });
    expect(html).toContain("The template follows from the client, manufacturer and product type.");
    expect(html).toContain("Client<span class=\"sr-only\">: chosen</span>");
    expect(html).toContain("Manufacturer<span class=\"sr-only\">: not chosen yet</span>");
    expect(html).not.toContain('data-testid="chosen-template"');
    // Nothing to announce yet.
    expect(html).toContain('<p role="status" class="sr-only"></p>');
  });

  it("names the template the rule picks, why, its sizes and its sections", () => {
    const html = panel({ templates: [option("STD_EG"), option("SAFEDON_EG", { client_id: CLIENT })] });
    expect(html).toContain('data-code="SAFEDON_EG"');
    expect(html).toContain("Safedon examination gloves (ASTM D6319)");
    // A label names the version in Title Case; the announcement is a sentence.
    expect(html).toContain("SAFEDON_EG Version 1 · ASTM D6319");
    expect(html).toContain("For Polyco Healthline");
    expect(html).toContain("XS, S, M, L, XL");
    expect(html).toContain("(pieces)");
    expect(html).toContain("Show the Sections");
    expect(html).toContain("Template: Safedon examination gloves (ASTM D6319), SAFEDON_EG version 1.");
    expect(html).not.toContain("Use Another Template");
  });

  it("says when no active template fits, and tells an admin what to do", () => {
    const inspector = panel({ templates: [option("STD_EG")], productType: "surgical" });
    expect(inspector).toContain('data-testid="no-template"');
    expect(inspector).toContain("No active template for surgical gloves fits these choices. An admin needs to activate one.");
    expect(inspector).not.toContain("Choose a template below");
    const admin = panel({ role: "admin", templates: [option("STD_EG")], productType: "surgical" });
    expect(admin).toContain("Choose a template below, or activate one first.");
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

  function panel(documents: HeldDocument[], filled: { label: string; value: string }[] = []) {
    const sources: HeldSources = {
      documents,
      media: [],
      preparing: 0,
      canRead: true,
      fill: null,
      addDocuments: noop,
      addMedia: noop,
      removeDocument: noop,
      removeMedia: noop,
      readAgain: noop,
      handOver: async () => {},
    };
    return renderToStaticMarkup(<SourceDocumentsPanel id="s" sources={sources} disabled={false} filled={filled} unlisted={[]} />);
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
});
