// Server-rendered markup of the visual capture body, one size at a time
// (Kenneth, 26 October 2026): the size's one gloves-inspected field, never
// filled in, with the sampling plan's n one tap away while it is empty; a
// card per class the template switches on, in its wording, with calc's
// limits, the defects in rows of steppers, the class's total and chip; no
// code letter line; ordered sizes only, the hand split, one-off rows and
// read-only. Taps, swipes and keys are the capture kit's, tested there; the
// writes are in Capture.updates.test.tsx.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { labelOverrides, moduleConfig } from "@/lib/coverage";
import type { ResolvedModule } from "@/lib/schemas";
import { MODULE_REGISTRY } from "@/modules/registry";
import { evaluateInspection, type InspectionContext, type ModuleEvaluation } from "@/modules/_framework";
import { makeSampling, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import type { VisualComputed } from "./calc";
import Capture from "./Capture";
import { VISUAL_DEFAULT_CONFIG, VISUAL_LABELS, VISUAL_TITLE, VisualConfigSchema, type VisualConfig } from "./config";
import { DEFECT_CLASSES, VisualDataSchema } from "./schema";

const noop = () => {};

type RenderInput = {
  sizes: Record<string, unknown>;
  context: InspectionContext;
  config?: VisualConfig;
  labels?: Record<string, string>;
  readOnly?: boolean;
  defectUsage?: Record<string, number>;
};

function render({
  sizes,
  context,
  config = VISUAL_DEFAULT_CONFIG,
  labels = VISUAL_LABELS,
  readOnly = false,
  defectUsage,
}: RenderInput) {
  const data = VisualDataSchema.parse({ sizes });
  const template = makeTestTemplate(MODULE_REGISTRY, [{ key: "visual", config: config as ResolvedModule["config"], labels }]);
  const evaluation = evaluateInspection(
    { template, data: { modules: { visual: data }, custom: {} }, context },
    MODULE_REGISTRY,
  ).modules.find((entry) => entry.key === "visual") as ModuleEvaluation<VisualComputed> | undefined;
  return renderToStaticMarkup(
    <Capture
      data={data}
      config={config}
      title={VISUAL_TITLE}
      labels={labels}
      context={context}
      evaluation={evaluation ?? null}
      focusPath={null}
      readOnly={readOnly}
      onChange={noop}
      onFocusChange={noop}
      defectUsage={defectUsage}
    />,
  );
}

const tagsWith = (html: string, attribute: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<[^>]*${attribute}[^>]*>`, "g")), (match) => match[0]);

/** The text of each element with `data-slot="slot"`, in page order (class by class). */
const slotTexts = (html: string, slot: string) =>
  Array.from(html.matchAll(new RegExp(`<(\\w+) data-slot="${slot}"[^>]*>([\\s\\S]*?)</\\1>`, "g")), (match) =>
    match[2].replace(/<[^>]+>/g, ""),
  );

/** Each card's Accept / Reject line. */
const limits = (html: string) => slotTexts(html, "class-limits");

/** Each card's footer: "Found 8 of 21 allowed". */
const totals = (html: string) => slotTexts(html, "class-total");

const headings = (html: string) => Array.from(html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g), (match) => match[1]);

/** The gloves inspected inputs, in page order. */
const numberInputs = (html: string) => tagsWith(html, 'data-slot="numeric-cell"');

const valueOf = (input: string) => /value="([^"]*)"/.exec(input)?.[1];

/** Each card's chip. */
const statuses = (html: string) =>
  tagsWith(html, 'data-slot="status-pill"').map((pill) => /data-status="(\w+)"/.exec(pill)?.[1]);

/** The attribute that marks a control for issue links at `path`, as the markup prints it. */
const pathAttribute = (path: readonly (string | number)[]) =>
  `data-issue-path="${JSON.stringify(path).replaceAll('"', "&quot;")}"`;

/** calc's warnings shown under a field, one block per field. */
const warningBlocks = (html: string) =>
  Array.from(html.matchAll(/<div id="[^"]*-calc-warning"[^>]*text-warn[^>]*>[\s\S]*?<\/div>/g), (match) => match[0]);

const M_500 = () => makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ watertightVisual: 500 }) } });

const inspectedAll = (n: number) => Object.fromEntries(DEFECT_CLASSES.map((cls) => [cls, { inspected: n }]));

