// Server-rendered markup of the capture kit: accessible names, states,
// computed totals and decisions, read-only forms. The rules behind them are
// in kit-logic.test.ts; pointer, key and paste handling were exercised in a
// browser at iPad and desktop sizes (docs/CAPTURE_KIT.md).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AttachmentStatus } from "./attachment-status";
import { BoxPicker } from "./box-picker";
import { ColumnSwitcher } from "./column-switcher";
import { CounterTable, type CounterColumn, type CounterRow } from "./counter-table";
import { DateField } from "./date-field";
import type { CounterCell } from "./counter-model";
import { Figure } from "./figure";
import { HandToggle } from "./hand-toggle";
import { ModuleSection } from "./module-section";
import { PasteNotice } from "./paste-notice";
import { EnterGroup, EntryProblems, labelText, NumberField, PercentField } from "./number-field";
import { RequirementList, SpecValue } from "./requirement-list";
import { SideBySideText, SizeBlock } from "./size-block";
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

  it("points aria-controls only at panels that are rendered", () => {
    const tabsMode = tagsWith(render(), 'role="tab"');
    expect(tabsMode.filter((tab) => tab.includes("aria-controls="))).toHaveLength(1);
    expect(tabsMode.find((tab) => tab.includes("aria-controls="))).toContain('aria-selected="true"');
    // Side by side every panel is rendered (hidden below 1280 px but the active one).
    const sideBySide = tagsWith(render({ wide: "all" }), 'role="tab"');
    expect(sideBySide.filter((tab) => tab.includes("aria-controls="))).toHaveLength(5);
  });

  it("lets headers inside stick below its bar", () => {
    const html = render();
    expect(html).toContain("[--size-tabs-bar:calc(3.5rem_+_1px)]");
    expect(html).toContain("touch:[--size-tabs-bar:calc(4.25rem_+_1px)]");
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
    expect(tagsWith(html, "<button").every((button) => button.includes("touch:text-base") && button.includes("focus-ring"))).toBe(
      true,
    );
  });
});

