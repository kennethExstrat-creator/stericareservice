import { describe, expect, it } from "vitest";
import {
  applyPaste,
  caretOf,
  cellKey,
  judgeOverflow,
  labelColumnWidth,
  overflowNotStored,
  pasteOverflow,
  planPaste,
  targetCell,
  type PastePlan,
} from "./grid-navigation";

const size = { rows: 13, cols: 5 };

describe("caretOf", () => {
  it("treats an empty cell and a fully selected cell as 'all'", () => {
    expect(caretOf(0, 0, 0)).toBe("all");
    expect(caretOf(0, 3, 3)).toBe("all");
  });

  it("finds the edges and the middle", () => {
    expect(caretOf(0, 0, 3)).toBe("start");
    expect(caretOf(3, 3, 3)).toBe("end");
    expect(caretOf(1, 1, 3)).toBe("middle");
    expect(caretOf(1, 2, 3)).toBe("middle");
  });
});

describe("targetCell", () => {
  it("moves Enter to the next row in the same column", () => {
    expect(targetCell("Enter", false, { row: 3, col: 1 }, size, "all")).toEqual({ row: 4, col: 1 });
  });

  it("wraps Enter from the last row to the top of the next column", () => {
    expect(targetCell("Enter", false, { row: 12, col: 1 }, size, "all")).toEqual({ row: 0, col: 2 });
    expect(targetCell("Enter", false, { row: 12, col: 4 }, size, "all")).toBeNull();
  });

  it("walks Shift+Enter backwards", () => {
    expect(targetCell("Enter", true, { row: 3, col: 1 }, size, "all")).toEqual({ row: 2, col: 1 });
    expect(targetCell("Enter", true, { row: 0, col: 1 }, size, "all")).toEqual({ row: 12, col: 0 });
    expect(targetCell("Enter", true, { row: 0, col: 0 }, size, "all")).toBeNull();
  });

  it("moves up and down within the grid", () => {
    expect(targetCell("ArrowDown", false, { row: 0, col: 0 }, size, "middle")).toEqual({ row: 1, col: 0 });
    expect(targetCell("ArrowUp", false, { row: 0, col: 0 }, size, "all")).toBeNull();
    expect(targetCell("ArrowDown", false, { row: 12, col: 0 }, size, "all")).toBeNull();
  });

  it("leaves left and right to the text unless the caret is at that edge", () => {
    expect(targetCell("ArrowLeft", false, { row: 2, col: 2 }, size, "middle")).toBeNull();
    expect(targetCell("ArrowLeft", false, { row: 2, col: 2 }, size, "end")).toBeNull();
    expect(targetCell("ArrowLeft", false, { row: 2, col: 2 }, size, "start")).toEqual({ row: 2, col: 1 });
    expect(targetCell("ArrowRight", false, { row: 2, col: 2 }, size, "end")).toEqual({ row: 2, col: 3 });
    expect(targetCell("ArrowRight", false, { row: 2, col: 2 }, size, "all")).toEqual({ row: 2, col: 3 });
    expect(targetCell("ArrowRight", false, { row: 2, col: 4 }, size, "all")).toBeNull();
  });

  it("ignores other keys", () => {
    expect(targetCell("Tab", false, { row: 0, col: 0 }, size, "all")).toBeNull();
    expect(targetCell("5", false, { row: 0, col: 0 }, size, "all")).toBeNull();
  });
});

