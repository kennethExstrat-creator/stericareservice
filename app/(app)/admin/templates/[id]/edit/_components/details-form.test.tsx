// The Details tab's AI second opinion switch (BUILD_SPEC 9.2), server-rendered:
// what it shows for a template of its own and for one that inherits the
// setting, the Changed mark and reset, and a problem on the setting.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TemplateDefinition } from "@/lib/schemas/template";
import { lookupFrom } from "@/lib/templates";
import { MODULE_REGISTRY } from "@/modules";
import { isDetailPath } from "../_lib/details";
import { inheritanceOf } from "../_lib/inheritance";
import type { Draft, EditorContext } from "../_lib/model";
import type { EditorProblem } from "../_lib/problems";
import { AI_ON_SUBMIT_ID, DetailsForm } from "./details-form";
import type { EditorApi } from "./editor-api";

function definition(code: string, extra: Partial<TemplateDefinition> = {}): TemplateDefinition {
  return {
    code,
    name: `${code} gloves`,
    scope: { productType: "examination", standard: "EN455" },
    unit: "pcs",
    sizes: [{ value: "M" }],
    modules: [],
    ...extra,
  };
}

function render(draft: Draft, { bases = [], problems = [] }: { bases?: TemplateDefinition[]; problems?: EditorProblem[] } = {}) {
  const getBase = lookupFrom(bases.map((base) => ({ definition: base, version: 2 })));
  const inheritance = inheritanceOf(draft, getBase);
  const context: EditorContext = { inheritance, registry: MODULE_REGISTRY };
  const api: EditorApi = {
    draft,
    context,
    problems,
    editable: true,
    update: () => {},
    reportDraftError: () => {},
    draftFor: () => undefined,
    sizes: [{ value: "M", label: "M" }],
    defectCodes: [],
    scopeOptions: { clients: [], manufacturers: [] },
    resetLabel: inheritance.bases[0] ? `Use ${inheritance.bases[0].code}'s` : "Use Default",
  };
  const html = renderToStaticMarkup(<DetailsForm api={api} />);
  const section = html.slice(html.indexOf('data-testid="template-ai"'), html.indexOf('data-testid="template-scope"'));
  const control = section.match(new RegExp(`<button[^>]*id="${AI_ON_SUBMIT_ID}"[^>]*>`))?.[0] ?? "";
  return { section, control };
}

describe("DetailsForm: AI second opinion on submit", () => {
  it("is off for a template of its own that leaves it out, and says so", () => {
    const { section, control } = render(definition("OWN_EG"));
    expect(control).toContain('role="switch"');
    expect(control).toContain('aria-checked="false"');
    expect(section).toContain("AI Second Opinion on Submit");
    expect(section).toContain("Off unless switched on here.");
    expect(section).not.toContain("Changed");
  });

  it("shows what the base has while the template leaves it out", () => {
    const base = definition("BASE_EG", { modules: [{ key: "header", include: true }], ai: { reviewOnSubmit: true } });
    const { section, control } = render(definition("CHILD_EG", { extends: "BASE_EG" }), { bases: [base] });
    expect(control).toContain('aria-checked="true"');
    expect(section).toContain("Now as BASE_EG has it: on.");
    expect(section).not.toContain("Changed");
  });

  it("marks the template's own setting, with a reset to the base's", () => {
    const base = definition("BASE_EG", { ai: { reviewOnSubmit: true } });
    const child = definition("CHILD_EG", { extends: "BASE_EG", ai: { reviewOnSubmit: false } });
    const { section, control } = render(child, { bases: [base] });
    expect(control).toContain('aria-checked="false"');
    expect(section).toContain("Changed");
    expect(section).toContain("aria-label=\"Use BASE_EG&#x27;s: AI Second Opinion on Submit\"");
    expect(section).toContain("BASE_EG has it on.");
  });

  it("puts a problem with the setting on the switch, and the problem list links to this tab", () => {
    const problems: EditorProblem[] = [
      {
        id: "template:ai.reviewOnSubmit:Choose yes or no.",
        place: { area: "template", path: ["ai", "reviewOnSubmit"] },
        message: "Choose yes or no.",
      },
    ];
    const { section, control } = render({ ...definition("OWN_EG"), ai: { reviewOnSubmit: "yes" } } as unknown as Draft, {
      problems,
    });
    expect(control).toContain('aria-invalid="true"');
    expect(control).toContain(`aria-describedby="${AI_ON_SUBMIT_ID}-hint ${AI_ON_SUBMIT_ID}-errors"`);
    expect(section).toContain("Choose yes or no.");
    expect(isDetailPath(["ai", "reviewOnSubmit"])).toBe(true);
  });
});
