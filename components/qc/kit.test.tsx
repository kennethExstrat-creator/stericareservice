// Server-rendered markup of the capture kit: accessible names, states,
// computed totals and decisions, read-only forms. The rules behind them are
// in kit-logic.test.ts; pointer, key and paste handling were exercised in a
// browser at iPad and desktop sizes (docs/CAPTURE_KIT.md).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BoxPicker } from "./box-picker";
import { CounterTable, type CounterColumn, type CounterRow } from "./counter-table";
import type { CounterCell } from "./counter-model";
import { Figure } from "./figure";
import { HandToggle } from "./hand-toggle";
import { ModuleSection } from "./module-section";
import { EnterGroup, EntryProblems, labelText, NumberField, PercentField } from "./number-field";
import { RequirementList, SpecValue } from "./requirement-list";
import { SizeStatusStrip, SizeTabs } from "./size-tabs";

const noop = () => {};
const SIZES = ["XS", "S", "M", "L", "XL"];

/** Every opening tag that carries `attribute`. */
const tagsWith = (html: string, attribute: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<[^>]*${attribute}[^>]*>`, "g")), (match) => match[0]);

describe("SizeTabs", () => {
  const render = (props: Partial<Parameters<typeof SizeTabs>[0]> = {}) =>
    renderToStaticMarkup(
      <SizeTabs sizes={SIZES} value="M" onValueChange={noop} {...props}>
        {props.children ?? ((size: string) => <p>Panel {size}</p>)}
      </SizeTabs>,
    );

  it("is a tab list with one tab per ordered size and roving focus", () => {
    const html = render();
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Sizes"');
    const tabs = tagsWith(html, 'role="tab"');
    expect(tabs).toHaveLength(5);
    expect(tabs.filter((tab) => tab.includes('aria-selected="true"'))).toHaveLength(1);
    expect(tabs.filter((tab) => tab.includes('tabindex="0"'))).toHaveLength(1);
    expect(tabs.find((tab) => tab.includes('aria-selected="true"'))).toContain('data-size="M"');
    expect(html).toContain('<span class="sr-only">Size </span>M');
  });

  it("renders the active size in a panel labelled by its tab", () => {
    const html = render();
    expect(html).toContain("Panel M");
    expect(html).not.toContain("Panel XS");
    const panel = tagsWith(html, 'role="tabpanel"')[0];
    const tab = tagsWith(html, 'aria-selected="true"')[0];
    const tabId = /id="([^"]+)"/.exec(tab)?.[1];
    expect(panel).toContain(`aria-labelledby="${tabId}"`);
  });

  it("shows a result chip per size, Not done where calc has none", () => {
    const html = render({ results: { XS: "pass", S: { status: "fail", summary: "2 holes" } } });
    const chips = tagsWith(html, 'data-slot="result-chip"');
    expect(chips).toHaveLength(5);
    expect(chips.map((chip) => /data-status="([a-z_]+)"/.exec(chip)?.[1])).toEqual([
      "pass",
      "fail",
      "not_done",
      "not_done",
      "not_done",
    ]);
  });

  it("shows no chips without results", () => {
    expect(render()).not.toContain('data-slot="result-chip"');
  });

  it("uses the template's size labels", () => {
    const html = render({ templateSizes: [{ value: "M", label: "Medium" }] });
    expect(html).toContain('<span class="sr-only">Size </span>Medium');
  });

  it("renders every size side by side from 1280 px with wide=all", () => {
    const html = render({ wide: "all" });
    expect(tagsWith(html, 'role="tabpanel"')).toHaveLength(5);
    for (const size of SIZES) expect(html).toContain(`Panel ${size}`);
    expect(tagsWith(html, 'role="tabpanel"').filter((panel) => panel.includes("max-xl:hidden"))).toHaveLength(4);
    expect(tagsWith(html, 'role="tablist"')[0]).not.toContain("xl:hidden");
  });

  it("takes a node as the panel, e.g. a CounterTable given activeColumn", () => {
    const html = render({ children: <p>One table</p> });
    expect(html).toContain("One table");
    expect(tagsWith(html, 'role="tabpanel"')).toHaveLength(1);
  });

  it("falls back to the first size when the value is not ordered", () => {
    const html = render({ value: "XXL" });
    expect(tagsWith(html, 'aria-selected="true"')[0]).toContain('data-size="XS"');
    expect(html).toContain("Panel XS");
  });

  it("says so while no size is ordered", () => {
    const html = render({ sizes: [] });
    expect(html).not.toContain('role="tablist"');
    expect(html).toContain("No sizes ordered yet");
  });

  it("sticks under the screen's own bars and lets the panel scroll vertically", () => {
    const html = render();
    expect(html).toContain("sticky top-[var(--capture-sticky-top,0px)]");
    expect(html).toContain("touch-pan-y");
  });
});

describe("SizeStatusStrip", () => {
  it("lists each size with its result", () => {
    const html = renderToStaticMarkup(<SizeStatusStrip sizes={["XS", "M"]} results={{ XS: "pass", M: "fail" }} />);
    expect(html).toContain('aria-label="Results by size"');
    expect(html).toContain('data-status="pass"');
    expect(html).toContain('data-status="fail"');
    expect(html).not.toContain("<button");
  });

  it("makes each size a button when it can be opened", () => {
    const html = renderToStaticMarkup(<SizeStatusStrip sizes={["XS", "M"]} onSelect={noop} />);
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain('data-status="not_done"');
  });
});

describe("HandToggle", () => {
  it("is a radio group of R and L named in full", () => {
    const html = renderToStaticMarkup(<HandToggle value="L" onValueChange={noop} />);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Hand"');
    const radios = tagsWith(html, 'role="radio"');
    expect(radios).toHaveLength(2);
    expect(radios.find((radio) => radio.includes('aria-checked="true"'))).toContain('aria-label="Left hand"');
    expect(radios.filter((radio) => radio.includes('tabindex="0"'))).toHaveLength(1);
  });

  it("offers Both when asked", () => {
    const html = renderToStaticMarkup(<HandToggle value="both" onValueChange={noop} allowBoth />);
    const radios = tagsWith(html, 'role="radio"');
    expect(radios).toHaveLength(3);
    expect(radios.find((radio) => radio.includes('aria-checked="true"'))).toContain('aria-label="Both hands"');
  });

  it("reads Both as the right hand when Both is not offered", () => {
    const html = renderToStaticMarkup(<HandToggle value="both" onValueChange={noop} />);
    expect(tagsWith(html, 'aria-checked="true"')[0]).toContain('aria-label="Right hand"');
  });

  it("can show its label", () => {
    const html = renderToStaticMarkup(<HandToggle value="R" onValueChange={noop} showLabel label="Hand" />);
    expect(html).toMatch(/<span id="[^"]+"[^>]*>Hand<\/span>/);
    expect(html).toContain("aria-labelledby=");
  });
});

describe("BoxPicker", () => {
  const cartons = [13, 299, 337, 2236];

  it("is a combobox named by its label, showing the box", () => {
    const html = renderToStaticMarkup(
      <BoxPicker label="Box #, item 3" value={337} cartons={cartons} onValueChange={noop} />,
    );
    const trigger = tagsWith(html, 'role="combobox"')[0];
    expect(trigger).toContain('aria-label="Box #, item 3"');
    expect(trigger).toContain('aria-expanded="false"');
    expect(trigger).not.toContain('aria-invalid="');
    expect(html).toContain(">337<");
  });

  it("asks for a box while none is picked", () => {
    const html = renderToStaticMarkup(<BoxPicker label="Box #" value={null} cartons={cartons} onValueChange={noop} />);
    expect(html).toContain(">Pick box<");
  });

  it("flags a stored box that is not in the carton list", () => {
    const html = renderToStaticMarkup(
      <BoxPicker label="Box #, item 12" sizeLabel="size M" value={2336} cartons={cartons} onValueChange={noop} />,
    );
    expect(tagsWith(html, 'role="combobox"')[0]).toContain('aria-invalid="true"');
    expect(html).toContain("Box 2336 is not in the carton list for size M. Pick the box from the list.");
  });

  it("does not flag a typed box while the size has no carton list", () => {
    const html = renderToStaticMarkup(<BoxPicker label="Box #" value={2336} cartons={[]} onValueChange={noop} />);
    expect(tagsWith(html, 'role="combobox"')[0]).not.toContain('aria-invalid="');
    expect(html).not.toContain("is not in the carton list");
  });

  it("keeps the error for screen readers in a table cell", () => {
    const html = renderToStaticMarkup(
      <BoxPicker variant="cell" label="Box #" value={2336} cartons={cartons} onValueChange={noop} />,
    );
    expect(html).toMatch(/<span id="[^"]+" class="sr-only">Box 2336 is not in the carton list/);
  });

  it("is plain text read-only", () => {
    const html = renderToStaticMarkup(
      <BoxPicker readOnly label="Box #" value={2336} cartons={cartons} onValueChange={noop} issuePath={["sizes", "M", "boxes", 11]} />,
    );
    expect(html).not.toContain("<button");
    expect(html).toContain("data-invalid");
    expect(html).toContain('data-issue-path="[&quot;sizes&quot;,&quot;M&quot;,&quot;boxes&quot;,11]"');
  });
});

describe("CounterTable", () => {
  const rows: CounterRow[] = [
    { key: "hole_crotch", label: "Between fingers (crotch)" },
    { key: "hole_palm", label: "Palm" },
    { key: "torn_cuff", label: "Torn cuff", unmapped: true, hint: "One-off" },
  ];
  const columns: CounterColumn[] = [
    { key: "S", label: "S", name: "size S", n: 200, limits: { ac: 7, re: 8 } },
    { key: "M", label: "M", name: "size M", n: 500, limits: { ac: 1, re: 2 } },
  ];
  const counts: Record<string, number> = { "hole_palm|S": 2, "hole_crotch|M": 1, "torn_cuff|M": 1, "hole_palm|M|L": 4 };
  const getCount = ({ row, column, hand }: CounterCell) => counts[[row, column, hand].filter(Boolean).join("|")];
  const render = (props: Partial<Parameters<typeof CounterTable>[0]> = {}) =>
    renderToStaticMarkup(
      <CounterTable
        caption="Freedom from holes"
        rows={rows}
        columns={columns}
        getCount={getCount}
        onCountChange={noop}
        {...props}
      />,
    );

  it("has a stepper per row and column, named by row and column", () => {
    const html = render();
    expect(html).toContain("<caption");
    expect(html.match(/role="spinbutton"/g)).toHaveLength(rows.length * columns.length);
    expect(html).toContain('aria-label="Increase Palm, size S"');
    expect(html).toContain('aria-label="Between fingers (crotch), size M"');
  });

  it("shows n, the limit, the total and a live accept/reject chip per column", () => {
    const html = render({ labels: { accept: "Passed", reject: "Failed" } });
    expect(html).toContain(">200<");
    expect(html).toContain(">500<");
    expect(html).toContain("Ac 7 / Re 8");
    expect(html).toContain("Ac 1 / Re 2");
    // S: 2 of Ac 7 accepts; M: 2 reaches Re 2.
    expect(tagsWith(html, 'data-slot="status-pill"').map((pill) => /data-status="(\w+)"/.exec(pill)?.[1])).toEqual([
      "pass",
      "fail",
    ]);
    expect(html).toContain(">Passed<");
    expect(html).toContain(">Failed<");
  });

  it("lets calc's status win over the live decision", () => {
    const html = render({ columns: [{ ...columns[0], status: "not_done" }] });
    expect(tagsWith(html, 'data-slot="status-pill"')[0]).toContain('data-status="not_done"');
  });

  it("has no limit or result rows without limits", () => {
    const html = render({ columns: [{ key: "1", label: "Box 1" }] });
    expect(html).not.toContain("Defect limit");
    expect(html).not.toContain('data-slot="status-pill"');
    expect(html).toContain("Total defects found");
  });

  it("totals both hands, even with one on screen", () => {
    const html = render({ hands: ["R", "L"], visibleHands: ["R"], columns: [columns[1]] });
    // M: crotch 1 + torn cuff 1 count without a hand; palm L 4 is off screen.
    expect(html).toMatch(/text-base font-bold[^>]*>4</);
    expect(html).toContain('aria-label="Increase Palm, size M, right hand"');
    expect(html).not.toContain("left hand");
  });

  it("splits each column into R and L sharing one total", () => {
    const html = render({ hands: ["R", "L"] });
    expect(html.match(/role="spinbutton"/g)).toHaveLength(rows.length * columns.length * 2);
    expect(html).toContain('colSpan="2"');
    expect(html).toContain('<span class="sr-only">Right hand</span>');
  });

  it("shows only the active column below 1280 px", () => {
    const html = render({ activeColumn: "M" });
    const hiddenCells = (html.match(/max-xl:hidden/g) ?? []).length;
    // Column S: header, n, limit, 3 rows, total, result.
    expect(hiddenCells).toBe(8);
  });

  it("flags one-off labels for an admin", () => {
    const html = render();
    expect(tagsWith(html, 'data-unmapped="true"')).toHaveLength(1);
    expect(html).toContain("(unmapped label)");
    expect(html).toContain("One-off");
  });

  it("offers a one-off defect only with onAddRow", () => {
    expect(render()).not.toContain("Other defect");
    expect(render({ onAddRow: noop })).toContain("Other defect");
    expect(render({ onAddRow: noop, addRowLabel: "Other location" })).toContain("Other location");
  });

  it("renders extra summary rows per column", () => {
    const html = render({
      summaryRows: [{ key: "ratio", label: "Defects / gloves", render: (_, total) => `${total}/125` }],
    });
    expect(html).toContain("Defects / gloves");
    expect(html).toContain("2/125");
    expect(html.match(/>2\/125</g)).toHaveLength(2);
  });

  it("marks cells for issue links", () => {
    const html = render({ cellIssuePath: ({ column, row }) => ["sizes", column, "holes", row] });
    expect(html).toContain('data-issue-path="[&quot;sizes&quot;,&quot;M&quot;,&quot;holes&quot;,&quot;hole_palm&quot;]"');
  });

  it("shows plain counts read-only", () => {
    const html = render({ readOnly: true, onAddRow: noop });
    expect(html).not.toContain('role="spinbutton"');
    expect(html).not.toContain("Other defect");
    expect(html).toMatch(/font-semibold tabular-nums">2</);
  });
});

describe("NumberField", () => {
  it("labels a decimal field with its unit and hint", () => {
    const html = renderToStaticMarkup(
      <NumberField id="tensile" label="Tensile Strength (Average)" unit="MPa" hint="From the lab report" value={15.2} decimals={2} onValueChange={noop} />,
    );
    expect(html).toContain('for="tensile"');
    expect(html).toContain('id="tensile"');
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('value="15.20"');
    expect(html).toContain(">MPa<");
    expect(html).toContain("From the lab report");
    expect(html).toMatch(/aria-describedby="tensile-hint tensile-unit"/);
    expect(html).toContain('enterKeyHint="done"');
  });

  it("shows calc's error below and describes the field with it", () => {
    const html = renderToStaticMarkup(
      <NumberField id="weight" label="Weight" unit="g" value={2.56} error="More than 10% from the indicative 3.2 g." onValueChange={noop} />,
    );
    expect(html).toContain("More than 10% from the indicative 3.2 g.");
    expect(html).toContain('aria-describedby="weight-calc-error weight-unit"');
    expect(html).toContain("border-destructive");
  });

  it("names a table cell for screen readers, with its unit", () => {
    const html = renderToStaticMarkup(
      <NumberField variant="cell" label="Weight, glove 3" unit="g" value={null} onValueChange={noop} />,
    );
    expect(html).toContain('aria-label="Weight, glove 3 (g)"');
    expect(html).toContain('data-variant="cell"');
  });

  it("adds the unit to a cell's name only where the label does not already name it", () => {
    expect(labelText("Weight, glove 3", "g")).toBe("Weight, glove 3 (g)");
    expect(labelText("Weight (g)", "g")).toBe("Weight (g)");
    expect(labelText("Length", "mm")).toBe("Length (mm)");
    expect(labelText("Layering %, item 1", "%")).toBe("Layering %, item 1");
    expect(labelText("Tensile", undefined)).toBe("Tensile");
    expect(labelText(<b>Tensile</b>, "MPa")).toBeUndefined();
  });

  it("joins an Enter run inside an EnterGroup", () => {
    const html = renderToStaticMarkup(
      <EnterGroup>
        <NumberField label="A" value={null} onValueChange={noop} />
        <NumberField label="B" group="layering" value={null} onValueChange={noop} />
      </EnterGroup>,
    );
    expect(html).toContain("data-enter-scope");
    expect(html.match(/data-enter-field=""/g)).toHaveLength(2);
    expect(html).toContain('data-enter-group="layering"');
    expect(html.match(/enterKeyHint="next"/g)).toHaveLength(2);
  });

  it("is read-only on grey", () => {
    const html = renderToStaticMarkup(<NumberField label="Weight" value={3.18} readOnly onValueChange={noop} />);
    expect(html).toContain("readOnly");
  });

  it("makes a PercentField a 0 to 100 field with %", () => {
    const html = renderToStaticMarkup(<PercentField label="Layering" value={88} onValueChange={noop} />);
    expect(html).toContain(">%<");
    expect(html).toContain('value="88"');
  });
});

describe("EntryProblems", () => {
  it("lists rejected entries with a link to each cell", () => {
    const html = renderToStaticMarkup(
      <EntryProblems
        problems={[
          { key: "a", label: "Item 4, Layering %", inputId: "layering-4", entry: { raw: "2 42", error: "One number per cell." } },
        ]}
      />,
    );
    expect(html).toContain("<button");
    expect(html).toContain("Item 4, Layering %");
    expect(html).toContain("“2 42” is not stored. One number per cell.");
  });

  it("renders nothing without problems", () => {
    expect(renderToStaticMarkup(<EntryProblems problems={[]} />)).toBe("");
  });
});

describe("RequirementList", () => {
  const html = renderToStaticMarkup(
    <RequirementList
      caption="Physical properties, size M"
      labels={{ value: "Average", spec: "Spec. (ASTM D6319)", result: "Passed / Failed" }}
      items={[
        { key: "tensile", label: "Tensile Strength (MPa)", value: 15.2, unit: "MPa", decimals: 2, spec: { kind: "min", min: 14 } },
        { key: "elongation", label: "Elongation at break (%)", value: 480, unit: "%", decimals: 0, spec: { kind: "min", min: 500 } },
        { key: "weight", label: "Weight (g)", value: 2.9, unit: "g", decimals: 2, spec: { kind: "na" } },
        { key: "force", label: "Force at break (N)", value: null, unit: "N", spec: { kind: "min", min: 6 } },
        { key: "rate", label: "Defects / gloves", value: 0.48, valueText: "3 / 625 (0.48%)", spec: { kind: "max", max: 5 }, unit: "%" },
      ]}
    />,
  );

  it("is a captioned table in the template's wording", () => {
    expect(html).toContain('<caption class="sr-only">Physical properties, size M</caption>');
    expect(html).toContain("Spec. (ASTM D6319)");
    expect(html).toContain("Passed / Failed");
  });

  it("prints values and specs at the template's decimals", () => {
    expect(html).toContain("15.20");
    expect(html).toContain("≥ 14.00 MPa");
    expect(html).toContain("≥ 500%");
    expect(html).toContain("3 / 625 (0.48%)");
    expect(html).toContain("≤ 5%");
  });

  it("judges each value: pass, fail, NA without a limit, not done without a value", () => {
    expect(tagsWith(html, "data-outcome=").map((row) => /data-outcome="(\w+)"/.exec(row)?.[1])).toEqual([
      "pass",
      "fail",
      "na",
      "not_done",
      "pass",
    ]);
    expect(html).toContain(">NA<");
  });

  it("folds the spec under the value in a narrow container", () => {
    expect(html).toContain("@container");
    expect(html).toContain("Spec. (ASTM D6319) ≥ 14.00 MPa");
  });
});

describe("SpecValue", () => {
  it("puts value, spec and result on one line", () => {
    const html = renderToStaticMarkup(
      <SpecValue label="Force at break, median" value={6.537} decimals={3} unit="N" spec={{ kind: "min", min: 6 }} />,
    );
    expect(html).toContain("6.537");
    expect(html).toContain("Spec. ≥ 6.000 N");
    expect(html).toContain('data-status="pass"');
  });

  it("does not repeat NA as a result", () => {
    const html = renderToStaticMarkup(<SpecValue value={2.9} decimals={2} unit="g" spec={{ kind: "na" }} />);
    expect(html.match(/NA/g)).toHaveLength(1);
    expect(html).not.toContain('data-slot="status-pill"');
  });
});

describe("ModuleSection", () => {
  it("is a section named by its heading in the template's wording", () => {
    const html = renderToStaticMarkup(
      <ModuleSection title="Major Defects (AQL 2.5)" description="Accept 7 / Reject 8" status="pass" issuePath={["major"]}>
        <p>Body</p>
      </ModuleSection>,
    );
    const headingId = /<h3 id="([^"]+)"/.exec(html)?.[1];
    expect(headingId).toBeTruthy();
    expect(html).toContain(`aria-labelledby="${headingId}"`);
    expect(html).toContain("Major Defects (AQL 2.5)");
    expect(html).toContain("Accept 7 / Reject 8");
    expect(html).toContain('data-status="pass"');
    expect(html).toContain('data-issue-path="[&quot;major&quot;]"');
  });

  it("can sit one level deeper", () => {
    expect(renderToStaticMarkup(<ModuleSection title="R" headingLevel={4} />)).toContain("<h4");
  });
});

describe("Figure", () => {
  it("prints a computed number with tabular figures and its unit", () => {
    const html = renderToStaticMarkup(<Figure value={2.9} decimals={2} unit="g" />);
    expect(html).toContain("tabular-nums");
    expect(html).toContain("2.90");
    expect(html).toContain("> g<");
  });

  it("attaches % and shows a dash, spoken as No value, for nothing", () => {
    expect(renderToStaticMarkup(<Figure value={88} unit="%" />)).toContain(">%<");
    const empty = renderToStaticMarkup(<Figure value={null} unit="g" />);
    expect(empty).toContain('<span aria-hidden="true">—</span>');
    expect(empty).toContain("No value");
  });
});
