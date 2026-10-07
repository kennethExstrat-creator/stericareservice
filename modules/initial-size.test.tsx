// Every per-size Capture opens on the size the screen has in focus
// (CaptureProps.focus, initialSize), so the size chosen in one module stays
// chosen in the next, and reports the size it shows as it mounts, so a photo
// taken straight away is tagged with it (docs/MODULES.md sections 10 and
// 10.1, BUILD_SPEC 8.1).
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { MODULE_KEYS } from "@/lib/schemas/module-result";
import { evaluateInspection, type AnyModuleDefinition, type CaptureFocus } from "@/modules/_framework";
import { makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { MODULE_REGISTRY } from "@/modules/registry";

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
  // Each Capture's code (with the kit) is loaded once, here, with time to spare: the first
  // import inside a case could take longer than a case may while the whole suite runs.
  beforeAll(async () => {
    await Promise.all(PER_SIZE.map((key) => MODULE_REGISTRY[key].loadCapture?.()));
  }, 60_000);

  it("covers every per-size module with a Capture", () => {
    expect(PER_SIZE.length).toBeGreaterThan(8);
  });

  it.each(PER_SIZE)("%s", async (key) => {
    const definition = MODULE_REGISTRY[key];
    expect(await selectedTab(definition, { size: "L" })).toBe("L");
    // A size that is not ordered, or no focus: the first ordered size.
    expect(await selectedTab(definition, { size: "XL" })).toBe("S");
    expect(await selectedTab(definition, null)).toBe("S");
  });
});

/**
 * The shared report (modules/_framework/shown-size.ts) runs in a layout
 * effect, which a server render never runs: the e2e specs see it work. Here,
 * that every per-size Capture uses it, so none waits for a tap to tag photos.
 */
describe("per-size captures report the size they show for photo tags", () => {
  it.each(PER_SIZE)("%s", (key) => {
    const source = readFileSync(new URL(`./${key}/Capture.tsx`, import.meta.url), "utf8");
    expect(source).toContain('from "@/modules/_framework/shown-size"');
    expect(source).toMatch(/useReportShownSize\(|<ShownSizeReport\b/);
  });
});
