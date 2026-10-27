// Sampling Settings (Kenneth, 27 October 2026), drawn on the server with its
// dialogs in place (a portal draws nothing on the server; the mock keeps
// each part's classes): the general and the special level for the
// inspection, where each comes from, Use Default, what each is for, the
// rounding of Auto Calculate Sampling, read-only, and ISO 2859-1 Tables 1
// and 2-A over it. Taps are the browser's, checked by the integrator; what
// Save hands the data updater is withSamplingSettings, run here as the
// Capture runs it.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/dialog", () => {
  const Part = ({ children, className }: { children?: ReactNode; className?: string }) => <div className={className}>{children}</div>;
  return {
    Dialog: Part,
    DialogClose: Part,
    DialogContent: Part,
    DialogDescription: Part,
    DialogFooter: Part,
    DialogHeader: Part,
    DialogTitle: Part,
    DialogTrigger: Part,
  };
});

import { createDataUpdater } from "@/components/qc/data-updater";
import { TABLE_1, TABLE_2A_AQLS } from "@/lib/aql";
import { buildInspectionContext, evaluateInspection, type AqlDefaults } from "@/modules/_framework";
import { makeTestTemplate, TEST_INSPECTOR } from "@/modules/_framework/testing";
import { SAFEDON_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { ENGINE_REGISTRY, exampleData, samplingPlanData } from "./__fixtures__/examples";
import type { SamplingPlanComputed } from "./calc";
import Capture from "./Capture";
import { SAMPLING_PLAN_DEFAULT_CONFIG, SAMPLING_PLAN_LABELS, type SamplingPlanConfig } from "./config";
import { withSamplingSettings, type SamplingPlanData } from "./schema";

const LEVEL_I: SamplingPlanConfig = { ...SAMPLING_PLAN_DEFAULT_CONFIG, inspectionLevel: "I" };

type Setup = {
  config?: SamplingPlanConfig;
  /** Saved beside SAFEDON_EG's counts. */
  settings?: Partial<Pick<SamplingPlanData, "inspectionLevel" | "specialInspectionLevel" | "roundCasesTo">>;
  aqlDefaults?: Partial<AqlDefaults>;
  /** Watertight and visual in the template, so their AQLs are in use. */
  checks?: boolean;
  readOnly?: boolean;
};

/** SAFEDON_EG's sampling plan (XS and L 120,000 gloves, S and M over 500,000), as the capture screen draws it. */
function render({ config = LEVEL_I, settings = {}, aqlDefaults, checks = false, readOnly = false }: Setup = {}): string {
  const extra: Parameters<typeof makeTestTemplate>[1] = checks ? ["watertight", "visual"] : [];
  const template = makeTestTemplate(ENGINE_REGISTRY, ["order_lots", "packing_config", { key: "sampling_plan", config }, ...extra]);
  const data = exampleData(SAFEDON_EG_EXAMPLE, { sampling_plan: { ...samplingPlanData(SAFEDON_EG_EXAMPLE), ...settings } });
  const context = buildInspectionContext({ template, data, meta: { inspector: TEST_INSPECTOR }, aqlDefaults }, ENGINE_REGISTRY);
  const found = evaluateInspection({ template, data, context }, ENGINE_REGISTRY).modules.find((entry) => entry.key === "sampling_plan");
  if (!found) throw new Error("sampling_plan was not evaluated");
  return renderToStaticMarkup(
    <Capture
      data={data.modules.sampling_plan as SamplingPlanData}
      config={config}
      title="Sampling Plan"
      labels={SAMPLING_PLAN_LABELS}
      context={context}
      evaluation={{ ...found, computed: found.computed as SamplingPlanComputed }}
      focusPath={null}
      readOnly={readOnly}
      onChange={() => {}}
    />,
  );
}

const GENERAL = 'aria-labelledby="[^"]*-level"';
const SPECIAL = 'aria-labelledby="[^"]*-special"';

/** The toggle group whose opening tag matches `name`, with its buttons. */
function group(html: string, name: string): string {
  return new RegExp(`<div[^>]*role="radiogroup"[^>]*${name}[^>]*>[\\s\\S]*?</div>`).exec(html)?.[0] ?? "";
}

/** Each choice of the group, with whether it is on. */
function choices(html: string, name: string): [string, boolean][] {
  return Array.from(group(html, name).matchAll(/<button[^>]*aria-checked="(true|false)"[^>]*>([^<]*)<\/button>/g), (match) => [
    match[2],
    match[1] === "true",
  ]);
}

const textOf = (html: string, slot: string) => new RegExp(`data-slot="${slot}"[^>]*>([^<]*)<`).exec(html)?.[1];

/** One table, by its data-slot. */
function table(html: string, slot: string): string {
  const start = html.indexOf(`<table data-slot="${slot}"`);
  return start === -1 ? "" : html.slice(start, html.indexOf("</table>", start));
}

/** The opening tag of the element that carries `attribute`. */
const tagWith = (html: string, attribute: string) => new RegExp(`<[^>]*${attribute}[^>]*>`).exec(html)?.[0] ?? "";

describe("sampling_plan Sampling Settings (Kenneth, 27 October 2026)", () => {
  it("offers I, II and III under General Inspection Level and S-1 to S-4 under Special Inspection Level, each level in force on", () => {
    const html = render();
    expect(html).toContain(">Sampling Settings</div>");
    expect(html).toMatch(/<h3 id="[^"]*-level"[^>]*>General Inspection Level<\/h3>/);
    expect(choices(html, GENERAL)).toEqual([
      ["I", true],
      ["II", false],
      ["III", false],
    ]);
    // Kenneth: "for dimension and FAB, use Special Inspection Level S2": S-2 unless the template or the inspection sets one.
    expect(html).toMatch(/<h3 id="[^"]*-special"[^>]*>Special Inspection Level<\/h3>/);
    expect(choices(html, SPECIAL)).toEqual([
      ["S-1", false],
      ["S-2", true],
      ["S-3", false],
      ["S-4", false],
    ]);
    // The general level first, each under its own heading; 44 px on any touchscreen.
    expect(html.indexOf("General Inspection Level</h3>")).toBeLessThan(html.indexOf("Special Inspection Level</h3>"));
    for (const name of [GENERAL, SPECIAL]) {
      for (const button of group(html, name).match(/<button[^>]*>/g) ?? []) expect(button).toContain("touch:h-11");
    }
  });

  it("says where the general level comes from: the template's, the client's, I by default, or the inspection's own with Use Default", () => {
    const fromTemplate = render();
    expect(textOf(fromTemplate, "level-source")).toBe("Template default: I.");
    expect(fromTemplate).not.toContain("Use Default");

    const fromClient = render({ config: SAMPLING_PLAN_DEFAULT_CONFIG, aqlDefaults: { inspectionLevel: "II" } });
    expect(textOf(fromClient, "level-source")).toBe("Client default: II.");
    expect(choices(fromClient, GENERAL)).toEqual([
      ["I", false],
      ["II", true],
      ["III", false],
    ]);

    // Neither the template nor the client sets one (STD_SG): I (Kenneth, 27 October 2026).
    const none = render({ config: SAMPLING_PLAN_DEFAULT_CONFIG });
    expect(textOf(none, "level-source")).toBe("Default: I.");
    expect(choices(none, GENERAL)[0]).toEqual(["I", true]);

    const own = render({ settings: { inspectionLevel: "III" } });
    expect(textOf(own, "level-source")).toBe("Set for this inspection. Template default: I.");
    expect(choices(own, GENERAL)).toEqual([
      ["I", false],
      ["II", false],
      ["III", true],
    ]);
    // Use Default for the general level alone, named by its heading.
    expect(own.match(/>Use Default<\/button>/g)).toHaveLength(1);
    expect(own).toMatch(/<button[^>]*type="button"[^>]*aria-describedby="[^"]*-level"[^>]*>Use Default<\/button>/);
  });

  it("says where the special level comes from: the template's, S-2 by default, or the inspection's own with its Use Default", () => {
    expect(textOf(render(), "special-level-source")).toBe("Default: S-2.");
    const fromTemplate = render({ config: { ...LEVEL_I, specialInspectionLevel: "S-3" } });
    expect(textOf(fromTemplate, "special-level-source")).toBe("Template default: S-3.");
    expect(choices(fromTemplate, SPECIAL).find(([, on]) => on)).toEqual(["S-3", true]);
    expect(fromTemplate).not.toContain("Use Default");

    const own = render({ settings: { specialInspectionLevel: "S-4" } });
    expect(textOf(own, "special-level-source")).toBe("Set for this inspection. Default: S-2.");
    expect(choices(own, SPECIAL)).toEqual([
      ["S-1", false],
      ["S-2", false],
      ["S-3", false],
      ["S-4", true],
    ]);
    // The general level stays as it was: the template's I.
    expect(textOf(own, "level-source")).toBe("Template default: I.");
    expect(own.match(/>Use Default<\/button>/g)).toHaveLength(1);
    expect(own).toMatch(/<button[^>]*type="button"[^>]*aria-describedby="[^"]*-special"[^>]*>Use Default<\/button>/);
  });

  it("reads a special level saved as the one level, before the special level had its own, as no general level: the default is on", () => {
    const html = render({ settings: { inspectionLevel: "S-3" } });
    expect(textOf(html, "level-source")).toBe("Template default: I.");
    expect(choices(html, GENERAL)[0]).toEqual(["I", true]);
    expect(textOf(html, "special-level-source")).toBe("Default: S-2.");
    expect(html).not.toContain("Use Default");
  });

  it("says in two lines under the levels what each is for, before the tables, with or without Auto Calculate", () => {
    const html = render();
    const uses = /<div data-slot="level-uses"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    expect(Array.from(uses.matchAll(/<p>([^<]*)<\/p>/g), (match) => match[1].replaceAll("&amp;", "&"))).toEqual([
      "General: # of Gloves Sample and its code letter.",
      "Special: Dimension, FAB and Packaging & Dispensing.",
    ]);
    expect(html.indexOf('data-slot="level-uses"')).toBeGreaterThan(html.indexOf('data-slot="special-level-source"'));
    expect(html.indexOf('data-slot="level-uses"')).toBeLessThan(html.indexOf("View Code Letter Table"));
    // The one line it replaces is gone.
    expect(html).not.toContain("Auto Calculate uses this level");
    const noCases = render({ config: { ...LEVEL_I, columns: { ...LEVEL_I.columns, cases: false } } });
    expect(noCases).toContain('aria-label="Sampling Settings"');
    expect(noCases).toContain('data-slot="level-uses"');
    expect(noCases).not.toContain("Round Up Cases to the Nearest 5 or 10");
  });

  it("writes both levels and the rounding through the data updater on Save, Cancel leaving them", () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save<\/button>/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Cancel<\/button>/);
    // What Save hands the updater (the Capture's saveSettings): the counts stay as they are.
    const counts = samplingPlanData(SAFEDON_EG_EXAMPLE);
    let data: SamplingPlanData = counts;
    const changes: SamplingPlanData[] = [];
    const updater = createDataUpdater(data, (next) => {
      changes.push(next);
      data = next;
    });
    updater.update((current) => withSamplingSettings(current, { inspectionLevel: "II", specialInspectionLevel: "S-3", roundCases: true }));
    expect(data).toEqual({ ...counts, inspectionLevel: "II", specialInspectionLevel: "S-3", roundCasesTo: 5 });
    // Use Default on both, then Save: the inspection's own levels go, the rounding stays.
    updater.update((current) => withSamplingSettings(current, { inspectionLevel: null, specialInspectionLevel: null, roundCases: true }));
    expect(data).toEqual({ ...counts, roundCasesTo: 5 });
    expect(changes).toHaveLength(2);
    // The dialog opens on what was saved.
    const reopened = render({ settings: { inspectionLevel: "II", specialInspectionLevel: "S-3", roundCasesTo: 5 } });
    expect(choices(reopened, GENERAL)).toEqual([
      ["I", false],
      ["II", true],
      ["III", false],
    ]);
    expect(choices(reopened, SPECIAL).find(([, on]) => on)).toEqual(["S-3", true]);
    expect(tagWith(reopened, 'id="[^"]*-round"')).toContain('aria-checked="true"');
  });

  it("rounds Auto Calculate's cases up to the nearest 5 or 10 with one switch, from its next run (Kenneth, 27 October 2026)", () => {
    const off = render();
    expect(tagWith(off, 'id="[^"]*-round"')).toContain('aria-checked="false"');
    expect(off).toMatch(/<label[^>]*for="[^"]*-round"[^>]*>Round Up Cases to the Nearest 5 or 10<\/label>/);
    // "not either 5 or 10": no choice between them.
    expect(off).not.toContain("Nearest 5<");
    expect(off).not.toContain("Nearest 10<");
    expect(off).not.toContain('aria-label="Round Up To"');
    expect(off).toContain("e.g. 72 → 75, 78 → 80. Applies the next time Auto Calculate Sampling runs.");

    const on = render({ settings: { roundCasesTo: 5 } });
    expect(tagWith(on, 'id="[^"]*-round"')).toContain('aria-checked="true"');
    // A rounding to 10 saved before the one switch reads as on.
    expect(tagWith(render({ settings: { roundCasesTo: 10 } }), 'id="[^"]*-round"')).toContain('aria-checked="true"');
    // Auto Calculate Sampling's hint says how it rounds.
    expect(on).toContain("rounded up to the nearest 5 or 10.");
    expect(off).not.toContain("to the nearest 5 or 10.");
  });

  it("shows a read-only inspection's levels and rounding as saved, with nothing to change and only Close", () => {
    const html = render({ readOnly: true, settings: { inspectionLevel: "II", roundCasesTo: 5 } });
    expect(html).toContain('aria-label="Sampling Settings"');
    expect(html).not.toContain('role="radiogroup"');
    expect(html).not.toMatch(/id="[^"]*-round"/);
    expect(textOf(html, "level-shown")).toBe("II");
    expect(textOf(html, "level-source")).toBe("Set for this inspection. Template default: I.");
    expect(textOf(html, "special-level-shown")).toBe("S-2");
    expect(textOf(html, "special-level-source")).toBe("Default: S-2.");
    expect(textOf(render({ readOnly: true, settings: { specialInspectionLevel: "S-1" } }), "special-level-shown")).toBe("S-1");
    expect(textOf(html, "rounding-shown")).toBe("On");
    expect(html).not.toMatch(/>Save<\/button>/);
    expect(html).not.toContain("Use Default");
    expect(html).toMatch(/<button[^>]*>Close<\/button>/);
    // The tables are there to read.
    expect(html).toContain("View Code Letter Table");
    expect(html).toContain("View Table II-A");
    expect(textOf(render({ readOnly: true }), "rounding-shown")).toBe("Off");
  });

  it("keeps its header and buttons in place and scrolls the settings in between on a short screen", () => {
    const html = render();
    const dialog = tagWith(html, 'class="[^"]*sm:max-w-lg');
    expect(dialog).toContain("max-h-[calc(100dvh-2rem)]");
    expect(dialog).toContain("flex-col");
    expect(html).toMatch(/<div class="relative flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">/);
  });
});

