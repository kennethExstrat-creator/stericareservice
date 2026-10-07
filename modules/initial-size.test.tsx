// Every per-size Capture opens on the size the screen has in focus
// (CaptureProps.focus, initialSize), so the size chosen in one module stays
// chosen in the next (docs/MODULES.md section 10). watertight and visual are
// left to the capture screen's package, which owns their Capture.tsx.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MODULE_KEYS, type ModuleKey } from "@/lib/schemas/module-result";
import { evaluateInspection, type AnyModuleDefinition, type CaptureFocus } from "@/modules/_framework";
import { makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { MODULE_REGISTRY } from "@/modules/registry";

const NOT_YET: readonly ModuleKey[] = ["watertight", "visual"];
const PER_SIZE = MODULE_KEYS.filter((key) => MODULE_REGISTRY[key].perSize && MODULE_REGISTRY[key].loadCapture);
const CONTEXT = makeTestContext({ sizes: ["S", "M", "L"] });

async function selectedTab(definition: AnyModuleDefinition, focus: CaptureFocus | null): Promise<string | undefined> {
  const loaded = await definition.loadCapture?.();
  if (!loaded) throw new Error(`${definition.key} has no Capture`);
  const Capture = loaded.default;
  const template = makeTestTemplate(MODULE_REGISTRY, [definition.key]);
  const data = definition.emptyData();
  const evaluation =
    evaluateInspection({ template, data: { modules: {}, custom: {} }, context: CONTEXT }, MODULE_REGISTRY).modules.find(
      (entry) => entry.key === definition.key,
    ) ?? null;
  const html = renderToStaticMarkup(
    <Capture
      data={data}
      config={definition.defaultConfig}
      title={definition.title}
      labels={definition.labels}
      context={CONTEXT}
      evaluation={evaluation}
      focusPath={null}
      readOnly={false}
      focus={focus}
      onChange={() => {}}
    />,
  );
  const tab = Array.from(html.matchAll(/<[^>]*role="tab"[^>]*>/g), (match) => match[0]).find((tag) =>
    tag.includes('aria-selected="true"'),
  );
  return /data-size="([^"]+)"/.exec(tab ?? "")?.[1];
}

describe("per-size captures open on the size in focus", () => {
  it("covers every per-size module with a Capture", () => {
    expect(PER_SIZE.length).toBeGreaterThan(8);
  });

  it.each(PER_SIZE.filter((key) => !NOT_YET.includes(key)))("%s", async (key) => {
    const definition = MODULE_REGISTRY[key];
    expect(await selectedTab(definition, { size: "L" })).toBe("L");
    // A size that is not ordered, or no focus: the first ordered size.
    expect(await selectedTab(definition, { size: "XL" })).toBe("S");
    expect(await selectedTab(definition, null)).toBe("S");
  });
});
