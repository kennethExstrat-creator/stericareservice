import { describe, expect, it } from "vitest";
import { caretOf, planPaste, targetCell } from "./grid-navigation";

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