describe("sampling_plan Sampling Settings' Code Letter Table (ISO 2859-1 Table 1)", () => {
  it("draws Table 1 from lib/aql, every row and level", () => {
    const html = table(render(), "code-letter-table");
    const rows = Array.from(html.matchAll(/<tr(?: data-[a-z-]+="[^"]*")*(?: class="[^"]*")?><th scope="row"[^>]*>([^<]*)<\/th>([\s\S]*?)<\/tr>/g));
    expect(rows).toHaveLength(TABLE_1.length);
    rows.forEach((row, index) => {
      expect(Array.from(row[2].matchAll(/<td[^>]*>([A-R])<\/td>/g), (match) => match[1])).toEqual(TABLE_1[index].slice(2));
    });
    expect(rows.map((row) => row[1]).slice(0, 2)).toEqual(["2 to 8", "9 to 15"]);
    expect(rows.at(-1)?.[1]).toBe("500,001 and over");
  });

  /** The levels whose column a cell or header of the table marks in use, as `data-chosen` says. */
  const inUse = (html: string, tag: "th" | "td") =>
    Array.from(html.matchAll(new RegExp(`<${tag}[^>]*?(?:data-level="([^"]+)" )?data-chosen="(general|special)"`, "g")), (match) => [
      match[1],
      match[2],
    ]);
  /** A row of Table 1, from its lot sizes to its end. */
  const rowOf = (html: string, lots: string) => new RegExp(`${lots}</th>((?:(?!</tr>)[\\s\\S])*)</tr>`).exec(html)?.[1] ?? "";

  it("highlights both levels' columns, the general one's and the special one's (Kenneth, 27 October 2026)", () => {
    const html = table(render(), "code-letter-table");
    expect(inUse(html, "th")).toEqual([
      ["S-2", "special"],
      ["I", "general"],
    ]);
    expect(html).toMatch(/data-level="S-2" data-chosen="special" class="[^"]*bg-secondary[^"]*">S-2<span class="sr-only"> \(Special Level in Use\)<\/span>/);
    expect(html).toMatch(/data-level="I" data-chosen="general" class="[^"]*bg-secondary[^"]*">I<span class="sr-only"> \(General Level in Use\)<\/span>/);
    // Every row's cell of each column in use is highlighted.
    expect(html.match(/<td data-chosen="general"/g)).toHaveLength(TABLE_1.length);
    expect(html.match(/<td data-chosen="special"/g)).toHaveLength(TABLE_1.length);
    // The levels picked for the inspection move the highlights: II and S-4.
    const own = table(render({ settings: { inspectionLevel: "II", specialInspectionLevel: "S-4" } }), "code-letter-table");
    expect(inUse(own, "th")).toEqual([
      ["S-4", "special"],
      ["II", "general"],
    ]);
  });

  it("names each size in the row of its lot in gloves, both levels' letters filled there, and in the row of its lot in inner boxes", () => {
    const html = table(render(), "code-letter-table");
    // SAFEDON_EG: XS and L 120,000 gloves, S and M over 500,000; 16 plastic packs a case, so XS and L 960, M 8,960, S 13,600.
    expect(Array.from(html.matchAll(/<tr data-sizes="([^"]+)"/g), (match) => match[1])).toEqual(["XS L", "S M"]);
    expect(Array.from(html.matchAll(/data-inner-box-sizes="([^"]+)"/g), (match) => match[1])).toEqual(["XS L", "M", "S"]);
    const gloves = rowOf(html, "35,001 to 150,000");
    expect(gloves).toMatch(/<td data-chosen="special" class="[^"]*bg-primary[^"]*">E<\/td>/);
    expect(gloves).toMatch(/<td data-chosen="general" class="[^"]*bg-primary[^"]*">L<\/td>/);
    expect(gloves).toContain('<span class="block">XS, L</span>');
    expect(rowOf(html, "500,001 and over")).toMatch(/<td data-chosen="general" class="[^"]*bg-primary[^"]*">N<\/td>/);
    // A lot in inner boxes is read at the special level only: Packaging & Dispensing's.
    const innerBoxes = rowOf(html, "501 to 1,200");
    expect(innerBoxes).toMatch(/<td data-chosen="special" class="[^"]*bg-primary[^"]*">C<\/td>/);
    expect(innerBoxes).toMatch(/<td data-chosen="general" class="[^"]*bg-accent[^"]*">G<\/td>/);
    expect(innerBoxes).toContain(">XS, L (Inner Boxes)</span>");
    expect(rowOf(html, "10,001 to 35,000")).toMatch(/<td data-chosen="special" class="[^"]*bg-primary[^"]*">D<\/td>/);
    // A row no lot falls in keeps the columns' highlight, unfilled.
    expect(rowOf(html, "2 to 8")).toMatch(/<td data-chosen="special" class="[^"]*bg-accent[^"]*">A<\/td>/);
  });

  it("lists each size under the table: its lot in gloves at the general level, the same at the special level, its lot in inner boxes at the special level", () => {
    const html = render();
    expect(html).toContain(">Each Size at Levels I and S-2</h3>");
    const sizes = Array.from(table(html, "size-code-letters").matchAll(/<tbody data-size="([^"]+)">([\s\S]*?)<\/tbody>/g));
    expect(sizes.map((match) => match[1])).toEqual(["XS", "S", "M", "L"]);
    const lines = (body: string) =>
      Array.from(body.matchAll(/<tr data-use="([^"]+)">([\s\S]*?)<\/tr>/g), ([, use, cells]) => [
        use,
        ...Array.from(cells.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g), (cell) =>
          cell[1].replace(/<span class="sr-only">[^<]*<\/span>/g, "").replace(/<[^>]+>/g, "").replaceAll("&amp;", "&").trim(),
        ),
      ]);
    expect(lines(sizes[0][2])).toEqual([
      ["gloves", "# of Gloves Sample", "120,000 gloves", "I", "L", "200"],
      ["gloves-tests", "Dimension, FAB", "120,000 gloves", "S-2", "E", "13"],
      ["inner-box-tests", "Packaging & Dispensing", "960 inner boxes", "S-2", "C", "5"],
    ]);
    expect(lines(sizes[1][2])).toEqual([
      ["gloves", "# of Gloves Sample", "1,700,000 gloves", "I", "N", "500"],
      ["gloves-tests", "Dimension, FAB", "1,700,000 gloves", "S-2", "E", "13"],
      ["inner-box-tests", "Packaging & Dispensing", "13,600 inner boxes", "S-2", "D", "8"],
    ]);
    // The size heads its three lines.
    expect(sizes[2][2]).toMatch(/<th scope="rowgroup" rowSpan="3"[^>]*>M<\/th>/);
    // At the levels picked for the inspection.
    const own = render({ settings: { inspectionLevel: "II", specialInspectionLevel: "S-4" } });
    expect(own).toContain(">Each Size at Levels II and S-4</h3>");
  });

  it("scrolls inside its dialog (an iPad in portrait), with a 44 px way back to Settings", () => {
    const html = render();
    expect(tagWith(html, 'class="[^"]*sm:max-w-3xl')).toContain("max-h-[calc(100dvh-2rem)]");
    const scroller = tagWith(html, 'data-slot="code-letter-scroller"');
    expect(scroller).toContain("overflow-y-auto");
    expect(scroller).toContain("min-h-0 flex-1");
    expect(scroller).toContain('tabindex="0"');
    expect(html.match(/<button[^>]*touch:h-11[^>]*>Back to Settings<\/button>/g)).toHaveLength(2);
  });
});