describe("planPaste", () => {
  it("leaves a single value to the input", () => {
    expect(planPaste("243", { row: 0, col: 0 }, size)).toBeNull();
    expect(planPaste("243\n", { row: 0, col: 0 }, size)).toBeNull();
  });

  it("fills a pasted column down from the focused cell", () => {
    const plan = planPaste("243\n245\r\n 242 \n", { row: 4, col: 1 }, size);
    expect(plan).toEqual({
      cells: [
        { row: 4, col: 1, raw: "243" },
        { row: 5, col: 1, raw: "245" },
        { row: 6, col: 1, raw: "242" },
      ],
      skipped: 0,
      overflow: [],
    });
  });

  it("keeps blank and invalid lines in place for the cells to judge", () => {
    const plan = planPaste("243\n\n2 42", { row: 0, col: 0 }, size);
    expect(plan?.cells.map((cell) => cell.raw)).toEqual(["243", "", "2 42"]);
  });

  it("counts values that fall off the grid, and keeps where each would have gone", () => {
    const plan = planPaste("1\n2\n3", { row: 11, col: 0 }, size);
    expect(plan?.cells).toHaveLength(2);
    expect(plan?.skipped).toBe(1);
    expect(plan?.overflow).toEqual([{ row: 13, col: 0, raw: "3" }]);
    // A block's columns past the last measure fall off too.
    expect(planPaste("243\t95\t7", { row: 0, col: 4 }, size)?.overflow).toEqual([
      { row: 0, col: 5, raw: "95" },
      { row: 0, col: 6, raw: "7" },
    ]);
  });

  it("fills a tab-separated block across columns", () => {
    const plan = planPaste("243\t95\n244\t96", { row: 0, col: 3 }, size);
    expect(plan?.cells).toEqual([
      { row: 0, col: 3, raw: "243" },
      { row: 0, col: 4, raw: "95" },
      { row: 1, col: 3, raw: "244" },
      { row: 1, col: 4, raw: "96" },
    ]);
    expect(plan?.skipped).toBe(0);
  });
});

describe("pasteOverflow and overflowNotStored", () => {
  const one = [{ key: "values" }];
  const grid = { rows: 5, cols: 1 };

  it("lists what fell off the grid with the number each reads as, blanks left out", () => {
    const plan = planPaste("6.5\n6.6\n6.7\n6.8\n6.9\n7.1\n\nabc\n7.3", { row: 0, col: 0 }, grid);
    if (!plan) throw new Error("expected a multi-value paste");
    expect(pasteOverflow(plan)).toEqual([
      { row: 5, col: 0, raw: "7.1", value: 7.1 },
      { row: 7, col: 0, raw: "abc", value: null },
      { row: 8, col: 0, raw: "7.3", value: 7.3 },
    ]);
  });

  it("says nobody stored them while the module holds nothing past the last row (dimensions, weight)", () => {
    const plan = planPaste("6.5\n6.6\n6.7\n6.8\n6.9\n7.1\n7.2", { row: 0, col: 0 }, grid);
    if (!plan) throw new Error("expected a multi-value paste");
    const overflow = pasteOverflow(plan);
    expect(overflowNotStored(overflow, one, { values: [6.5, 6.6, 6.7, 6.8, 6.9] }).map((cell) => cell.raw)).toEqual([
      "7.1",
      "7.2",
    ]);
    // Readings saved past the plan before (a plan that shrank) are not this paste's values.
    expect(overflowNotStored(overflow, one, { values: [6.5, 6.6, 6.7, 6.8, 6.9, 240, 241] })).toHaveLength(2);
  });

  it("leaves to the module the values it kept past its last row (force at break), and lists the rest", () => {
    const plan = planPaste("6.5\n6.6\n6.7\n6.8\n6.9\n7.1\t9\nabc", { row: 0, col: 0 }, grid);
    if (!plan) throw new Error("expected a multi-value paste");
    const kept = { values: [6.5, 6.6, 6.7, 6.8, 6.9, 7.1, null] };
    // 7.1 is held as reading No. 6; the 9 from a second column and the text were stored nowhere.
    expect(overflowNotStored(pasteOverflow(plan), one, kept).map((cell) => cell.raw)).toEqual(["9", "abc"]);
  });
});

