// Server-rendered markup checks: accessible names, states, live regions and
// computed footers. The interaction rules are pure functions with their own
// tests: numeric-entry (commit, Escape), grid-navigation (Enter, arrows,
// paste), stepper-keys and use-announcement.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { STATUSES } from "@/lib/design/status";
import { DefectChip } from "./defect-chip";
import { DefectChipGroup } from "./defect-chip-group";
import { MeasurementGrid, type Measure } from "./measurement-grid";
import { ModuleCard } from "./module-card";
import { NumericCell } from "./numeric-cell";
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
  ];

  it.each(components)("%s anchors its sr-only text", (_, element) => {
    const html = renderToStaticMarkup(element);
    expect(html).toContain("sr-only");
    expect(unanchoredSrOnly(html)).toEqual([]);
  });
});

describe("StatusPill", () => {
  it.each(STATUSES)("shows %s as an icon and words, never colour alone", (status) => {
    const html = renderToStaticMarkup(<StatusPill status={status} />);
    expect(html).toContain(`data-status="${status}"`);
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toMatch(/<span>[A-Z][a-z ]+<\/span>/);
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
    expect(renderToStaticMarkup(<ResultChip status="not_done" />)).toContain(">Not done<");
  });
});

describe("SaveStatus", () => {
  it("is a status region with the pending upload count spelled out", () => {
    const html = renderToStaticMarkup(<SaveStatus state="offline" pendingUploads={3} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Offline (will sync)");
    expect(html).toContain("photos waiting to upload");
  });

  it("hides the badge with nothing queued", () => {
    expect(renderToStaticMarkup(<SaveStatus state="saved" />)).not.toContain("waiting to upload");
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
});

describe("DefectChip", () => {
  it("shows a count and a remove button only once a defect is recorded", () => {
    const empty = renderToStaticMarkup(
      <DefectChip label="Oil stain" count={0} onIncrement={noop} onDecrement={noop} />,
    );
    expect(empty).not.toContain("Remove one");
    const counted = renderToStaticMarkup(
      <DefectChip label="Oil stain" count={2} onIncrement={noop} onDecrement={noop} />,
    );
    expect(counted).toContain('aria-label="Remove one Oil stain"');
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

  it("says Not done until a column has data, and NA without a spec", () => {
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
    expect(html).toContain("Dimensions · Size M · Box 253");
  });

  it("explains a flagged file without a preview", () => {
    const html = renderToStaticMarkup(<PhotoTile alt="IMG_0042.HEIC" tags={tags} state="flagged" />);
    expect(html).toContain("Needs conversion");
    expect(html).toContain("No preview");
  });

  it("only shows admin and selection controls when handlers are given", () => {
    const plain = renderToStaticMarkup(<PhotoTile src="/x.svg" alt="Glove" tags={tags} state="uploaded" />);
    expect(plain).not.toContain("Include in report");
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
    expect(admin).toContain("Include in report");
    expect(admin).toContain("Select photo: Glove");
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
});