describe("sampling_plan Sampling Settings' Table II-A (ISO 2859-1 Table 2-A)", () => {
  /** A cell of the table: Accept / Reject, or an arrow and its words. */
  const cell = (html: string, letter: string, aql: number) =>
    new RegExp(`<tr data-letter="${letter}"[\\s\\S]*?<td data-aql="${aql}"[^>]*>([\\s\\S]*?)</td>`).exec(html)?.[1];

  it("draws Table 2-A from lib/aql, arrows and all: a row per code letter with its sample size, a column per AQL", () => {
    const html = table(render({ checks: true }), "master-table");
    expect(Array.from(html.matchAll(/<tr data-letter="([A-R])"/g), (match) => match[1]).join("")).toBe("ABCDEFGHJKLMNPQR");
    expect(Array.from(html.matchAll(/<th scope="col" data-aql="([^"]+)"/g), (match) => Number(match[1]))).toEqual([...TABLE_2A_AQLS]);
    expect(cell(html, "M", 2.5)).toBe("14 / 15");
    expect(cell(html, "L", 4)).toBe("14 / 15");
    expect(cell(html, "K", 1.5)).toBe("5 / 6");
    expect(cell(html, "N", 4)).toBe('<span aria-hidden="true">↑</span><span class="sr-only">The first plan above</span>');
    expect(cell(html, "A", 0.65)).toBe('<span aria-hidden="true">↓</span><span class="sr-only">The first plan below</span>');
    expect(html).toMatch(/<tr data-letter="R"[^>]*><th[^>]*><span[^>]*>R<\/span><\/th><td[^>]*>2,000<\/td>/);
  });

  it("marks the sizes' code letters at the level, the AQLs the inspection applies, and the plans where they meet", () => {
    const html = table(render({ checks: true }), "master-table");
    // Level I: XS and L (120,000 gloves) take L, S and M (over 500,000) N.
    expect(Array.from(html.matchAll(/<tr data-letter="([A-R])" data-sizes="([^"]+)"/g), (match) => [match[1], match[2]])).toEqual([
      ["L", "XS L"],
      ["N", "S M"],
    ]);
    expect(html).toMatch(/<tr data-letter="L" data-sizes="XS L"><th[^>]*><span[^>]*>L<\/span><span[^>]*>XS, L<\/span>/);
    // Watertight's 1.5, major's 2.5 and minor's 4.0, each named.
    expect(
      Array.from(html.matchAll(/<th scope="col" data-aql="([^"]+)" data-aql-in-use=""[^>]*>[^<]*<span[^>]*>([^<]*)<\/span>/g), (match) => [
        match[1],
        match[2],
      ]),
    ).toEqual([
      ["1.5", "Watertight"],
      ["2.5", "Major"],
      ["4", "Minor"],
    ]);
    const rows = Array.from(html.matchAll(/<tr data-letter="([A-R])"[^>]*>([\s\S]*?)<\/tr>/g));
    const marked = (attribute: string) =>
      rows.flatMap(([, letter, body]) =>
        Array.from(body.matchAll(new RegExp(`<td data-aql="([^"]+)" ${attribute}="true"[^>]*>([\\s\\S]*?)</td>`, "g")), (match) => [
          letter,
          match[1],
          match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        ]),
      );
    expect(marked("data-meets")).toEqual([
      ["L", "1.5", "7 / 8"],
      ["L", "2.5", "10 / 11"],
      ["L", "4", "14 / 15"],
      ["N", "1.5", "14 / 15"],
      ["N", "2.5", "21 / 22"],
      ["N", "4", "↑ The first plan above"],
    ]);
    // N's arrow up at 4.0 leads to M's plan, outlined.
    expect(marked("data-leads")).toEqual([["M", "4", "21 / 22"]]);
    // Without watertight and visual no AQL is in use: the code letters are still marked, no plan is.
    const plain = table(render(), "master-table");
    expect(plain).not.toContain("data-aql-in-use");
    expect(plain).not.toContain("data-meets");
    expect(plain).toContain('data-sizes="XS L"');
  });

  it("scrolls both ways in its own box inside the dialog, its header rows and first two columns pinned", () => {
    const html = render({ checks: true });
    expect(tagWith(html, 'class="[^"]*sm:max-w-5xl')).toContain("max-h-[calc(100dvh-2rem)]");
    const scroller = tagWith(html, 'data-slot="master-table-scroller"');
    for (const part of ['role="region"', 'aria-label="Table II-A"', 'tabindex="0"', "overflow-auto", "min-h-0 flex-1"]) {
      expect(scroller).toContain(part);
    }
    const master = table(html, "master-table");
    expect(master).toMatch(/<th rowSpan="2" scope="col" class="[^"]*sticky top-0 left-0 z-30[^"]*">Code Letter<\/th>/);
    expect(master).toMatch(/<th rowSpan="2" scope="col" data-pinned-end="" class="[^"]*sticky top-0 left-24 z-30[^"]*">Sample Size<\/th>/);
    for (const head of master.match(/<th scope="col" data-aql=[^>]*>/g) ?? []) expect(head).toMatch(/sticky top-9 .*touch:top-11/);
    for (const letter of master.match(/<th scope="row"[^>]*>/g) ?? []) expect(letter).toContain("sticky left-0");
  });
});
