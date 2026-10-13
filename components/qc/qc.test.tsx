// Server-rendered markup checks: accessible names, states, live regions and
// computed footers. The interaction rules are pure functions with their own
// tests: numeric-entry (commit, Escape), grid-navigation (Enter, arrows,
// paste), stepper-keys and use-announcement.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { STATUSES } from "@/lib/design/status";
import { CountField } from "./count-field";
import { DefectChip } from "./defect-chip";
import { DefectChipGroup } from "./defect-chip-group";
import { MeasurementGrid, type Measure } from "./measurement-grid";
import { ModuleCard } from "./module-card";
import { NumericCell } from "./numeric-cell";
import { tagLine } from "./photo-tags";
import { PhotoTile } from "./photo-tile";
import { ProgressTracker } from "./progress-tracker";
import { ResultChip } from "./result-chip";
import { SaveStatus } from "./save-status";
import { StatusPill } from "./status-pill";
import { Stepper } from "./stepper";

const noop = () => {};

const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const POSITIONING = ["relative", "absolute", "fixed", "sticky", "sr-only"];

/**
 * The sr-only elements in some markup that have no positioned ancestor in it.
 * sr-only is position: absolute, so without one its 1 px box is laid out
 * against the page: inside a horizontally scrolling tab bar or table it
 * escapes the scroller and widens the whole page (design review D1).
 */
function unanchoredSrOnly(html: string): string[] {
  const open: { tag: string; positioned: boolean }[] = [];
  const found: string[] = [];
  for (const [, closing, tag, attributes, selfClosing] of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    if (closing) {
      const index = open.map((element) => element.tag).lastIndexOf(tag);
      if (index !== -1) open.length = index;
      continue;
    }
    const classes = (/\sclass="([^"]*)"/.exec(attributes)?.[1] ?? "").split(/\s+/);
    if (classes.includes("sr-only") && !open.some((element) => element.positioned)) {
      found.push(`<${tag}${attributes}>`);
    }
    if (VOID_ELEMENTS.has(tag) || selfClosing) continue;
    open.push({ tag, positioned: classes.some((name) => POSITIONING.includes(name)) });
  }
  return found;
}

describe("screen-reader text stays inside its component (D1)", () => {
  it("finds an unanchored label, as ResultChip had in a scrolling tab bar", () => {
    const html = '<div class="overflow-x-auto"><span class="inline-flex"><span class="sr-only">Passed</span></span></div>';
    expect(unanchoredSrOnly(html)).toHaveLength(1);
    expect(unanchoredSrOnly(html.replace('"inline-flex"', '"relative inline-flex"'))).toEqual([]);
  });

  const measures: Measure[] = [{ key: "width", label: "Width", unit: "mm", decimals: 0 }];
  const components: [string, ReactElement][] = [
    ["ResultChip", <ResultChip key="chip" status="pass" />],
    ["ResultChip not done", <ResultChip key="chip-empty" status="not_done" />],
    ["SaveStatus", <SaveStatus key="save" state="offline" pendingUploads={2} />],
    ["Stepper", <Stepper key="stepper" label="Holes, palm" value={1} onValueChange={noop} />],
    ["DefectChip", <DefectChip key="chip" label="Torn cuff" count={1} unmapped onIncrement={noop} onDecrement={noop} />],
    [
      "DefectChipGroup",
      <DefectChipGroup
        key="group"
        legend="Major Defects"
        items={[{ key: "hole", label: "Hole", count: 2 }]}
        onCountChange={noop}
        onAddLabel={noop}
      />,
    ],
    ["NumericCell", <NumericCell key="cell" aria-label="Weight" value={3.5} onValueChange={noop} unit="g" />],
    [
      "MeasurementGrid",
      <MeasurementGrid key="grid" caption="Dimension" measures={measures} values={{}} onValuesChange={noop} statistic="median" />,
    ],
    [
      "ModuleCard",
      <ModuleCard key="card" title="Packing" status="not_done" comment="" onCommentChange={noop} onFiles={noop} />,
    ],
    ["PhotoTile", <PhotoTile key="photo" alt="IMG_0042.HEIC" tags={{ module: "Dimensions" }} state="flagged" onOpen={noop} />],
    [
      "ProgressTracker bar",
      <ProgressTracker key="bar" steps={[{ key: "a", label: "Header", state: "done" }]} activeKey="a" onStepSelect={noop} />,
    ],
    [
      "ProgressTracker list",
      <ProgressTracker
        key="list"
        variant="list"
        steps={[{ key: "a", label: "Header", state: "done", result: "pass" }]}
        activeKey="a"
        onStepSelect={noop}
      />,
    ],
    [
      "ProgressTracker list with a group",
      <ProgressTracker
        key="group"
        variant="list"
        steps={[
          { key: "a", label: "Header", state: "done", result: "pass" },
          { key: "b", label: "Visual Inspection", state: "not_started", result: "not_done" },
        ]}
        activeKey="b"
        onStepSelect={noop}
        group={{ label: "Inspection Steps", keys: ["a", "b"], result: "not_done", open: false, onOpenChange: noop }}
      />,
    ],
  ];

  it.each(components)("%s anchors its sr-only text", (_, element) => {
    const html = renderToStaticMarkup(element);
    expect(html).toContain("sr-only");
    expect(unanchoredSrOnly(html)).toEqual([]);
  });
});

