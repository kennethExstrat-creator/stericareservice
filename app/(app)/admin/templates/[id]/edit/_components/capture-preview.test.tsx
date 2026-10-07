// The editor's live capture preview with the real modules (BUILD_SPEC 4.5
// step 4): each module's own Capture, drawn with nothing entered and read
// only, for every seed template and for a template that switches every
// module on. Prerendered first with react-dom/static, which waits for each
// module's code to load as the browser does: a Capture that throws while it
// draws reaches onError and fails the test. React.lazy keeps what it loaded,
// so a second, synchronous render then draws every card in place, to read.
// A failure the browser catches shows on its own card, named.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prerenderToNodeStream } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";
import { MODULE_KEYS, type ModuleKey } from "@/lib/schemas/module-result";
import type { ResolvedTemplate, TemplateDefinition } from "@/lib/schemas/template";
import { lookupFrom } from "@/lib/templates";
import { SEED_TEMPLATES } from "@/lib/templates/definitions";
import { resolveTemplate } from "@/modules";
import { MODULE_REGISTRY } from "@/modules/registry";
import { makeTestTemplate } from "@/modules/_framework/testing";
import { CaptureBoundary, CapturePreview } from "./capture-preview";

const INSPECTOR = { id: "30000000-0000-4000-8000-000000000001", name: "Inspector A" };

/** The modules that keep a lab report or certificate: their slot cannot attach here. */
const FILE_MODULES: readonly ModuleKey[] = ["force_at_break", "tensile", "documents"];

async function prerender(element: ReactNode): Promise<{ html: string; errors: unknown[] }> {
  const errors: unknown[] = [];
  const { prelude } = await prerenderToNodeStream(element, { onError: (error) => void errors.push(error) });
  const chunks: Buffer[] = [];
  for await (const chunk of prelude) chunks.push(Buffer.from(chunk));
  return { html: Buffer.concat(chunks).toString("utf8"), errors };
}

/** The seed templates as the seed writes them, each resolved against its bases and the real modules. */
function seedTemplates(): ResolvedTemplate[] {
  const versions: { definition: TemplateDefinition; version: number }[] = [];
  return SEED_TEMPLATES.map((seed) => {
    const definition = seed.definition("20000000-0000-4000-8000-000000000001");
    const resolution = resolveTemplate(definition, lookupFrom(versions));
    if (!resolution.ok) throw new Error(`${seed.code}: ${JSON.stringify(resolution.problems)}`);
    versions.push({ definition, version: 1 });
    return resolution.template;
  });
}

/** Every module on, in registry order, the conclusion last. */
function everyModule(): ResolvedTemplate {
  const middle = MODULE_KEYS.filter((key) => key !== "header" && key !== "conclusion");
  return makeTestTemplate(MODULE_REGISTRY, ["header", ...middle, "conclusion"], { code: "EVERY_EG", chain: ["EVERY_EG"] });
}

async function expectEveryCaptureDrawn(template: ResolvedTemplate) {
  const preview = <CapturePreview resolved={template} stale={false} inspector={INSPECTOR} />;
  const { errors } = await prerender(preview);
  expect(errors, `${template.code}: a Capture threw while drawing`).toEqual([]);
  const html = renderToStaticMarkup(preview);
  // Nothing waits or failed: every module's code loaded and drew.
  expect(html).not.toContain('data-slot="skeleton"');
  expect(html).not.toContain("data-preview-error");
  const included = template.modules.filter((entry) => entry.include);
  for (const entry of included) {
    const card = html.match(new RegExp(`<div data-preview-module="${entry.key}">.*?(?=<div data-preview-(?:module|custom)=|$)`, "s"))?.[0];
    expect(card, `${template.code}: ${entry.key} has no card`).toBeDefined();
    expect(card).toContain(entry.title.replace(/&/g, "&amp;"));
    if (MODULE_REGISTRY[entry.key].loadCapture) {
      expect(card, `${template.code}: ${entry.key} shows no capture screen`).not.toContain("has no capture screen yet");
      expect(card).not.toContain("settings of this module do not read");
    }
    if (FILE_MODULES.includes(entry.key)) expect(card).toContain("Attach files on the inspection screen.");
  }
  return html;
}

describe("CapturePreview with the real modules", () => {
  it("draws each seed template's modules, every one with its own Capture, read only", async () => {
    const templates = seedTemplates();
    expect(templates.map((template) => template.code)).toEqual(["STD_EG", "SAFEDON_EG", "STD_SG"]);
    for (const template of templates) {
      const html = await expectEveryCaptureDrawn(template);
      // Read only: nothing on the cards can be typed into (a switch's hidden form input is no field).
      const cards = html.slice(html.indexOf("data-preview-module="));
      const editable = [...cards.matchAll(/<(?:input|textarea)\b[^>]*>/g)]
        .map((match) => match[0])
        .filter((tag) => !/\b(readonly|disabled)\b|type="(hidden|file)"|aria-hidden="true"/i.test(tag));
      expect(editable, `${template.code}: fields that can be typed into`).toEqual([]);
    }
  }, 60_000);

  it("draws every module of the registry when a template switches them all on", async () => {
    const template = everyModule();
    expect(template.modules.map((entry) => entry.key).sort()).toEqual([...MODULE_KEYS].sort());
    await expectEveryCaptureDrawn(template);
  }, 60_000);
});

describe("CaptureBoundary", () => {
  it("names the module whose capture screen failed, by its heading and its key", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const boundary = new CaptureBoundary({ title: "Weight (g)", moduleKey: "weight", children: <p>drawn</p> });
    expect(renderToStaticMarkup(<>{boundary.render()}</>)).toBe("<p>drawn</p>");

    const error = new Error("Cannot read properties of undefined (reading 'M')");
    boundary.state = CaptureBoundary.getDerivedStateFromError(error);
    boundary.componentDidCatch(error);
    const html = renderToStaticMarkup(<>{boundary.render()}</>);
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-preview-error="weight"');
    expect(html).toContain("The capture screen of Weight (g) (weight) failed to draw.");
    expect(html).toContain("Cannot read properties of undefined (reading &#x27;M&#x27;)");
    expect(html).toContain("The other modules still show.");
    expect(console.error).toHaveBeenCalledWith("[template editor] the capture preview of weight failed", error);
    vi.restoreAllMocks();
  });
});