describe("visual capture", () => {
  const stdEg = () =>
    render({
      sizes: {
        M: Object.fromEntries(
          DEFECT_CLASSES.map((cls) => {
            const entry = STD_EG_EXAMPLE.visual[cls].perSize.M;
            return [cls, { inspected: entry?.inspected ?? null, counts: { ...entry?.counts } }];
          }),
        ),
      },
      context: M_500(),
      config: VisualConfigSchema.parse(moduleConfig("STD_EG", "visual")),
      labels: { ...VISUAL_LABELS, ...labelOverrides("STD_EG", "visual") },
    });

  it("has a card per class, headed in the template's wording with its AQL", () => {
    const html = stdEg();
    expect(headings(html)).toEqual(["Critical Defects (AQL 0.0)", "Major Defects (AQL 2.5)", "Minor Defects (AQL 4.0)"]);
    // Each a region named by its heading.
    expect(tagsWith(html, 'data-slot="defect-class"').every((card) => card.includes("aria-labelledby="))).toBe(true);
  });

  it("B. counts the STD_EG example with calc's limits, totals and chips: 0 / 1, 21 / 22, 21 / 22", () => {
    const html = stdEg();
    // The limits in the template's words, not the kit's Ac / Re: the critical class's as STD_EG prints
    // them (criticalAccept, criticalReject), the others with the shared words.
    expect(limits(html)).toEqual(["Acc. = 0 / Rej. = 1", "Accept 21 / Reject 22", "Accept 21 / Reject 22"]);
    expect(totals(html)).toEqual(["Found 0 of 0 allowed", "Found 8 of 21 allowed", "Found 0 of 21 allowed"]);
    expect(statuses(html)).toEqual(["pass", "pass", "pass"]);
    expect(html).toContain('aria-label="Increase Thin Spot on Glove Body, Size M"');
    expect(html).toContain('aria-valuenow="5"');
    // A row with defects is tinted, so what was found shows at a glance.
    expect(tagsWith(html, 'data-nonzero="true"')).toHaveLength(3);
  });

  it("has no code letter line, and no per-size sampling plan line above the classes", () => {
    for (const html of [stdEg(), render({ sizes: {}, context: M_500() })]) {
      expect(html).not.toContain("Code Letter");
      expect(html).not.toContain("for Every Class");
    }
  });

  it("words one code apart per class: Defective Bead (major), Defective Beads (minor)", () => {
    const html = stdEg();
    expect(html).toContain('aria-label="Increase Defective Bead, Size M"');
    expect(html).toContain('aria-label="Increase Defective Beads, Size M"');
  });

  it("orders each class's rows most-used first, ties in the template's order", () => {
    const html = render({ sizes: {}, context: M_500(), defectUsage: { stain: 9, thin_spot: 4, bead_rolled: 2 } });
    const rows = Array.from(html.matchAll(/aria-label="Increase ([^"]+), Size M"/g), (match) => match[1]);
    // Critical's two rows, then major's twelve, then minor's six.
    expect(rows.slice(0, 2)).toEqual(["Embedded Insects", "Embedded Metal Debris"]);
    expect(rows.slice(2, 6)).toEqual([
      "Oil Stain",
      "Thin Spot on Glove Body",
      "Thin Area Between Fingers (Crotch)",
      "Ring-Shaped Thin Area (Crotch)",
    ]);
    expect(rows.slice(14, 16)).toEqual(["Rolled Bead", "Small Dirt / Stain"]);
  });

  it("leaves out a class the template switches off", () => {
    const config = {
      ...VISUAL_DEFAULT_CONFIG,
      classes: { ...VISUAL_DEFAULT_CONFIG.classes, critical: { ...VISUAL_DEFAULT_CONFIG.classes.critical, include: false } },
    };
    const html = render({ sizes: { M: inspectedAll(500) }, context: M_500(), config });
    expect(headings(html)).toEqual(["Major Defects (AQL 2.5)", "Minor Defects (AQL 4.0)"]);
    expect(html).not.toContain("Embedded Insects");
    // The size's field stands for the classes on: an issue at either lands on it.
    expect(html).toContain(pathAttribute(["sizes", "M", "major", "inspected"]));
    expect(html).toContain(pathAttribute(["sizes", "M", "minor", "inspected"]));
    expect(html).not.toContain(pathAttribute(["sizes", "M", "critical", "inspected"]));
  });

  it("takes the gloves inspected in one field per size, worded by the template, and never fills it in", () => {
    const html = render({ sizes: {}, context: M_500() });
    expect(numberInputs(html)).toHaveLength(1);
    expect(html).toMatch(/<label[^>]*>No\. of Sample Inspected, Size M<\/label>/);
    // Only what was entered, no placeholder: an empty field is a size not inspected yet (6.2 rule 5).
    expect(valueOf(numberInputs(html)[0])).toBe("");
    expect(numberInputs(html)[0]).not.toContain(" placeholder=");
    // Every class's path marks it, so an issue about any class's gloves inspected is found and focused there;
    // an issue about the whole size lands on it too, the first field of the size's panel.
    const field = html.indexOf('data-slot="numeric-cell"');
    for (const cls of DEFECT_CLASSES) {
      const at = html.indexOf(pathAttribute(["sizes", "M", cls, "inspected"]));
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(field);
    }
    expect(html.indexOf(pathAttribute(["sizes", "M"]))).toBeLessThan(field);
    // No class card has a field of its own.
    expect(html.slice(html.indexOf('data-slot="defect-class"'))).not.toContain('data-slot="numeric-cell"');
  });

  it("offers the sampling plan's n beside the empty field only, and says where an entered number stands against it", () => {
    const empty = render({ sizes: {}, context: M_500() });
    const use = /<button[^>]*aria-label="Use 500 from the Sampling Plan for size M"[^>]*>Use 500<\/button>/.exec(empty)?.[0];
    expect(use).toBeDefined();
    // 16 px text on touch, as every field's; size sm alone keeps 14 px there.
    expect(use).toContain("touch:text-base");
    const planned = render({ sizes: { M: inspectedAll(500) }, context: M_500() });
    expect(planned).not.toContain("Use 500");
    expect(planned).toMatch(/<p id="[^"]*-hint"[^>]*>from Sampling Plan<\/p>/);
    const other = render({ sizes: { M: inspectedAll(315) }, context: M_500() });
    expect(other).toMatch(/<p id="[^"]*-hint"[^>]*>Sampling Plan: 500<\/p>/);
    // Without a number in the plan there is nothing to offer, or to compare with.
    for (const html of [
      render({ sizes: {}, context: makeTestContext({ sizes: ["M"] }) }),
      render({ sizes: { M: inspectedAll(500) }, context: makeTestContext({ sizes: ["M"] }) }),
    ]) {
      expect(html).not.toContain("Sampling Plan");
    }
  });

  it("says under the size's field what calc found about each class's gloves inspected, warnings in amber", () => {
    const html = render({ sizes: { M: inspectedAll(315) }, context: M_500() });
    const blocks = warningBlocks(html);
    expect(blocks).toHaveLength(1);
    for (const name of ["Critical Defects", "Major Defects", "Minor Defects"]) {
      expect(blocks[0]).toContain(
        `<span>Size M, ${name}: No. of Sample Inspected is 315, but the sampling plan has 500 gloves for watertight and visual.</span>`,
      );
    }
  });

  it("keeps a field in each card where saved data has a different number per class", () => {
    const html = render({ sizes: { M: { ...inspectedAll(500), minor: { inspected: 315 } } }, context: M_500() });
    expect(numberInputs(html).map(valueOf)).toEqual(["500", "500", "315"]);
    expect(html).not.toMatch(/>No\. of Sample Inspected, Size M</);
    // One element in the flex Label, so the class and size follow the text with no gap.
    expect(html).toMatch(
      /<label[^>]*><span>No\. of Sample Inspected<span class="sr-only">, Minor Defects, Size M<\/span><\/span><\/label>/,
    );
    // The minor class's warning under its own field, in its card.
    const blocks = warningBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("Size M, Minor Defects: No. of Sample Inspected is 315");
    expect(html.indexOf(blocks[0])).toBeGreaterThan(html.indexOf('data-class="minor"'));
    // A class with none yet is offered the plan's n in its own card.
    const partly = render({ sizes: { M: { critical: { inspected: 500 } } }, context: M_500() });
    expect(numberInputs(partly).map(valueOf)).toEqual(["500", "", ""]);
    const offered = tagsWith(partly, 'aria-label="Use 500 from the Sampling Plan for ');
    expect(offered.map((tag) => /for ([^"]+)"/.exec(tag)?.[1])).toEqual(["Major Defects, size M", "Minor Defects, size M"]);
  });

  it("shows a class not inspected as an empty field when read-only, never the sampling plan's n as if recorded", () => {
    const html = render({ sizes: { M: { critical: { inspected: 500 } } }, context: M_500(), readOnly: true });
    const fields = numberInputs(html);
    expect(fields.map(valueOf)).toEqual(["500", "", ""]);
    expect(fields.some((field) => field.includes(" placeholder="))).toBe(false);
    expect(statuses(html)).toEqual(["pass", "not_done", "not_done"]);
  });

  it("shows the critical limit before the gloves inspected are entered, beside a critical defect's failure", () => {
    const html = render({ sizes: { M: { critical: { counts: { embedded_metal: 1 } } } }, context: M_500() });
    // Major and minor need n for their limits.
    expect(limits(html)).toEqual(["Acc. = 0 / Rej. = 1", "Accept — / Reject —", "Accept — / Reject —"]);
    expect(totals(html)).toEqual(["Found 1 of 0 allowed", "Found 0", "Found 0"]);
    expect(statuses(html)).toEqual(["fail", "not_done", "not_done"]);
    // SAFEDON_EG prints its critical limit Accept 0 / Reject 1.
    const safedon = { ...VISUAL_LABELS, ...labelOverrides("SAFEDON_EG", "visual") };
    expect(limits(render({ sizes: {}, context: M_500(), labels: safedon }))[0]).toBe("Accept 0 / Reject 1");
  });

  it("words one class's limit apart where the template does (STD_EG prints Acc. = 0 / Rej. = 1 for critical)", () => {
    const critical = (labels: Record<string, string>) => limits(render({ sizes: {}, context: M_500(), labels }))[0];
    // Keyed class first, as the dictionary keys class wording (criticalTotal): STD_EG's by default.
    expect(critical(VISUAL_LABELS)).toBe("Acc. = 0 / Rej. = 1");
    expect(critical({ ...VISUAL_LABELS, criticalAccept: "Accept", criticalReject: "Reject" })).toBe("Accept 0 / Reject 1");
    // A dotted key added in the editor works too, in a template resolved before the dictionary
    // keyed the class's words; the class-first key wins over it.
    const older = Object.fromEntries(
      Object.entries(VISUAL_LABELS).filter(([key]) => key !== "criticalAccept" && key !== "criticalReject"),
    );
    expect(critical(older)).toBe("Accept 0 / Reject 1");
    const dotted = { ...older, "critical.accept": "Acc. =", "critical.reject": "Rej. =" };
    expect(critical(dotted)).toBe("Acc. = 0 / Rej. = 1");
    expect(critical({ ...dotted, criticalAccept: "Ac =", criticalReject: "Re =" })).toBe("Ac = 0 / Re = 1");
    // A blank class word falls back to the word every class shares.
    expect(critical({ ...VISUAL_LABELS, criticalAccept: " ", criticalReject: "" })).toBe("Accept 0 / Reject 1");
  });

  it("shows one size at a time, with tabs at every width, and the cards side by side where three fit", () => {
    const context = makeTestContext({
      sizes: ["S", "M"],
      sampling: { S: makeSampling({ watertightVisual: 200 }), M: makeSampling({ watertightVisual: 500 }) },
    });
    const html = render({ sizes: {}, context });
    expect(tagsWith(html, 'role="tab"').map((tab) => /data-size="([^"]+)"/.exec(tab)?.[1])).toEqual(["S", "M"]);
    // Never every size side by side: the bar stays from 1280 px too.
    expect(tagsWith(html, 'data-slot="size-tabs"')[0]).not.toContain("data-side-by-side");
    expect(html).toContain("No. of Sample Inspected, Size S");
    expect(html).not.toContain("Size M</label>");
    expect(html).not.toContain(", Size M");
    // A container query: three columns with a mouse from a 46rem panel, on touch from 60rem; one below.
    expect(html).toMatch(/class="@container [^"]*"/);
    expect(html).toContain("grid items-start gap-3 touch:gap-4 fine:@min-[46rem]:grid-cols-3 touch:@min-[60rem]:grid-cols-3");
  });

  it("shows only ordered sizes (6.2 rule 4)", () => {
    const html = render({ sizes: { M: inspectedAll(500), XL: inspectedAll(200) }, context: M_500() });
    expect(tagsWith(html, 'role="tab"').map((tab) => /data-size="([^"]+)"/.exec(tab)?.[1])).toEqual(["M"]);
    expect(html).not.toContain("Size XL");
  });

  it("gives each row a Right and a Left stepper with both hands on screen, the total counting both (surgical)", () => {
    const html = render({
      sizes: {
        "7.0": {
          ...inspectedAll(125),
          R: { major: { counts: { thin_spot: 2 } } },
          L: { major: { counts: { thin_spot: 1 } } },
        },
      },
      context: makeTestContext({
        sizes: ["7.0"],
        templateSizes: [{ value: "7.0", label: "7.0" }],
        sampling: { "7.0": makeSampling({ watertightVisual: 125 }) },
      }),
      config: { ...VISUAL_DEFAULT_CONFIG, handSplit: true },
    });
    expect(tagsWith(html, 'role="radio"')).toHaveLength(3);
    expect(html).toContain('aria-label="Increase Thin Spot on Glove Body, Size 7.0, Right Hand"');
    expect(html).toContain('aria-label="Increase Thin Spot on Glove Body, Size 7.0, Left Hand"');
    expect(html).toContain(pathAttribute(["sizes", "7.0", "L", "major", "counts", "thin_spot"]));
    // Words, not R and L: size L sits on the tabs above. The steppers' names say the hand in full.
    expect(html.match(/<span aria-hidden="true" class="[^"]*">Right<\/span>/g)).toHaveLength(20);
    expect(html.match(/<span aria-hidden="true" class="[^"]*">Left<\/span>/g)).toHaveLength(20);
    expect(totals(html).map((total) => /^Found (\d+)/.exec(total)?.[1])).toEqual(["0", "3", "0"]);
    // The gloves inspected and the limits stay per size: one field.
    expect(numberInputs(html)).toHaveLength(1);
    // Rows of two steppers need twice the room for three cards side by side.
    expect(html).toContain("fine:@min-[78rem]:grid-cols-3 touch:@min-[100rem]:grid-cols-3");
  });

  it("flags one-off rows for an admin in their class only, removable while they count nothing", () => {
    const html = render({
      sizes: { M: { ...inspectedAll(500), minor: { inspected: 500, unmapped: [{ label: "Faint print", count: 1 }] } } },
      context: M_500(),
    });
    expect(tagsWith(html, 'data-unmapped="true"')).toHaveLength(1);
    expect(totals(html)).toEqual(["Found 0 of 0 allowed", "Found 0 of 21 allowed", "Found 1 of 21 allowed"]);
    // Each card can add one.
    expect(html.match(/Defect Not in the List/g)).toHaveLength(3);
    expect(html).not.toContain("Remove Faint print");
    // One added by mistake, counting nothing, can be taken off; it counts like any row meanwhile.
    const mistake = render({
      sizes: { M: { ...inspectedAll(500), minor: { inspected: 500, unmapped: [{ label: "Faint print", count: 0 }] } } },
      context: M_500(),
    });
    expect(mistake.match(/aria-label="Remove Faint print"/g)).toHaveLength(1);
    expect(mistake).toContain('aria-label="Increase Faint print, Size M"');
    expect(mistake).toContain(pathAttribute(["sizes", "M", "minor", "unmapped", 0]));
  });

  it("is read-only for an approved inspection: steppers disabled, nothing to add, take off or use", () => {
    const html = render({
      sizes: { M: { minor: { unmapped: [{ label: "Faint print", count: 0 }] } } },
      context: M_500(),
      readOnly: true,
    });
    const steppers = tagsWith(html, 'data-slot="stepper"');
    expect(steppers).toHaveLength(21);
    expect(steppers.every((stepper) => stepper.includes('data-disabled="true"'))).toBe(true);
    expect(html).not.toContain("Defect Not in the List");
    expect(html).not.toContain("Remove Faint print");
    expect(html).not.toContain("from the Sampling Plan");
    expect(numberInputs(html)[0]).toContain("readOnly");
  });

  it("says so when the template switches every class off", () => {
    const off = (cls: keyof VisualConfig["classes"]) => ({ ...VISUAL_DEFAULT_CONFIG.classes[cls], include: false });
    const html = render({
      sizes: {},
      context: M_500(),
      config: { ...VISUAL_DEFAULT_CONFIG, classes: { critical: { ...off("critical"), aql: 0 }, major: off("major"), minor: off("minor") } },
    });
    expect(html).toContain("No defect classes are switched on");
  });
});