describe("ProgressTracker list (the desktop sidebar)", () => {
  const steps = [
    { key: "dispensing", label: "Glove Dispensing Inspection", state: "in_progress", result: "not_done" },
    { key: "onsite", label: "Glove Dispensing Inspection: onsite notes", state: "not_started" },
  ] as const;

  it("wraps a long title to two lines instead of cutting it short, and names it in full on hover", () => {
    for (const onStepSelect of [noop, undefined]) {
      const html = renderToStaticMarkup(
        <ProgressTracker variant="list" steps={steps} activeKey="onsite" onStepSelect={onStepSelect} />,
      );
      expect(html).toContain('title="Glove Dispensing Inspection: onsite notes"');
      expect(html).toMatch(/class="line-clamp-2[^"]*">Glove Dispensing Inspection: onsite notes</);
      expect(html).not.toMatch(/\btruncate\b/);
      // Rows grow with a second line: a minimum height, never a fixed one.
      expect(html).toMatch(/class="relative flex min-h-9 [^"]*touch:min-h-11/);
    }
  });
});

describe("StatusPill", () => {
  it.each(STATUSES)("shows %s as an icon and words, never colour alone", (status) => {
    const html = renderToStaticMarkup(<StatusPill status={status} />);
    expect(html).toContain(`data-status="${status}"`);
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toMatch(/<span>[A-Z][a-z]*(?: [A-Z][a-z]*)*<\/span>/);
  });

  it("takes the template's wording", () => {
    expect(renderToStaticMarkup(<StatusPill status="pass" label="Accept" />)).toContain(">Accept<");
  });

  it.each(["sm", "md"] as const)("reads 16 px on touch at size %s, without a class of its own", (size) => {
    const html = renderToStaticMarkup(<StatusPill status="fail" size={size} />);
    expect(html).toContain("touch:text-base");
    expect(html).toContain("touch:h-8");
  });

  it("stays compact with a mouse at the small size", () => {
    expect(renderToStaticMarkup(<StatusPill status="pass" size="sm" />)).toMatch(/class="[^"]*\bh-6\b[^"]*\btext-xs\b/);
  });

  it("lets a caller size it for a compact list", () => {
    const html = renderToStaticMarkup(<StatusPill status="pass" size="sm" className="touch:h-7 touch:text-sm" />);
    expect(html).toContain("touch:text-sm");
    expect(html).not.toContain("touch:text-base");
  });
});

describe("ResultChip", () => {
  it("names the result for screen readers", () => {
    expect(renderToStaticMarkup(<ResultChip status="fail" />)).toContain('<span class="sr-only">Failed</span>');
    expect(renderToStaticMarkup(<ResultChip status="not_done" />)).toContain(">Not Done<");
  });
});

describe("SaveStatus", () => {
  it("is a status region with the pending upload count spelled out", () => {
    const html = renderToStaticMarkup(<SaveStatus state="offline" pendingUploads={3} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Offline (Will Sync)");
    expect(html).toContain("photos waiting to upload");
  });

  it("hides the badge with nothing queued", () => {
    expect(renderToStaticMarkup(<SaveStatus state="saved" />)).not.toContain("waiting to upload");
  });

  it("reads 16 px on touch, the pill and the upload badge alike, as StatusPill does", () => {
    const html = renderToStaticMarkup(<SaveStatus state="error" pendingUploads={2} />);
    const pills = Array.from(html.matchAll(/<span class="inline-flex h-7[^"]*"/g), (match) => match[0]);
    expect(pills).toHaveLength(2);
    for (const pill of pills) expect(pill).toMatch(/touch:h-8 touch:text-base/);
  });

  it("says Not Saved in fail red when saving needs the inspector, keeping the upload count", () => {
    const html = renderToStaticMarkup(<SaveStatus state="error" pendingUploads={1} />);
    expect(html).toContain('data-state="error"');
    expect(html).toContain("Not Saved");
    expect(html).toContain("text-fail");
    expect(html).toContain("lucide-cloud-alert");
    expect(html).toContain("photo waiting to upload");
  });
});

describe("tagLine", () => {
  it("names what was in focus when the photo was taken", () => {
    expect(tagLine({ module: "Dimensions", size: "M", box: "253" })).toBe("Dimensions · Size M · Box/Carton #253");
    expect(tagLine({ module: "Watertight", size: "7.0", hand: "L", defect: "Palm" })).toBe(
      "Watertight · Size 7.0 · Left Hand · Palm",
    );
  });

  it("ends with an entry of the module's own list, such as a loading stage", () => {
    expect(tagLine({ module: "Loading", item: "Doors closed" })).toBe("Loading · Doors closed");
  });

  it("names labelling's packaging level after the box, in the template's words", () => {
    expect(tagLine({ module: "Labelling", size: "M", defect: "Wrong / No lot number", box: "253", level: "Carton Box" })).toBe(
      "Labelling · Size M · Wrong / No lot number · Box/Carton #253 · Carton Box",
    );
    expect(tagLine({ module: "Labelling", size: "S", level: "Inner Boxes/Packs" })).toBe("Labelling · Size S · Inner Boxes/Packs");
    // Level then item, the order the capture screen's tag line has them.
    expect(tagLine({ module: "", level: "Dispenser Box", item: "Lot no." })).toBe("Dispenser Box · Lot no.");
  });
});

describe("Stepper", () => {
  it("is a spinbutton between two named buttons", () => {
    const html = renderToStaticMarkup(<Stepper label="Holes, palm" value={0} max={13} onValueChange={noop} />);
    expect(html).toContain('role="spinbutton"');
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain('aria-valuemax="13"');
    expect(html).toContain('aria-label="Decrease Holes, palm"');
    expect(html).toContain('aria-label="Increase Holes, palm"');
  });

  it("keeps the minus focusable but marked disabled at the minimum", () => {
    const html = renderToStaticMarkup(<Stepper label="Count" value={0} onValueChange={noop} />);
    expect(html).toMatch(/aria-disabled="true"[^>]*aria-label="Decrease Count"|aria-label="Decrease Count"[^>]*aria-disabled="true"/);
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
  });

  it("is a slim pill: each button the whole target, 28 px and 44 px on touch, its fill a circle inside", () => {
    const html = renderToStaticMarkup(<Stepper label="Count" value={1} onValueChange={noop} />);
    const classesOf = (tag: string) => (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(" ");
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(classesOf(button)).toEqual(expect.arrayContaining(["size-7", "p-0.5", "bg-clip-content", "touch:size-11", "touch:p-1"]));
    }
    // The pill adds no padding of its own: 30 px tall, 46 px on touch.
    const pill = classesOf(/<div[^>]*data-slot="stepper"[^>]*>/.exec(html)?.[0] ?? "");
    expect(pill).toContain("border");
    expect(pill.some((name) => /^(touch:)?p[xy]?-/.test(name))).toBe(false);
  });
});

describe("the kit's own words, Title Case as the app's labels are", () => {
  it("names ModuleCard's comment and its two photo buttons", () => {
    const html = renderToStaticMarkup(
      <ModuleCard title="Packing" status="not_done" comment="" onCommentChange={noop} onFiles={noop} />,
    );
    expect(html).toContain(">Inspector Comment</label>");
    expect(html).toContain("Take Photo</button>");
    expect(html).toContain("Add From Library</button>");
    // The placeholder is a sentence and keeps its words.
    expect(html).toContain('placeholder="Anything the report should mention"');
  });

  it("offers DefectChipGroup's one-off defect as Other Defect", () => {
    const html = renderToStaticMarkup(
      <DefectChipGroup legend="Major Defects" items={[{ key: "hole", label: "Hole", count: 0 }]} onCountChange={noop} onAddLabel={noop} />,
    );
    expect(html).toContain("Other Defect</button>");
  });
});

describe("CountField", () => {
  const render = (props: Partial<Parameters<typeof CountField>[0]> = {}) =>
    renderToStaticMarkup(
      <CountField label="Pouches failed" name="Pouches failed, Size 7.0" value={null} onValueChange={noop} {...props} />,
    );

  it("asks for the count with one button while it is not entered, never showing 0", () => {
    const html = render({ startLabel: "No Leaks" });
    expect(html).toContain('aria-label="No Leaks, Pouches failed, Size 7.0"');
    expect(html).not.toContain('role="spinbutton"');
    expect(render()).toContain(">Start Counting<");
  });

  it("is a stepper with a way back to not entered once it is", () => {
    const html = render({ value: 2, max: 13 });
    expect(html).toContain('role="spinbutton"');
    expect(html).toContain('aria-valuenow="2"');
    expect(html).toContain('aria-valuemax="13"');
    expect(html).toContain('aria-label="Clear Pouches failed, Size 7.0"');
  });

  it("drops a maximum below the stored count, so the count can still be lowered", () => {
    expect(render({ value: 5, max: 3 })).not.toContain("aria-valuemax");
  });

  it("is the number, or a dash, read-only", () => {
    expect(render({ value: 2, readOnly: true })).not.toContain("<button");
    expect(render({ value: null, readOnly: true })).toContain("No value");
  });

  it("shows calc's error in red and warnings in amber, and marks itself for issue links", () => {
    const html = render({ value: 3, error: "More failed than tested.", warning: "Fewer than planned.", issuePath: ["sizes", "7.0"] });
    expect(html).toMatch(/class="[^"]*text-fail[^"]*">More failed than tested\./);
    expect(html).toMatch(/text-warn[\s\S]*<span>Fewer than planned\.<\/span>/);
    expect(html).toContain('data-issue-path="[&quot;sizes&quot;,&quot;7.0&quot;]"');
  });
});

describe("DefectChip", () => {
  it("shows a count and a remove button only once a defect is recorded", () => {
    const empty = renderToStaticMarkup(
      <DefectChip label="Oil stain" count={0} onIncrement={noop} onDecrement={noop} />,
    );
    expect(empty).not.toContain("Remove One");
    const counted = renderToStaticMarkup(
      <DefectChip label="Oil stain" count={2} onIncrement={noop} onDecrement={noop} />,
    );
    expect(counted).toContain('aria-label="Remove One Oil stain"');
    expect(counted).toContain("data-active");
  });

  it("flags unmapped labels in words too", () => {
    const html = renderToStaticMarkup(
      <DefectChip label="Torn cuff" count={1} unmapped onIncrement={noop} onDecrement={noop} />,
    );
    expect(html).toContain("data-unmapped");
    expect(html).toContain("unmapped label");
  });
});

describe("NumericCell", () => {
  it("opens the decimal keypad and shows the stored number", () => {
    const html = renderToStaticMarkup(
      <NumericCell aria-label="Weight" value={3.5} onValueChange={noop} unit="g" />,
    );
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('type="text"');
    expect(html).toContain('value="3.5"');
    expect(html).toContain(">g<");
  });

  it("shows a rejected entry as text with its error, never as the value", () => {
    const html = renderToStaticMarkup(
      <NumericCell
        aria-label="Width"
        value={null}
        onValueChange={noop}
        invalid={{ raw: "2 42", error: "One number per cell." }}
      />,
    );
    expect(html).toContain('value="2 42"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("is not stored. One number per cell.");
  });

  it("has a polite live region from the start, so a rejection on blur is spoken (D7)", () => {
    const html = renderToStaticMarkup(<NumericCell aria-label="Weight" value={null} onValueChange={noop} />);
    expect(html).toMatch(/<span class="sr-only" aria-live="polite"><\/span>/);
  });

  it("leaves announcing to the grid in a grid cell", () => {
    const html = renderToStaticMarkup(<NumericCell variant="cell" aria-label="Width, No. 3" value={null} onValueChange={noop} />);
    expect(html).not.toContain("aria-live");
  });
});

describe("MeasurementGrid", () => {
  const measures: Measure[] = [
    { key: "length", label: "Length", unit: "mm", decimals: 0, spec: { kind: "min", min: 240 } },
    { key: "width", label: "Width", unit: "mm", decimals: 0, spec: { kind: "tolerance", nominal: 95, tolerance: 10 } },
    { key: "cuff", label: "Cuff Thickness", unit: "mm", decimals: 2 },
  ];
  const render = (values: Record<string, (number | null)[]>) =>
    renderToStaticMarkup(
      <MeasurementGrid
        caption="Dimension - Size M"
        measures={measures}
        values={values}
        onValuesChange={noop}
        statistic="median"
      />,
    );

  it("renders 13 gloves by each measure with labelled decimal cells", () => {
    const html = render({});
    expect(html.match(/inputMode="decimal"/g)).toHaveLength(13 * measures.length);
    expect(html).toContain('aria-label="Width, No. 13"');
    expect(html).toContain("<caption");
    expect(html).toContain(">Median<");
  });

  it("has one polite live region for rejected entries and pastes (D7)", () => {
    expect(render({}).match(/aria-live="polite"/g)).toHaveLength(1);
  });

  it("says Not Done until a column has data, and NA without a spec", () => {
    const html = render({});
    // Three statistics, plus P/F for the two measures that have a spec.
    expect(html.match(/data-status="not_done"/g)).toHaveLength(5);
    expect(html).toContain(">NA<");
  });

  it("computes the median and judges complete columns against the spec", () => {
    const html = render({
      length: [243, 245, 242, 244, 246, 243, 241, 244, 245, 243, 242, 244, 243],
      width: [80, 81, 80, 82, 79, 80, 81, 80, 80, 81, 80, 82, 80],
    });
    expect(html).toContain(">243<");
    expect(html).toContain('data-status="pass"');
    expect(html).toContain('data-status="fail"');
    expect(html).toContain("≥ 240");
    expect(html).toContain("95 ± 10");
  });

  const FULL = [6.5, 0, 6.6, 6.7, 6.8];
  const force: Measure = { key: "values", label: "Force at break (N)", decimals: 3, spec: { kind: "min", min: 6 } };
  const renderWith = (props: Partial<Parameters<typeof MeasurementGrid>[0]>) =>
    renderToStaticMarkup(
      <MeasurementGrid
        caption="Force at break, size M"
        measures={[force]}
        rows={5}
        values={{ values: FULL }}
        statistic="median"
        {...props}
      />,
    );
  const statuses = (html: string) => Array.from(html.matchAll(/data-status="(\w+)"/g), (match) => match[1]);

  it("shows calc's figures when the module passes them: no median or verdict for a reading calc refuses", () => {
    // Summarising its own cells, the grid would print 6.600 and Passed.
    expect(renderWith({})).toContain(">6.600<");
    expect(statuses(renderWith({}))).toEqual(["pass"]);
    const html = renderWith({ measures: [{ ...force, summary: { statistic: null, outcome: "not_done", count: 4 } }] });
    expect(html).not.toContain(">6.600<");
    expect(statuses(html)).toEqual(["not_done", "not_done"]);
  });

  it("prints calc's statistic at the measure's decimals, with the count while short of the rows", () => {
    const html = renderWith({
      measures: [{ ...force, summary: { statistic: 6.54321, outcome: "not_done", count: 4 } }],
    });
    expect(html).toContain(">6.543<");
    expect(html).toContain("4 of 5");
    const done = renderWith({ measures: [{ ...force, summary: { statistic: 6.6, outcome: "pass", count: 5 } }] });
    expect(done).not.toContain(" of 5");
    expect(statuses(done)).toEqual(["pass"]);
  });

  it("words the verdict, NA and the captions as the template does", () => {
    const html = renderWith({
      measures: [force, { key: "cuff", label: "Cuff" }],
      values: { values: [6.5, 6.4, 6.6, 6.7, 6.8], cuff: [0.1, 0.1, 0.1, 0.1, 0.1] },
      labels: { result: "A / Rej.", pass: "A", fail: "Rej.", na: "N/A", statistic: "Average" },
    });
    expect(html).toContain(">A<");
    expect(html).not.toContain(">Passed<");
    expect(html).toContain(">N/A<");
    expect(html).toContain(">A / Rej.<");
    expect(html).toContain(">Average<");
  });

  it("sizes its label column to the longest caption", () => {
    const html = renderWith({ labels: { result: "Passed / Failed" } });
    expect(html).toContain("width:clamp(3.5rem, calc(15ch + 2rem), 16rem)");
  });

  it("marks each cell for issue links and keeps them focusable inputs when read-only", () => {
    const html = renderWith({ readOnly: true, cellIssuePath: ({ row, measure }) => ["sizes", "M", measure, row] });
    const inputs = html.match(/<input[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(5);
    for (const input of inputs) {
      expect(input).toContain('readOnly=""');
      expect(input).not.toMatch(/\sdisabled=""/);
    }
    expect(inputs[1]).toContain('data-issue-path="[&quot;sizes&quot;,&quot;M&quot;,&quot;values&quot;,1]"');
    expect(html).not.toContain("<fieldset");
    expect(html).toContain('data-readonly="true"');
  });

  it("takes typing and pastes only when it is not read-only", () => {
    const editable = (renderWith({}).match(/<input[^>]*>/g) ?? [])[0];
    expect(editable).not.toContain("readOnly");
  });
});

describe("PhotoTile", () => {
  const tags = { module: "Dimensions", size: "M", box: "253" };

  it("shows upload progress as a progressbar", () => {
    const html = renderToStaticMarkup(
      <PhotoTile src="/design/photo-glove.svg" alt="Glove" tags={tags} state="pending" progress={40} />,
    );
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain("Uploading 40%");
    expect(html).toContain("Dimensions · Size M · Box/Carton #253");
  });

  it("explains a flagged file without a preview", () => {
    const html = renderToStaticMarkup(<PhotoTile alt="IMG_0042.HEIC" tags={tags} state="flagged" />);
    expect(html).toContain("Needs Conversion");
    expect(html).toContain("No preview");
  });

  it("says a stopped upload stopped, in fail red, with no progress bar", () => {
    const html = renderToStaticMarkup(<PhotoTile src="blob:local" alt="Glove" tags={tags} state="failed" progress={40} />);
    expect(html).toContain('data-state="failed"');
    expect(html).toMatch(/data-slot="upload-stopped" class="[^"]*border-fail-border bg-fail-tint text-fail/);
    expect(html).toContain("Upload Stopped");
    expect(html).toContain("lucide-cloud-alert");
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain("Uploading");
  });

  it("keeps the image box 4:3 whatever the photo's shape", () => {
    const html = renderToStaticMarkup(<PhotoTile src="/portrait.jpg" alt="Glove" tags={tags} state="uploaded" />);
    // overflow-hidden gives the box a zero minimum in the tile's flex column: a tall photo cannot stretch it.
    expect(html).toMatch(/data-slot="photo-image" class="[^"]*aspect-\[4\/3\] shrink-0 overflow-hidden/);
    expect(html).toContain('class="size-full object-cover"');
  });

  it("only shows admin and selection controls when handlers are given", () => {
    const plain = renderToStaticMarkup(<PhotoTile src="/x.svg" alt="Glove" tags={tags} state="uploaded" />);
    expect(plain).not.toContain("Include in Report");
    const admin = renderToStaticMarkup(
      <PhotoTile
        src="/x.svg"
        alt="Glove"
        tags={tags}
        state="uploaded"
        includeInReport
        onIncludeInReportChange={noop}
        onSelectedChange={noop}
      />,
    );
    expect(admin).toContain("Include in Report");
    expect(admin).toContain("In Report");
    expect(admin).toContain("Select Photo: Glove");
  });
});

describe("ProgressTracker", () => {
  const steps = [
    { key: "header", label: "Manufacturer Information", state: "done" as const },
    { key: "dimensions", label: "Dimension", state: "in_progress" as const },
    { key: "visual", label: "Visual Inspection", state: "not_started" as const },
  ];

  it("marks the module in view as the current step and counts what is done", () => {
    const html = renderToStaticMarkup(<ProgressTracker steps={steps} activeKey="dimensions" />);
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("1 of 3 done");
    expect(html).toContain("bg-gradient-brand");
  });

  it("lists steps with their state for screen readers", () => {
    const html = renderToStaticMarkup(<ProgressTracker variant="list" steps={steps} activeKey="header" />);
    expect(html).toContain(", In progress");
    expect(html).toContain(", Not started");
  });

  describe("a step named by a short label, with its full title (docs/DESIGN.md, Step Names)", () => {
    const named = [
      { key: "header", label: "Manufacturer", title: "Manufacturer Information", state: "done" as const },
      { key: "dimensions", label: "Dimension", state: "in_progress" as const },
    ];
    /** The opening tag that carries `attribute`. */
    const tag = (html: string, attribute: string) => new RegExp(`<[^>]*${attribute}[^>]*>`).exec(html)?.[0] ?? "";

    it("shows the label on a list row and the title on hover; without a title, the label on hover; each row carries its key", () => {
      for (const onStepSelect of [noop, undefined]) {
        const html = renderToStaticMarkup(
          <ProgressTracker variant="list" steps={named} activeKey="header" onStepSelect={onStepSelect} />,
        );
        expect(tag(html, 'data-step="header"')).toContain('title="Manufacturer Information"');
        expect(html).toMatch(/class="line-clamp-2[^"]*">Manufacturer</);
        expect(html).not.toContain(">Manufacturer Information<");
        expect(tag(html, 'data-step="dimensions"')).toContain('title="Dimension"');
      }
    });

    it("shows the label as the bar's name with the title on hover; the bar's segments carry no key", () => {
      const html = renderToStaticMarkup(<ProgressTracker steps={named} activeKey="header" onStepSelect={noop} />);
      expect(html).toMatch(/<span class="truncate [^"]*" title="Manufacturer Information">Manufacturer<\/span>/);
      expect(html).toContain("Manufacturer: Done");
      expect(html).not.toContain("data-step");
      // A step without a title: its label on hover.
      expect(renderToStaticMarkup(<ProgressTracker steps={named} activeKey="dimensions" />)).toMatch(
        /title="Dimension">Dimension<\/span>/,
      );
    });
  });

  describe("a group in the list", () => {
    const listed = [
      { key: "documents", label: "Source Documents", state: "done" as const, result: "pass" as const },
      ...steps.map((step) => ({ ...step, result: "not_done" as const })),
      { key: "conclusion", label: "Conclusion", state: "not_started" as const, result: "not_done" as const },
    ];
    const render = (open: boolean, activeKey = "dimensions") =>
      renderToStaticMarkup(
        <ProgressTracker
          variant="list"
          steps={listed}
          activeKey={activeKey}
          onStepSelect={noop}
          group={{
            label: "Inspection Steps",
            keys: steps.map((step) => step.key),
            result: "not_done",
            open,
            onOpenChange: noop,
          }}
        />,
      );
    /** The list the header controls, by the id it names. */
    const controlled = (html: string) => {
      const id = /aria-controls="([^"]+)"/.exec(html)?.[1] ?? "missing";
      return new RegExp(`<ol id="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>[\\s\\S]*?</ol>`).exec(html)?.[0] ?? "";
    };

    it("is a disclosure: a header button that reads the group and controls the list of its steps, hidden while collapsed", () => {
      const html = render(false);
      expect(html).toMatch(/<button type="button" aria-expanded="false" aria-controls="[^"]+"/);
      const list = controlled(html);
      expect(list).toMatch(/^<ol [^>]*hidden=""/);
      for (const step of steps) expect(list).toContain(`title="${step.label}"`);
      // The steps either side stay in the outer list, in their place.
      expect(list).not.toContain("Source Documents");
      expect(list).not.toContain("Conclusion");
      expect(html.indexOf('title="Source Documents"')).toBeLessThan(html.indexOf("aria-expanded"));
      expect(html.indexOf('title="Conclusion"')).toBeGreaterThan(html.indexOf(list));
      // Its title, how many are done and the worst result, read out in that order.
      const header = /<button[^>]*aria-expanded[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";
      expect(header).toContain(">Inspection Steps<");
      expect(header).toContain("1 of 3 done");
      expect(header).toContain('data-status="not_done"');
    });

    it("stands in for the module in view while collapsed over it, and hands that back once open", () => {
      const collapsed = render(false);
      expect(collapsed).toMatch(/<li data-slot="progress-group" aria-current="step">/);
      expect(collapsed).toMatch(/aria-expanded="false"[^>]*class="[^"]*\sbg-accent\s/);

      const open = render(true);
      expect(open).toContain('aria-expanded="true"');
      expect(controlled(open)).not.toMatch(/^<ol [^>]*hidden/);
      expect(open).toMatch(/<li data-slot="progress-group">/);
      expect(open).toMatch(/<li aria-current="step"><button[^>]*title="Dimension"/);
      // Collapsed over another step, it is not the current one.
      expect(render(false, "documents")).toMatch(/<li data-slot="progress-group">/);
    });
  });
});
