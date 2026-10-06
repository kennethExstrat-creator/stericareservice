import { describe, expect, it } from "vitest";
import { applyPaste, caretOf, cellKey, planPaste, targetCell, type PastePlan } from "./grid-navigation";

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
    });
  });

  it("keeps blank and invalid lines in place for the cells to judge", () => {
    const plan = planPaste("243\n\n2 42", { row: 0, col: 0 }, size);
    expect(plan?.cells.map((cell) => cell.raw)).toEqual(["243", "", "2 42"]);
  });

  it("counts values that fall off the grid", () => {
    const plan = planPaste("1\n2\n3", { row: 11, col: 0 }, size);
    expect(plan?.cells).toHaveLength(2);
    expect(plan?.skipped).toBe(1);
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
      "length:1": { raw: "2 42", error: "One number per cell: remove the space, e.g. 2.42." },
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

  it("does not change the values or rejections it was given", () => {
    const values = Object.freeze({ length: Object.freeze([240, 241, 242, 243, 244]) });
    const invalid = Object.freeze({ "length:0": { raw: "x", error: "Numbers only, e.g. 2.42." } });
    applyPaste(paste("1\n2", 0, 0), measures, rows, values, invalid);
    expect(values.length).toEqual([240, 241, 242, 243, 244]);
    expect(invalid).toHaveProperty("length:0");
  });
});