describe("judgeOverflow", () => {
  const one = [{ key: "values" }];
  const grid = { rows: 5, cols: 1 };
  const pasted = (text: string) => {
    const plan = planPaste(text, { row: 0, col: 0 }, grid);
    if (!plan) throw new Error("expected a multi-value paste");
    return { cells: pasteOverflow(plan), from: { row: 0, col: 0 }, notStored: null };
  };

  it("judges a paste against the values the module holds as it lands", () => {
    const overflow = pasted("6.5\n6.6\n6.7\n6.8\n6.9\n7.4\n7.5\nabc");
    const judged = judgeOverflow(overflow, one, { values: [6.5, 6.6, 6.7, 6.8, 6.9, 7.4, 7.5] });
    // Force at break kept 7.4 and 7.5 as readings No. 6 and 7: only the text was stored nowhere.
    expect(judged.notStored?.map((cell) => cell.raw)).toEqual(["abc"]);
    expect(judged.cells).toBe(overflow.cells);
    expect(judged.from).toBe(overflow.from);
  });

  it("keeps its judgement when the module later takes the kept values away (force at break's Clear)", () => {
    const judged = judgeOverflow(pasted("6.5\n6.6\n6.7\n6.8\n6.9\n7.4\n7.5"), one, {
      values: [6.5, 6.6, 6.7, 6.8, 6.9, 7.4, 7.5],
    });
    expect(judged.notStored).toEqual([]);
    // Cleared: the values shrink back to the grid's rows. They were stored, so nothing is listed as lost.
    const cleared = { values: [6.5, 6.6, 6.7, 6.8, 6.9] };
    expect(overflowNotStored(judged.cells, one, cleared)).toHaveLength(2);
    expect(judgeOverflow(judged, one, cleared)).toBe(judged);
  });

  it("keeps its judgement of values nobody stored, whatever the module holds later", () => {
    const judged = judgeOverflow(pasted("6.5\n6.6\n6.7\n6.8\n6.9\n7.4"), one, { values: [6.5, 6.6, 6.7, 6.8, 6.9] });
    expect(judged.notStored?.map((cell) => cell.raw)).toEqual(["7.4"]);
    expect(judgeOverflow(judged, one, { values: [6.5, 6.6, 6.7, 6.8, 6.9, 7.4] })).toBe(judged);
  });
});

describe("cellKey", () => {
  it("names a cell by measure and row", () => {
    expect(cellKey("width", 2)).toBe("width:2");
  });
});

