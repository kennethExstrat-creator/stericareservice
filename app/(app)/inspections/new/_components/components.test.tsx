// The form's panels as the server renders them, in the states the live
// database cannot show on demand: a draft or unreadable template, ties, an
// admin's choice, a long list of earlier products, a copy into a template
// that lacks some of the copied sections, and an earlier inspection with
// nothing to copy. The page and its flows run end to end in e2e/new.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { chooseTemplate, type PreviousProduct, type TemplateChoice } from "@/lib/inspections/create";
import { buildSeedBundle, SEED_TEMPLATES } from "@/lib/templates/definitions";
import { MODULE_REGISTRY } from "@/modules/registry";
import { toTemplateOption } from "../_lib/options";
import { PREVIOUS_SHOWN, type TemplateOption } from "../_lib/types";
import { ChoiceCard } from "./choice-card";
import { PreviousPicker } from "./previous-picker";
import { TemplatePanel, type PickState } from "./template-panel";
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

/** An earlier inspection that holds every copied field. */
const COPIES: PreviousProduct["copies"] = {
  header: ["factoryAddress", "productName", "productCode", "factoryGloveCode"],
  glove_info: ["surfaceTexture", "indicativeWeight", "colour", "length"],
  packing_config: ["glovesPerInner", "innersPerCase", "glovesPerCase", "packingMode"],
};

function product(index: number, extra: Partial<PreviousProduct> = {}): PreviousProduct {
  return {
    inspectionId: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    refNo: `INS-2026-${String(index).padStart(4, "0")}`,
    inspectionDate: "2026-09-01",
    status: "submitted",
    clientId: CLIENT,
    manufacturerId: MANUFACTURER,
    productType: "examination",
    productName: `Nitrile ${index}`,
    templateCode: "STD_EG",
    templateVersion: 1,
    copies: COPIES,
    ...extra,
  };
}

function picker(props: Partial<Parameters<typeof PreviousPicker>[0]> = {}) {
  return renderToStaticMarkup(
    <PreviousPicker id="p" role="inspector" ready products={[]} value="blank" onValueChange={noop} template={null} {...props} />,
  );
}

describe("start from previous", () => {
  it("waits for the three choices", () => {
    expect(picker({ ready: false })).toContain("Choose the client, manufacturer and product type first.");
  });

  it("says when there is nothing to start from, an inspector's own inspections only", () => {
    expect(picker()).toContain("No earlier inspections of yours for this client, manufacturer and product type.");
    expect(picker({ role: "admin" })).toContain("No earlier inspections for this client, manufacturer and product type.");
  });

  it("offers the latest inspection of each product, the most recent first, and says when it stops", () => {
    const products = Array.from({ length: PREVIOUS_SHOWN + 2 }, (_, index) => product(index + 1));
    const html = picker({ products });
    expect(html).toContain("Start Blank");
    expect(html).toContain("Nitrile 1");
    expect(html).toContain(`Nitrile ${PREVIOUS_SHOWN}`);
    expect(html).not.toContain(`Nitrile ${PREVIOUS_SHOWN + 1}`);
    expect(html).toContain(`The ${PREVIOUS_SHOWN} most recent products are listed.`);
    expect(html).toContain("INS-2026-0001");
    expect(html).toContain("1 Sept 2026");
    expect(html).toContain('data-status="submitted"');
  });

  it("marks a product without a name", () => {
    const html = picker({ products: [product(1, { productName: null })] });
    expect(html).toContain("Product Name Not Entered");
  });

  it("lists what the chosen inspection copies into this template, and what never", () => {
    const chosen = product(7, { templateVersion: 1 });
    const html = picker({ products: [chosen], value: chosen.inspectionId, template: option("STD_EG") });
    expect(html).toContain("Copied From INS-2026-0007");
    expect(html).toContain("Manufacturer Information: factory address, product name, product code and factory glove code");
    expect(html).toContain("Glove Information: every field");
    expect(html).toContain("Packing configuration: every field");
    expect(html).toContain("Never copied: PO number, dates, lots, sampling, test results, comments and photos.");
    expect(html).toContain("Same template as last time (STD_EG version 1): its specs and AQL carry over.");
  });

  it("names only the sections the new template has, in its wording", () => {
    const chosen = product(8, { productType: "surgical", templateCode: "STD_SG", templateVersion: 1 });
    const html = picker({ products: [chosen], value: chosen.inspectionId, template: option("STD_SG", { version: 2 }) });
    // STD_SG has no glove information, factory address or factory glove code; its header is worded from the SG form.
    expect(html).not.toContain("Glove Information");
    expect(html).toContain("Purchase Order / Shipment Information: product name and product code<");
    expect(html).toContain("Last time used version 1. This inspection uses version 2, with its specs and AQL.");
  });

  it("lists only the sections the earlier inspection has something in", () => {
    const chosen = product(9, { copies: { header: ["productName"] } });
    const html = picker({ products: [chosen], value: chosen.inspectionId, template: option("SAFEDON_EG") });
    expect(html).toContain("Copied From INS-2026-0009");
    expect(html).toContain("Manufacturer Information: product name<");
    expect(html).not.toContain("Glove Information");
    expect(html).not.toContain("Packing configuration");
  });

  it("says when an earlier inspection has nothing to copy", () => {
    const chosen = product(10, { copies: {}, productName: null });
    const html = picker({ products: [chosen], value: chosen.inspectionId, template: option("STD_EG") });
    expect(html).toContain("Nothing to Copy From INS-2026-0010");
    expect(html).toContain("It holds no product details this template uses, so nothing is copied.");
    expect(html).not.toContain("Copied From");
    expect(html).not.toContain("Never copied");
    // Specs and AQL still come with the template.
    expect(html).toContain("Same template as last time (STD_EG version 1): its specs and AQL carry over.");
    // A factory glove code alone is nothing to copy into a template without one.
    const glove = product(11, { copies: { header: ["factoryGloveCode"] } });
    expect(picker({ products: [glove], value: glove.inspectionId, template: option("SAFEDON_EG") })).toContain(
      "Nothing to Copy From INS-2026-0011",
    );
    // Before a template is chosen: what it holds.
    expect(picker({ products: [glove], value: glove.inspectionId })).toContain(
      "Manufacturer Information: factory glove code<",
    );
  });

  it("shows an error under the list", () => {
    const html = picker({ products: [product(1)], error: "That earlier inspection is not available." });
    expect(html).toContain('id="p-previous-error"');
    expect(html).toContain('aria-invalid="true"');
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