describe("HandToggle", () => {
  it("is a radio group of Right and Left named in full", () => {
    const html = renderToStaticMarkup(<HandToggle value="L" onValueChange={noop} />);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Hand"');
    const radios = tagsWith(html, 'role="radio"');
    expect(radios).toHaveLength(2);
    expect(radios.find((radio) => radio.includes('aria-checked="true"'))).toContain('aria-label="Left hand"');
    expect(radios.filter((radio) => radio.includes('tabindex="0"'))).toHaveLength(1);
  });

  it("shows words, never a lone L that reads like size L", () => {
    const html = renderToStaticMarkup(<HandToggle value="R" onValueChange={noop} allowBoth />);
    expect(html).toMatch(/>Right<\/button>/);
    expect(html).toMatch(/>Left<\/button>/);
    expect(html).toMatch(/>Both<\/button>/);
    expect(html).not.toMatch(/>L<\/button>/);
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

  it("words the limit row as the template does, Ac and Re only as the fallback", () => {
    const html = render({ labels: { limits: "Defect Limit", limitAccept: "Accept", limitReject: "Reject" } });
    expect(html).toContain("Accept 7 / Reject 8");
    expect(html).toContain("Accept 1 / Reject 2");
    expect(html).not.toContain("Ac 7");
    expect(render({ labels: { limitAccept: "Acc. =", limitReject: "Rej. =" } })).toContain("Acc. = 1 / Rej. = 2");
    // The chip keeps its own words.
    expect(html).toContain(">Accept<");
  });

  it("wraps long limit wording after the slash, never before it, and reads it in one piece", () => {
    const html = render({ labels: { limitAccept: "Accept", limitReject: "Reject" } });
    // Two halves that each stay on one line, so the column keeps its width and no line starts with "/".
    expect(html).toContain(
      '<span class="sr-only">Accept 7 / Reject 8</span><span aria-hidden="true" class="whitespace-nowrap">Accept 7 /</span> <span aria-hidden="true" class="whitespace-nowrap">Reject 8</span>',
    );
    expect(tagsWith(html, 'aria-hidden="true" class="whitespace-nowrap"')).toHaveLength(4);
    expect(html).not.toContain("text-balance");
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

  it("splits each column into Right and Left sharing one total", () => {
    const html = render({ hands: ["R", "L"] });
    expect(html.match(/role="spinbutton"/g)).toHaveLength(rows.length * columns.length * 2);
    expect(html).toContain('colSpan="2"');
    // Words under the size, so size L over the left hand never reads "L" over "L".
    expect(html).toContain('Right<span class="sr-only"> hand</span>');
    expect(html).toContain('Left<span class="sr-only"> hand</span>');
  });

  it("shows only the active column below 1280 px", () => {
    const html = render({ activeColumn: "M" });
    const hiddenCells = (html.match(/max-xl:hidden/g) ?? []).length;
    // Column S: header, n, limit, 3 rows, total, result.
    expect(hiddenCells).toBe(8);
  });

  it("shows the first column for an active column that is not one", () => {
    const html = render({ activeColumn: "XXL" });
    const heading = (label: string) => new RegExp(`<th[^>]*scope="col"[^>]*>${label}</th>`).exec(html)?.[0] ?? "";
    expect(heading("S")).not.toContain("hidden");
    expect(heading("M")).toContain("max-xl:hidden");
    expect((html.match(/max-xl:hidden/g) ?? []).length).toBe(8);
  });

  it("says each tap itself, with the total and verdict, instead of the stepper", () => {
    const html = render();
    // One polite region for the table; the steppers inside stay quiet.
    expect(html.match(/aria-live="polite"/g)).toHaveLength(1);
  });

  it("keeps labels next to their steppers: a fixed label column, a table only as wide as its columns", () => {
    const html = render();
    expect(tagsWith(html, 'scope="row"')[0]).toContain("w-64");
    expect(html).toContain("w-fit max-w-full");
  });

  it("gives n and the limit 16 px text on touch", () => {
    const html = render();
    const info = tagsWith(html, "font-medium text-muted-foreground tabular-nums");
    expect(info.length).toBeGreaterThan(0);
    expect(info.every((tag) => tag.includes("touch:text-base"))).toBe(true);
  });

  it("flags one-off labels for an admin", () => {
    const html = render();
    expect(tagsWith(html, 'data-unmapped="true"')).toHaveLength(1);
    expect(html).toContain("(unmapped label)");
    expect(html).toContain("One-off");
  });

  it("offers to take off a one-off row the inspector added, only while it counts nothing", () => {
    const added: CounterRow[] = [...rows, { key: "unmapped:near thumb", label: "Near thumb", unmapped: true, removable: true }];
    const html = render({ rows: added, onRemoveRow: noop, onAddRow: noop });
    expect(html).toContain('aria-label="Remove Near thumb"');
    // Torn cuff counts 1 in size M; it is not removable anyway.
    expect(html).not.toContain('aria-label="Remove Torn cuff"');
    const counted = render({ rows: [...rows.slice(0, 2), { ...rows[2], removable: true }], onRemoveRow: noop });
    expect(counted).not.toContain("Remove Torn cuff");
    expect(render({ rows: added, onRemoveRow: noop, readOnly: true })).not.toContain("Remove Near thumb");
    expect(render({ rows: added })).not.toContain("Remove Near thumb");
  });

  it("puts a column's own heading, such as its box picker, over the column", () => {
    const html = render({ columns: [{ ...columns[0], heading: <button type="button">Pick box</button> }, columns[1]] });
    expect(html).toMatch(/<th[^>]*scope="col"[^>]*><button type="button">Pick box<\/button><\/th>/);
    // The label still names the column's steppers.
    expect(html).toContain('aria-label="Increase Palm, size S"');
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

describe("CounterTable inside SizeTabs", () => {
  const rows: CounterRow[] = [{ key: "palm", label: "Palm" }];
  const columns: CounterColumn[] = ["S", "M"].map((key) => ({ key, label: key, name: `Size ${key}`, limits: { ac: 1, re: 2 } }));
  const render = (wide: "tabs" | "all", value: string) =>
    renderToStaticMarkup(
      <SizeTabs sizes={["S", "M"]} value={value} onValueChange={noop} wide={wide}>
        <CounterTable
          caption="Holes"
          rows={rows}
          columns={columns}
          activeColumn={value}
          getCount={() => 0}
          onCountChange={noop}
        />
      </SizeTabs>,
    );
  const heading = (html: string, label: string) =>
    new RegExp(`<th[^>]*scope="col"[^>]*>${label}</th>`).exec(html)?.[0] ?? "";

  it("shows the size the tabs show, even while the module's value is not ordered", () => {
    const html = render("tabs", "XXL");
    expect(tagsWith(html, 'aria-selected="true"')[0]).toContain('data-size="S"');
    expect(heading(html, "S")).not.toContain("hidden");
    expect(heading(html, "M")).toContain("hidden");
  });

  it("keeps one size at every width when SizeTabs keeps its tabs", () => {
    const html = render("tabs", "M");
    expect(heading(html, "S")).toMatch(/class="[^"]*(?<![\w:-])hidden/);
    expect(heading(html, "S")).not.toContain("max-xl:hidden");
  });

  it("goes side by side from 1280 px with wide=all", () => {
    expect(heading(render("all", "M"), "S")).toContain("max-xl:hidden");
  });

  it("shows its own columns in a per-size function panel", () => {
    const html = renderToStaticMarkup(
      <SizeTabs sizes={["S", "M"]} value="M" onValueChange={noop}>
        {(size) => (
          <CounterTable
            caption="Boxes"
            rows={rows}
            columns={[{ key: "253", label: "Box 253" }, { key: "1102", label: "Box 1102" }]}
            activeColumn={size === "M" ? "1102" : "253"}
            getCount={() => 0}
            onCountChange={noop}
          />
        )}
      </SizeTabs>,
    );
    // Not following the tabs: no sticky header, and it may scroll sideways from 1280 px.
    expect(/<thead[^>]*>/.exec(html)?.[0]).not.toContain("sticky");
    expect(html).toContain("overflow-clip xl:overflow-x-auto");
  });

  it("never scrolls sideways, so its header sticks below the size bar and its totals to the bottom", () => {
    const html = render("tabs", "M");
    expect(html).toContain("overflow-clip");
    expect(html).not.toContain("xl:overflow-x-auto");
    expect(/<thead[^>]*>/.exec(html)?.[0]).toContain(
      "sticky top-[calc(var(--capture-sticky-top,0px)_+_var(--size-tabs-bar,0px))]",
    );
    expect(/<tfoot[^>]*>/.exec(html)?.[0]).toContain("sticky bottom-[var(--capture-sticky-bottom,0px)]");
  });
});

describe("ColumnSwitcher", () => {
  const render = (props: Partial<Parameters<typeof ColumnSwitcher>[0]> = {}) =>
    renderToStaticMarkup(
      <ColumnSwitcher count={5} index={1} onIndexChange={noop} current="Box 253" previousLabel="Previous box" nextLabel="Next box" {...props} />,
    );

  it("says which column is on screen, between Previous and Next, and hides from 1280 px", () => {
    const html = render();
    expect(html).toContain("Box 253 · 2 / 5");
    expect(html).toContain('aria-label="Previous box"');
    expect(html).toContain('aria-label="Next box"');
    expect(html).toMatch(/aria-live="polite"/);
    expect(tagsWith(html, 'data-slot="column-switcher"')[0]).toContain("xl:hidden");
    expect(tagsWith(render({ alwaysShown: true }), 'data-slot="column-switcher"')[0]).not.toContain("xl:hidden");
  });

  it("keeps its buttons focusable at the ends, marked disabled rather than removed", () => {
    const first = render({ index: 0 });
    expect(tagsWith(first, 'aria-label="Previous box"')[0]).toContain('aria-disabled="true"');
    expect(first).not.toMatch(/<button[^>]*disabled=""/);
    expect(tagsWith(render({ index: 4 }), 'aria-label="Next box"')[0]).toContain('aria-disabled="true"');
  });

  it("shows nothing for a single column", () => {
    expect(render({ count: 1, index: 0 })).toBe("");
  });
});

describe("SizeBlock and SideBySideText", () => {
  const render = (wide: "tabs" | "all", value: string, node = true) =>
    renderToStaticMarkup(
      <SizeTabs sizes={["S", "M"]} value={value} onValueChange={noop} wide={wide}>
        {node
          ? ["S", "M"].map((size) => (
              <SizeBlock key={size} size={size} className="space-y-2">
                Tested<SideBySideText>, size {size}</SideBySideText>
              </SizeBlock>
            ))
          : (size: string) => <SizeBlock size={size}>Panel {size}</SizeBlock>}
      </SizeTabs>,
    );
  const block = (html: string, size: string) => tagsWith(html, `data-size="${size}"[^>]*data-slot="size-block"|data-slot="size-block"[^>]*data-size="${size}"`)[0] ?? "";

  it("shows the size on the tabs, and the others from 1280 px while the sizes sit side by side", () => {
    const html = render("all", "M");
    expect(block(html, "M")).not.toContain("hidden");
    expect(block(html, "S")).toContain("max-xl:hidden");
    expect(block(html, "S")).toContain("space-y-2");
    expect(html).toContain('<span class="sr-only xl:not-sr-only">, size S</span>');
  });

  it("follows the tabs, not a stale value, and keeps one size where SizeTabs keeps its tabs", () => {
    const html = render("tabs", "XXL");
    expect(block(html, "S")).not.toContain("hidden");
    expect(block(html, "M")).toMatch(/class="[^"]*(?<![\w:-])hidden/);
    expect(block(html, "M")).not.toContain("max-xl:hidden");
    expect(html).toContain('<span class="sr-only">, size M</span>');
  });

  it("is always shown in a per-size function panel or outside SizeTabs", () => {
    expect(block(render("tabs", "M", false), "M")).not.toContain("hidden");
    expect(renderToStaticMarkup(<SizeBlock size="M">Alone</SizeBlock>)).not.toContain("hidden");
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

  it("shows calc's warnings in amber below, one line each, and describes the field with them", () => {
    const html = renderToStaticMarkup(
      <NumberField
        id="tested"
        label="No. of sample tested"
        value={315}
        warning={["315 is below the plan's 500.", "Too small for AQL 0.65."]}
        onValueChange={noop}
      />,
    );
    expect(html).toContain('aria-describedby="tested-calc-warning"');
    const block = /<div id="tested-calc-warning"[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
    expect(block).toContain("text-warn");
    expect(block.match(/<p /g)).toHaveLength(2);
    expect(block.match(/lucide-triangle-alert/g)).toHaveLength(2);
    expect(html).toContain("border-warn-solid");
    expect(html).not.toMatch(/[\s"]border-destructive[\s"]/);
  });

  it("puts an error before the warnings, and its red edge wins", () => {
    const html = renderToStaticMarkup(
      <NumberField id="w" label="Weight" value={0} error="Must be more than 0 g." warning="Far from the indicative weight." onValueChange={noop} />,
    );
    expect(html).toContain('aria-describedby="w-calc-error w-calc-warning"');
    expect(html).toMatch(/[\s"]border-destructive[\s"]/);
    expect(html).not.toContain("border-warn-solid");
  });

  it("keeps a warning in a cell for screen readers, on an amber tint", () => {
    const html = renderToStaticMarkup(
      <NumberField id="q" variant="cell" label="Qty, size M" value={12} warning="More than ordered." onValueChange={noop} />,
    );
    expect(html).toContain('<span id="q-calc-warning" class="sr-only">More than ordered.</span>');
    expect(html).toContain("bg-warn-tint");
  });

  it("names a table cell for screen readers, with its unit", () => {
    const html = renderToStaticMarkup(
      <NumberField variant="cell" label="Weight, glove 3" unit="g" value={null} onValueChange={noop} />,
    );
    expect(html).toContain('aria-label="Weight, glove 3 (g)"');
    expect(html).toContain('data-variant="cell"');
  });

  it("names a cell with a hidden label when its label is not plain text", () => {
    const html = renderToStaticMarkup(
      <NumberField id="layering-3" variant="cell" label={<b>Layering</b>} unit="%" value={null} onValueChange={noop} />,
    );
    expect(html).toContain('<label for="layering-3" class="sr-only"><b>Layering</b> (%)</label>');
    expect(tagsWith(html, 'id="layering-3"')[0]).not.toContain("aria-label=");
  });

  it("uses 16 px hints and errors on touch", () => {
    const html = renderToStaticMarkup(
      <NumberField label="Weight" hint="From the scale" error="Too heavy." value={9} onValueChange={noop} />,
    );
    expect(tagsWith(html, 'id="').filter((tag) => tag.startsWith("<p")).every((tag) => tag.includes("touch:text-base"))).toBe(
      true,
    );
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

describe("AttachmentStatus", () => {
  // calc's message, worded by the framework's missingFileMessage.
  const MISSING =
    "Lab report: the file attached here is not among this inspection's files. It may still be uploading from another device; if it was deleted, attach it again.";
  const MISSING_HTML = MISSING.replaceAll("'", "&#x27;");

  it("says the file is attached, by name where the screen knows it, and takes an issue link's focus", () => {
    const html = renderToStaticMarkup(
      <AttachmentStatus label="Lab report" state="attached" fileName="lab-0001.pdf" issuePath={["labReport"]} />,
    );
    const line = tagsWith(html, 'data-slot="attachment-status"')[0];
    expect(line).toContain('data-state="attached"');
    expect(line).toContain('data-attached="true"');
    expect(line).toContain('data-issue-path="[&quot;labReport&quot;]"');
    // No control of its own: the line is the notice an issue link lands on.
    expect(line).toContain('tabindex="-1"');
    expect(line).toContain("focus-ring");
    expect(html).toContain(">lab-0001.pdf<");
    expect(renderToStaticMarkup(<AttachmentStatus label="Lab report" state="attached" />)).toContain(">Attached<");
  });

  it("reads Not done for a required file that is not attached, and says why", () => {
    const html = renderToStaticMarkup(<AttachmentStatus label="Lab report" state="none" required />);
    expect(tagsWith(html, 'data-slot="status-pill"')[0]).toContain('data-status="not_done"');
    expect(html).toContain(">Not attached<");
    expect(html).toContain("Required before this section is done.");
  });

  it("is a plain line for an optional file that is not attached", () => {
    const html = renderToStaticMarkup(<AttachmentStatus label="Lab report" state="none" />);
    expect(html).not.toContain('data-slot="status-pill"');
    expect(html).toContain(">Not attached<");
    expect(html).not.toContain("text-warn");
  });

  it("never reads Attached for a kept file that is not among the inspection's files: calc's warning in amber", () => {
    const html = renderToStaticMarkup(<AttachmentStatus label="Lab report" state="missing" warning={MISSING} />);
    const line = tagsWith(html, 'data-slot="attachment-status"')[0];
    expect(line).toContain('data-state="missing"');
    expect(line).not.toContain("data-attached");
    expect(html).not.toContain(">Attached<");
    expect(html).toContain(">Not attached<");
    expect(html).toContain("lucide-file-x");
    expect(tagsWith(html, "text-warn")).toHaveLength(1);
    expect(html).toContain(MISSING_HTML);
    // Before calc's message arrives, the line still says what happened.
    expect(renderToStaticMarkup(<AttachmentStatus label="Lab report" state="missing" />)).toContain(
      "not among this inspection&#x27;s files. It may still be uploading from another device",
    );
    // A required one is Not done, and the warning says why in place of the requirement.
    const required = renderToStaticMarkup(<AttachmentStatus label="Lab report" state="missing" required warning={MISSING} />);
    expect(tagsWith(required, 'data-slot="status-pill"')[0]).toContain('data-status="not_done"');
    expect(required).toContain(MISSING_HTML);
    expect(required).not.toContain("Required before this section is done.");
  });

  it("still takes the yes-or-no `attached` of its first version", () => {
    const attached = renderToStaticMarkup(<AttachmentStatus label="Lab report" attached />);
    expect(tagsWith(attached, 'data-slot="attachment-status"')[0]).toContain('data-state="attached"');
    const none = renderToStaticMarkup(<AttachmentStatus label="Lab report" attached={false} required />);
    expect(tagsWith(none, 'data-slot="attachment-status"')[0]).toContain('data-state="none"');
    expect(none).toContain("Required before this section is done.");
  });
});

describe("DateField", () => {
  it("is a labelled date picker that keeps four-digit years (6.2 rule 3)", () => {
    const html = renderToStaticMarkup(<DateField id="expiry" label="Expiry date" value="2030-03-01" onValueChange={noop} />);
    expect(html).toContain('<label data-slot="label"');
    expect(html).toContain('for="expiry"');
    const input = tagsWith(html, 'id="expiry"')[0];
    expect(input).toContain('type="date"');
    expect(input).toContain('max="9999-12-31"');
    expect(input).toContain('value="2030-03-01"');
    expect(tagsWith(renderToStaticMarkup(<DateField label="Date" value={null} onValueChange={noop} />), 'type="date"')[0]).toContain(
      'value=""',
    );
  });

  it("shows calc's warning in amber, describing the date, and marks itself for issue links", () => {
    const html = renderToStaticMarkup(
      <DateField
        id="expiry"
        label="Expiry date"
        value="2025-03-01"
        warning="Expiry date 2025-03-01 is not after Manufacturing date 2025-04-01."
        issuePath={["expiryDate"]}
        onValueChange={noop}
      />,
    );
    expect(tagsWith(html, 'id="expiry"')[0]).toContain('aria-describedby="expiry-calc-warning"');
    expect(html).toMatch(/id="expiry-calc-warning"[^>]*text-warn/);
    expect(html).toContain('data-issue-path="[&quot;expiryDate&quot;]"');
  });

  it("passes the input's own attributes through, read-only included", () => {
    const html = renderToStaticMarkup(
      <DateField id="d" label="Date" value="2025-04-11" readOnly enterKeyHint="next" data-header-field="" onValueChange={noop} />,
    );
    const input = tagsWith(html, 'id="d"')[0];
    expect(input).toContain('readOnly=""');
    expect(input).toContain('enterKeyHint="next"');
    expect(input).toContain('data-header-field=""');
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

  it("words an entry as the grid does, quoting it once", () => {
    const entry = { raw: "2 42", error: "One number per cell: remove the space (“2 42” → 242)." };
    const html = renderToStaticMarkup(<EntryProblems problems={[{ key: "a", label: "Weight, No. 3", entry }]} />);
    expect(html).toContain("Weight, No. 3</span>: “2 42” is not stored. One number per cell: remove the space (242).");
  });

  it("renders nothing without problems", () => {
    expect(renderToStaticMarkup(<EntryProblems problems={[]} />)).toBe("");
  });
});

describe("PasteNotice", () => {
  it("says on screen, in amber, which pasted values were not stored, with Dismiss described by it", () => {
    const html = renderToStaticMarkup(<PasteNotice leftOut={{ pastEnd: ["7.1", "7.2"], otherColumns: 0 }} onDismiss={noop} />);
    expect(html).toMatch(/data-slot="paste-notice" data-variant="box" class="[^"]*bg-warn-tint[^"]*text-warn/);
    expect(html).toContain("2 pasted values did not fit and were not stored: “7.1” and “7.2”.");
    expect(html).toContain("lucide-triangle-alert");
    const messages = /<div id="([^"]+)"[^>]*><p>2 pasted values/.exec(html)?.[1];
    expect(messages).toBeTruthy();
    expect(html).toMatch(new RegExp(`<button[^>]*aria-describedby="${messages}"[^>]*>Dismiss</button>`));
    // Not a live region: the field's or grid's own live region has said it already.
    expect(html).not.toContain("aria-live");
  });

  it("runs across the foot of a frame as a strip, 16 px on touch", () => {
    const html = renderToStaticMarkup(
      <PasteNotice variant="strip" leftOut={{ pastEnd: [], otherColumns: 2 }} onDismiss={noop} />,
    );
    const classes = /data-variant="strip" class="([^"]*)"/.exec(html)?.[1].split(" ") ?? [];
    expect(classes).toEqual(expect.arrayContaining(["col-span-full", "border-t", "border-warn-border", "touch:text-base"]));
    expect(classes).not.toContain("rounded-lg");
    expect(html).toContain("Only the first column is used here: 2 values from other columns were not stored.");
  });

  it("renders nothing when nothing was left out", () => {
    expect(renderToStaticMarkup(<PasteNotice leftOut={{ pastEnd: [], otherColumns: 0 }} onDismiss={noop} />)).toBe("");
  });

  it("is not there before a paste: an EnterGroup and its fields show none", () => {
    const html = renderToStaticMarkup(
      <EnterGroup>
        <NumberField label="Qty, size M" variant="cell" value={null} onValueChange={noop} />
        <NumberField label="Qty, size L" value={12} onValueChange={noop} />
      </EnterGroup>,
    );
    expect(html).not.toContain("paste-notice");
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

  it("gives the result pills 16 px text on touch", () => {
    const pills = tagsWith(html, 'data-slot="status-pill"');
    expect(pills.length).toBeGreaterThan(0);
    expect(pills.every((pill) => pill.includes("touch:text-base"))).toBe(true);
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

  it("prints a computed value without binary noise", () => {
    expect(renderToStaticMarkup(<Figure value={0.1 + 0.2} />)).toContain(">0.3<");
    expect(renderToStaticMarkup(<Figure value={(2.9 + 3.1 + 2.8) / 3} unit="g" />)).toContain(">2.93333333333<");
  });

  it("attaches % and shows a dash, spoken as No value, for nothing", () => {
    expect(renderToStaticMarkup(<Figure value={88} unit="%" />)).toContain(">%<");
    const empty = renderToStaticMarkup(<Figure value={null} unit="g" />);
    expect(empty).toContain('<span aria-hidden="true">—</span>');
    expect(empty).toContain("No value");
  });
});