describe("applyPaste", () => {
  const measures = [
    { key: "length", min: 0, max: 400 },
    { key: "width", min: 0, max: 200 },
    { key: "cuff" },
  ];
  const rows = 5;
  const paste = (text: string, row: number, col: number): PastePlan => {
    const plan = planPaste(text, { row, col }, { rows, cols: measures.length });
    if (!plan) throw new Error("expected a multi-value paste");
    return plan;
  };

  it("fills a pasted column down from the focused cell and leaves the rest alone", () => {
    const values = { length: [240, null, null, null, 250], width: [95, 96, 97, 98, 99] };
    const result = applyPaste(paste("243\n245\n242", 1, 0), measures, rows, values, {});
    expect(result.values.length).toEqual([240, 243, 245, 242, 250]);
    expect(result.values.width).toBe(values.width);
    expect(result.invalid).toEqual({});
    expect(result.notice).toBe("Pasted 3 values.");
  });

  it('stores nothing for a rejected line ("2 42") and lists it with its text', () => {
    const values = { length: [240, 241, 242, 243, 244] };
    const result = applyPaste(paste("245\n2 42\n246", 0, 0), measures, rows, values, {});
    expect(result.values.length).toEqual([245, null, 246, 243, 244]);
    expect(result.invalid).toEqual({
      "length:1": { raw: "2 42", error: "One number per cell: remove the space (“2 42” → 242)." },
    });
    expect(result.notice).toBe("Pasted 3 values. 1 not stored.");
  });

  it("applies each measure's limits", () => {
    const result = applyPaste(paste("401\t95\n240\t201", 0, 0), measures, rows, {}, {});
    expect(result.values.length).toEqual([null, 240, null, null, null]);
    expect(result.values.width).toEqual([95, null, null, null, null]);
    expect(result.invalid[cellKey("length", 0)]?.error).toBe("Must be 400 or less.");
    expect(result.invalid[cellKey("width", 1)]?.error).toBe("Must be 200 or less.");
    expect(result.notice).toBe("Pasted 4 values. 2 not stored.");
  });

  it("clears an earlier rejection that a valid value now replaces, and keeps the others", () => {
    const earlier = {
      "length:0": { raw: "2 42", error: "One number per cell." },
      "width:3": { raw: "abc", error: "Numbers only, e.g. 2.42." },
    };
    const result = applyPaste(paste("242\n243", 0, 0), measures, rows, {}, earlier);
    expect(result.invalid).toEqual({ "width:3": earlier["width:3"] });
    expect(result.values.length).toEqual([242, 243, null, null, null]);
  });

  it("clears a cell for a blank line", () => {
    const result = applyPaste(paste("243\n\n245", 0, 0), measures, rows, { length: [1, 2, 3, 4, 5] }, {});
    expect(result.values.length).toEqual([243, null, 245, 4, 5]);
    expect(result.invalid).toEqual({});
  });

  it("counts values that do not fit, in words", () => {
    const result = applyPaste(paste("1\n2\n3", 3, 2), measures, rows, {}, {});
    expect(result.values.cuff).toEqual([null, null, null, 1, 2]);
    expect(result.notice).toBe("Pasted 2 values. 1 did not fit.");
    expect(applyPaste(paste("1\n2", 4, 0), measures, rows, {}, {}).notice).toBe("Pasted 1 value. 1 did not fit.");
  });

  it("never stores text or Infinity", () => {
    const result = applyPaste(paste(["abc", "12mm", "9".repeat(400), "1e3", "0.07"].join("\n"), 0, 2), measures, rows, {}, {});
    expect(result.values.cuff).toEqual([null, null, null, null, 0.07]);
    expect(Object.keys(result.invalid)).toHaveLength(4);
  });

  it("reports every cell it reached, with the value each now holds, for onCellsChange", () => {
    const result = applyPaste(paste("243\t95\n2 42\t96", 1, 0), measures, rows, { length: [240] }, {});
    expect(result.changes).toEqual([
      { row: 1, measure: "length", value: 243 },
      { row: 1, measure: "width", value: 95 },
      { row: 2, measure: "length", value: null },
      { row: 2, measure: "width", value: 96 },
    ]);
  });

  it("refuses a measure's exclusive minimum", () => {
    const exclusive = [{ key: "force", min: 0, minExclusive: true }];
    const plan = planPaste("6.5\n0\n6.6", { row: 0, col: 0 }, { rows, cols: 1 });
    if (!plan) throw new Error("expected a multi-value paste");
    const result = applyPaste(plan, exclusive, rows, {}, {});
    expect(result.values.force).toEqual([6.5, null, 6.6, null, null]);
    expect(result.invalid[cellKey("force", 1)]?.error).toBe("Must be more than 0.");
  });

  it("does not change the values or rejections it was given", () => {
    const values = Object.freeze({ length: Object.freeze([240, 241, 242, 243, 244]) });
    const invalid = Object.freeze({ "length:0": { raw: "x", error: "Numbers only, e.g. 2.42." } });
    applyPaste(paste("1\n2", 0, 0), measures, rows, values, invalid);
    expect(values.length).toEqual([240, 241, 242, 243, 244]);
    expect(invalid).toHaveProperty("length:0");
  });
});

describe("labelColumnWidth", () => {
  it("fits the longest caption on one line, so 'Passed / Failed' never wraps", () => {
    expect(labelColumnWidth(["No.", "Median", "Spec.", "Passed / Failed"])).toBe("clamp(3.5rem, calc(15ch + 2rem), 16rem)");
  });

  it("keeps the glove numbers' width for short captions, and wraps only past 16 rem", () => {
    expect(labelColumnWidth(["No.", "P/F"])).toBe("clamp(3.5rem, calc(3ch + 2rem), 16rem)");
    expect(labelColumnWidth([])).toBe("clamp(3.5rem, calc(0ch + 2rem), 16rem)");
  });
});
