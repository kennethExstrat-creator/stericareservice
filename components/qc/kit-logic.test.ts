// The pure rules behind the capture kit: keys, swipes, totals and
// decisions, the spoken summary, where the focus goes when a row comes off,
// size and column fallbacks, the column switcher's steps, box lists and
// opening them, paste plans and the one-change paste, issue paths. Markup is
// covered by kit.test.tsx; pointer, key and paste handling were checked in a
// browser.
import { describe, expect, it } from "vitest";
import {
  bestOption,
  boxListChange,
  boxOptions,
  isUnlisted,
  moveInGrid,
  pickedElsewhere,
  readBoxNumber,
} from "./box-options";
import {
  columnStatus,
  columnTotal,
  counterAnnouncement,
  counterTableWidth,
  countOf,
  removalFocus,
  type CounterCell,
} from "./counter-model";
import { batchDataChanges, createDataUpdater, type DataChange } from "./data-updater";
import {
  fillRun,
  neighbour,
  parsePastedRows,
  pasteNotice,
  planFieldPaste,
  splitPastedValues,
} from "./field-navigation";
import { handsOf, shownHandView } from "./hand-toggle";
import {
  findIssue,
  issueNoticeProps,
  issuePathCandidates,
  issuePathKey,
  issuePathProps,
  issueTargetIndex,
} from "./issue-path";
import { specOutcome } from "./requirement-list";
import { rovingIndex } from "./roving";
import { activeColumnKey, activeSize, showsSideBySide, switcherIndex, switcherStep } from "./selection";
import { stepValue, swipeStep } from "./swipe";

describe("rovingIndex", () => {
  it("moves with the arrows and wraps at the ends", () => {
    expect(rovingIndex("ArrowRight", 0, 5)).toBe(1);
    expect(rovingIndex("ArrowLeft", 1, 5)).toBe(0);
    expect(rovingIndex("ArrowRight", 4, 5)).toBe(0);
    expect(rovingIndex("ArrowLeft", 0, 5)).toBe(4);
  });

  it("jumps with Home and End", () => {
    expect(rovingIndex("Home", 3, 5)).toBe(0);
    expect(rovingIndex("End", 1, 5)).toBe(4);
  });

  it("can stop at the ends instead of wrapping", () => {
    expect(rovingIndex("ArrowRight", 4, 5, { wrap: false })).toBe(4);
    expect(rovingIndex("ArrowLeft", 0, 5, { wrap: false })).toBe(0);
  });

  it("uses up and down only for vertical groups (radios)", () => {
    expect(rovingIndex("ArrowDown", 0, 2)).toBeNull();
    expect(rovingIndex("ArrowDown", 0, 2, { vertical: true })).toBe(1);
    expect(rovingIndex("ArrowUp", 0, 2, { vertical: true })).toBe(1);
  });

  it("ignores other keys and empty groups", () => {
    expect(rovingIndex("Enter", 0, 5)).toBeNull();
    expect(rovingIndex("a", 0, 5)).toBeNull();
    expect(rovingIndex("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("swipeStep", () => {
  const start = { x: 400, y: 300, time: 0 };

  it("turns to the next size when the finger moves left, back when it moves right", () => {
    expect(swipeStep(start, { x: 300, y: 310, time: 200 })).toBe(1);
    expect(swipeStep(start, { x: 500, y: 290, time: 200 })).toBe(-1);
  });

  it("ignores short moves, so taps on steppers never turn the page", () => {
    expect(swipeStep(start, { x: 360, y: 300, time: 120 })).toBe(0);
    expect(swipeStep(start, { x: 400, y: 300, time: 80 })).toBe(0);
  });

  it("ignores mostly vertical moves (scrolling)", () => {
    expect(swipeStep(start, { x: 320, y: 380, time: 200 })).toBe(0);
    expect(swipeStep(start, { x: 300, y: 360, time: 200 })).toBe(1);
  });

  it("ignores slow drags", () => {
    expect(swipeStep(start, { x: 200, y: 300, time: 1200 })).toBe(0);
  });

  it("takes custom thresholds", () => {
    expect(swipeStep(start, { x: 370, y: 300, time: 100 }, { distance: 20 })).toBe(1);
  });
});

describe("stepValue", () => {
  const sizes = ["XS", "S", "M", "L", "XL"];

  it("finds the neighbouring size and never wraps", () => {
    expect(stepValue(sizes, "M", 1)).toBe("L");
    expect(stepValue(sizes, "M", -1)).toBe("S");
    expect(stepValue(sizes, "XL", 1)).toBeNull();
    expect(stepValue(sizes, "XS", -1)).toBeNull();
    expect(stepValue(sizes, "M", 0)).toBeNull();
    expect(stepValue(sizes, "XXL", 1)).toBeNull();
  });
});

describe("counter model", () => {
  const rows = [{ key: "hole_crotch" }, { key: "hole_palm" }, { key: "hole_finger" }];
  const counts: Record<string, number | null> = {
    "hole_crotch|M": 1,
    "hole_palm|M": null,
    "hole_finger|M": 2,
    "hole_crotch|L|R": 1,
    "hole_crotch|L|L": 2,
    "hole_palm|L|L": 1,
  };
  const read = ({ row, column, hand }: CounterCell) => counts[[row, column, hand].filter(Boolean).join("|")];

  it("reads missing, negative and broken counts as zero", () => {
    expect(countOf(null)).toBe(0);
    expect(countOf(undefined)).toBe(0);
    expect(countOf(-2)).toBe(0);
    expect(countOf(Number.NaN)).toBe(0);
    expect(countOf(3)).toBe(3);
  });

  it("totals a column over every row", () => {
    expect(columnTotal(rows, "M", undefined, read)).toBe(3);
    expect(columnTotal(rows, "XL", undefined, read)).toBe(0);
  });

  it("totals both hands, whichever is on screen", () => {
    expect(columnTotal(rows, "L", ["R", "L"], read)).toBe(4);
    expect(columnTotal(rows, "L", [], read)).toBe(0);
  });

  it("accepts up to Ac and rejects from Re", () => {
    expect(columnStatus(3, { limits: { ac: 3, re: 4 } })).toBe("pass");
    expect(columnStatus(4, { limits: { ac: 3, re: 4 } })).toBe("fail");
    expect(columnStatus(0, { limits: { ac: 0, re: 1 } })).toBe("pass");
    expect(columnStatus(1, { limits: { ac: 0, re: 1 } })).toBe("fail");
  });

  it("decides from the total on screen, so calc's verdict from before the tap never shows", () => {
    // Ac 7 / Re 8: the tap to 8 rejects, whatever calc said at 7.
    expect(columnStatus(8, { limits: { ac: 7, re: 8 }, status: "pass" })).toBe("fail");
    expect(columnStatus(7, { limits: { ac: 7, re: 8 }, status: "fail" })).toBe("pass");
    // A size-level result passed by mistake cannot mark a clean class table Reject.
    expect(columnStatus(0, { limits: { ac: 3, re: 4 }, status: "fail" })).toBe("pass");
  });

  it("lets calc's not done win: calc knows what is missing", () => {
    expect(columnStatus(5, { limits: { ac: 3, re: 4 }, status: "not_done" })).toBe("not_done");
    expect(columnStatus(0, { limits: { ac: 3, re: 4 }, status: "not_done" })).toBe("not_done");
  });

  it("shows calc's status without limits, else not done", () => {
    expect(columnStatus(2, { status: "warn" })).toBe("warn");
    expect(columnStatus(2, { limits: null, status: "pass" })).toBe("pass");
    expect(columnStatus(0, { limits: null })).toBe("not_done");
    expect(columnStatus(0, {})).toBe("not_done");
  });

  it("says the new count, the total and the chip's verdict", () => {
    expect(counterAnnouncement({ count: 3, column: "Size XS", total: 8, verdict: "Reject" })).toBe(
      "3. Size XS: total 8, Reject.",
    );
    expect(counterAnnouncement({ count: 0, column: "box 253", total: 2, verdict: null })).toBe("0. box 253: total 2.");
  });

  it("takes the verdict it says from the props after the tap, the same as the chip", () => {
    // The table rendered after the tap: palm 8 in XS, calc still saying pass from before it.
    const column = { key: "XS", limits: { ac: 7, re: 8 }, status: "pass" as const };
    const total = columnTotal([{ key: "palm" }, { key: "cuff" }], "XS", undefined, ({ row }) => (row === "palm" ? 8 : 0));
    const chip = columnStatus(total, column);
    expect(chip).toBe("fail");
    expect(counterAnnouncement({ count: 8, column: "Size XS", total, verdict: chip === "fail" ? "Reject" : "Accept" })).toBe(
      "8. Size XS: total 8, Reject.",
    );
  });

  it("keeps the focus on Other defect when a row is taken off, else on the row taking its place", () => {
    expect(removalFocus(2, 5, true)).toEqual({ to: "opener" });
    // The add form is open, or the table offers none: the next row, or the one before the last.
    expect(removalFocus(2, 5, false)).toEqual({ to: "row", index: 3 });
    expect(removalFocus(4, 5, false)).toEqual({ to: "row", index: 3 });
    expect(removalFocus(0, 2, false)).toEqual({ to: "row", index: 1 });
    // Its only row: the table itself, never the page.
    expect(removalFocus(0, 1, false)).toEqual({ to: "table" });
  });

  it("knows how wide every column side by side is", () => {
    // Label 256, value columns 128 (160 on touch), 2 px of frame.
    expect(counterTableWidth(5, false)).toBe(256 + 5 * 128 + 2);
    expect(counterTableWidth(10, false)).toBe(1538);
    expect(counterTableWidth(1, true)).toBe(256 + 160 + 2);
  });
});

describe("size and column on screen", () => {
  const sizes = ["XS", "S", "M", "L", "XL"];

  it("shows the value when it is ordered", () => {
    expect(activeSize(sizes, "M")).toBe("M");
  });

  it("falls back to the first ordered size for a size out of the order, or none yet", () => {
    expect(activeSize(sizes, "XXL")).toBe("XS");
    expect(activeSize(sizes, "")).toBe("XS");
    expect(activeSize([], "M")).toBeUndefined();
  });

  it("shows the same column in CounterTable as the tab that looks selected", () => {
    const columns = sizes.map((key) => ({ key }));
    expect(activeColumnKey(columns, "M", "M")).toBe("M");
    // A stale value: SizeTabs shows XS, and so does the table.
    expect(activeColumnKey(columns, "XXL", activeSize(sizes, "XXL"))).toBe("XS");
    expect(activeColumnKey(columns, "XXL")).toBe("XS");
    expect(activeColumnKey([], "XXL", "XS")).toBeUndefined();
  });

  it("goes side by side only when asked and the widest table fits", () => {
    expect(showsSideBySide("all", 1048, counterTableWidth(5, false))).toBe(true);
    // Five sizes split into right and left hands need 1538 px.
    expect(showsSideBySide("all", 1048, counterTableWidth(10, false))).toBe(false);
    expect(showsSideBySide("all", null, counterTableWidth(10, false))).toBe(true);
    expect(showsSideBySide("tabs", 4000, 0)).toBe(false);
  });

  it("reads Both as the right hand where Both is not offered", () => {
    expect(shownHandView("both", false)).toBe("R");
    expect(shownHandView("both", true)).toBe("both");
    expect(shownHandView("L", false)).toBe("L");
  });
});

describe("ColumnSwitcher's steps", () => {
  it("steps one column at a time and stops at the ends", () => {
    expect(switcherStep(1, 5, 1)).toBe(2);
    expect(switcherStep(1, 5, -1)).toBe(0);
    expect(switcherStep(0, 5, -1)).toBeNull();
    expect(switcherStep(4, 5, 1)).toBeNull();
  });

  it("keeps an index past the columns inside them", () => {
    expect(switcherIndex(7, 5)).toBe(4);
    expect(switcherIndex(-1, 5)).toBe(0);
    expect(switcherStep(7, 5, -1)).toBe(3);
    expect(switcherStep(7, 5, 1)).toBeNull();
    expect(switcherIndex(3, 0)).toBe(0);
  });
});

describe("box options", () => {
  const cartons = [2834, 686, 299, 13, 1324, 1913, 2236, 686];

  it("offers each carton once, ascending", () => {
    expect(boxOptions(cartons)).toEqual([13, 299, 686, 1324, 1913, 2236, 2834]);
  });

  it("drops numbers that cannot be cartons", () => {
    expect(boxOptions([0, -3, 2.5, 12])).toEqual([12]);
  });

  it("filters by the digits typed", () => {
    expect(boxOptions(cartons, "13")).toEqual([13, 1324, 1913]);
    expect(boxOptions(cartons, " 2 2")).toEqual([2236]);
    expect(boxOptions(cartons, "999")).toEqual([]);
  });

  it("picks the exact box first, else the first match", () => {
    expect(bestOption(boxOptions(cartons, "13"), "13")).toBe(13);
    expect(bestOption(boxOptions(cartons, "132"), "132")).toBe(1324);
    expect(bestOption([], "5")).toBeNull();
  });

  it("counts picks in other rows, leaving this row's own out", () => {
    const used = [13, 299, 299, null, 13, 686];
    const elsewhere = pickedElsewhere(used, 13);
    expect(elsewhere.get(13)).toBe(1);
    expect(elsewhere.get(299)).toBe(2);
    expect(pickedElsewhere([686], 686).has(686)).toBe(false);
    expect(pickedElsewhere(used, null).get(13)).toBe(2);
  });

  it("flags a stored box that is not in the carton list", () => {
    expect(isUnlisted(2336, cartons)).toBe(true);
    expect(isUnlisted(2236, cartons)).toBe(false);
    expect(isUnlisted(null, cartons)).toBe(false);
  });

  it("checks nothing while there is no carton list", () => {
    expect(isUnlisted(2336, [])).toBe(false);
  });

  it("reads a typed box number as a whole number from 1", () => {
    expect(readBoxNumber(" 253 ")).toBe(253);
    expect(readBoxNumber("0")).toBeNull();
    expect(readBoxNumber("25.3")).toBeNull();
    expect(readBoxNumber("2 53")).toBeNull();
    expect(readBoxNumber("")).toBeNull();
    expect(readBoxNumber("abc")).toBeNull();
  });

  it("opens the list only where the box can change, reporting the box in focus as it opens", () => {
    expect(boxListChange(true, false)).toEqual({ open: true, reportFocus: true });
    expect(boxListChange(false, false)).toEqual({ open: false, reportFocus: false });
    expect(boxListChange(true, true)).toBeNull();
  });

  it("moves through the grid by one or by a row", () => {
    expect(moveInGrid("ArrowRight", 0, 12, 5)).toBe(1);
    expect(moveInGrid("ArrowDown", 1, 12, 5)).toBe(6);
    expect(moveInGrid("ArrowDown", 9, 12, 5)).toBe(11);
    expect(moveInGrid("ArrowUp", 2, 12, 5)).toBe(0);
    expect(moveInGrid("ArrowDown", -1, 12, 5)).toBe(0);
    expect(moveInGrid("PageDown", 0, 12, 5)).toBe(11);
    expect(moveInGrid("Enter", 0, 12, 5)).toBeNull();
    expect(moveInGrid("ArrowRight", 0, 0, 5)).toBeNull();
  });
});

describe("parsePastedRows and planFieldPaste", () => {
  it("reads a spreadsheet block as rows of cells", () => {
    expect(parsePastedRows("88\t70\r\n90\t75\n")).toEqual([
      ["88", "70"],
      ["90", "75"],
    ]);
  });

  it("fills a run in reading order", () => {
    expect(planFieldPaste("88\t70\n90\t75", { column: false })).toEqual({ values: ["88", "70", "90", "75"], leftOut: 0 });
  });

  it("fills a named group (one column) from the first column only", () => {
    expect(planFieldPaste("88\t70\n90\t75\n", { column: true })).toEqual({ values: ["88", "90"], leftOut: 2 });
    // A row copied across still lands in this column only.
    expect(planFieldPaste("88\t90\t87", { column: true })).toEqual({ values: ["88"], leftOut: 2 });
  });

  it("leaves one value to the ordinary paste, trailing empty cells included", () => {
    expect(planFieldPaste("88", { column: true })).toBeNull();
    expect(planFieldPaste("88\n", { column: false })).toBeNull();
    expect(planFieldPaste("88\t", { column: true })).toBeNull();
  });
});

describe("one change for a paste (useDataUpdater under CaptureProps' onChange)", () => {
  type Box = { layering: number | null };
  type Data = { sizes: Record<string, { boxes: Box[] }> };
  const setLayering = (data: Data, size: string, index: number, layering: number | null): Data => {
    const boxes = [...(data.sizes[size]?.boxes ?? [])];
    boxes[index] = { ...boxes[index], layering };
    return { ...data, sizes: { ...data.sizes, [size]: { boxes } } };
  };
  const empty = (): Data => ({ sizes: { M: { boxes: Array.from({ length: 5 }, () => ({ layering: null })) } } });
  const layering = (data: Data) => data.sizes.M.boxes.map((box) => box.layering);
  // A field's own rule: a number from 0 to 100, blank is no value, anything else is rejected.
  const parse = (raw: string): { ok: boolean; value: number | null } => {
    if (raw === "") return { ok: true, value: null };
    const value = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN;
    return value >= 0 && value <= 100 ? { ok: true, value } : { ok: false, value: null };
  };

  /**
   * The capture screen and a module that follows the contract: onChange(next)
   * replaces the data, and each field calls the onValueChange the module
   * rendered, which saw the data of that render.
   */
  function harness(write: "updater" | "direct") {
    let data = empty();
    const changes: Data[] = [];
    const onChange = (next: Data) => {
      changes.push(next);
      data = next;
    };
    const updater = createDataUpdater(data, onChange);
    const rendered = data;
    const fields = [0, 1, 2, 3, 4].map((index) => {
      const onValueChange = (value: number | null) =>
        write === "updater"
          ? updater.update((current) => setLayering(current, "M", index, value))
          : onChange(setLayering(rendered, "M", index, value));
      // NumberField's store: the value, or null with the text kept on screen.
      return (raw: string) => {
        const parsed = parse(raw);
        onValueChange(parsed.value);
        return parsed.ok;
      };
    });
    const paste = (text: string) => {
      const plan = planFieldPaste(text, { column: true });
      if (!plan) throw new Error("not a paste of several values");
      let result = { filled: 0, rejected: 0, skipped: 0 };
      batchDataChanges(() => {
        result = fillRun(plan.values, fields, 0, (store, raw) => store(raw));
      });
      return { result, plan };
    };
    return { paste, changes, data: () => data };
  }

  it("hands every pasted value to onChange once", () => {
    const screen = harness("updater");
    const { result } = screen.paste("88\n90\n87\n2 42\n91");
    expect(screen.changes).toHaveLength(1);
    expect(layering(screen.data())).toEqual([88, 90, 87, null, 91]);
    expect(result).toEqual({ filled: 5, rejected: 1, skipped: 0 });
  });

  it("would keep only the last value if each field started from the rendered data", () => {
    // What the review found, and why every kit callback goes through `update`.
    const screen = harness("direct");
    screen.paste("88\n90\n87\n2 42\n91");
    expect(screen.changes).toHaveLength(5);
    expect(layering(screen.data())).toEqual([null, null, null, null, 91]);
  });

  it("judges each value by its own field and says what happened", () => {
    const screen = harness("updater");
    const { result, plan } = screen.paste("50\t9\n101\n-3\n70\n80\n90\n95");
    expect(layering(screen.data())).toEqual([50, null, null, 70, 80]);
    expect(result).toEqual({ filled: 5, rejected: 2, skipped: 2 });
    expect(pasteNotice({ ...result, leftOut: plan.leftOut })).toBe(
      "Pasted 5 values. 2 not stored. 2 did not fit. Only the first column is used here: 1 value from other columns left out.",
    );
    expect(pasteNotice({ filled: 1, rejected: 0, skipped: 0, leftOut: 0 })).toBe("Pasted 1 value.");
  });

  it("builds changes made in one event on each other outside a batch", () => {
    const changes: Data[] = [];
    const updater = createDataUpdater(empty(), (next) => changes.push(next));
    updater.update((current) => setLayering(current, "M", 0, 70));
    updater.update((current) => setLayering(current, "M", 1, 80));
    expect(changes).toHaveLength(2);
    expect(layering(changes[1])).toEqual([70, 80, null, null, null]);
  });

  it("starts from the data the screen renders next", () => {
    const changes: Data[] = [];
    const onChange = (next: Data) => changes.push(next);
    const updater = createDataUpdater(empty(), onChange);
    updater.update((current) => setLayering(current, "M", 0, 70));
    // The screen renders its own copy (re-parsed, say); the next event starts from it.
    updater.sync(setLayering(empty(), "M", 4, 99), onChange);
    updater.update((current) => setLayering(current, "M", 1, 80));
    expect(layering(changes[1])).toEqual([null, 80, null, null, 99]);
  });

  it("flushes once after nested batches, and skips a change that changes nothing", () => {
    const changes: Data[] = [];
    const updater = createDataUpdater(empty(), (next) => changes.push(next));
    batchDataChanges(() => {
      updater.update((current) => setLayering(current, "M", 0, 1));
      batchDataChanges(() => updater.update((current) => setLayering(current, "M", 1, 2)));
      expect(changes).toHaveLength(0);
    });
    expect(changes).toHaveLength(1);
    expect(layering(changes[0])).toEqual([1, 2, null, null, null]);
    const same: DataChange<Data> = (current) => current;
    updater.update(same);
    expect(changes).toHaveLength(1);
  });

  it("gives each module in a batch its own single change", () => {
    const first: Data[] = [];
    const second: Data[] = [];
    const a = createDataUpdater(empty(), (next) => first.push(next));
    const b = createDataUpdater(empty(), (next) => second.push(next));
    batchDataChanges(() => {
      a.update((current) => setLayering(current, "M", 0, 1));
      b.update((current) => setLayering(current, "M", 0, 2));
      a.update((current) => setLayering(current, "M", 1, 3));
    });
    expect([first.length, second.length]).toEqual([1, 1]);
    expect(layering(first[0])).toEqual([1, 3, null, null, null]);
  });
});

describe("splitPastedValues", () => {
  it("splits a pasted column into values", () => {
    expect(splitPastedValues("88\n90\r\n 87 \n")).toEqual(["88", "90", "87"]);
  });

  it("reads a spreadsheet row in order", () => {
    expect(splitPastedValues("88\t90\n87\t91")).toEqual(["88", "90", "87", "91"]);
  });

  it("keeps blank and invalid entries in place for the fields to judge", () => {
    expect(splitPastedValues("88\n\n2 42")).toEqual(["88", "", "2 42"]);
  });

  it("leaves a single value as one", () => {
    expect(splitPastedValues("88")).toEqual(["88"]);
    expect(splitPastedValues("88\n")).toEqual(["88"]);
  });
});

describe("neighbour", () => {
  it("finds the next and previous item, or null past the ends", () => {
    expect(neighbour(["a", "b", "c"], "b", 1)).toBe("c");
    expect(neighbour(["a", "b", "c"], "b", -1)).toBe("a");
    expect(neighbour(["a", "b", "c"], "c", 1)).toBeNull();
    expect(neighbour(["a", "b", "c"], "z", 1)).toBeNull();
  });
});

describe("handsOf", () => {
  it("lists the hands a view shows", () => {
    expect(handsOf("R")).toEqual(["R"]);
    expect(handsOf("L")).toEqual(["L"]);
    expect(handsOf("both")).toEqual(["R", "L"]);
  });
});

describe("issue paths", () => {
  it("keys paths as JSON, so sizes with dots stay whole", () => {
    expect(issuePathKey(["sizes", "7.0", "holes", "palm"])).toBe('["sizes","7.0","holes","palm"]');
    expect(issuePathProps(["sizes", "M", 3])).toEqual({ "data-issue-path": '["sizes","M",3]' });
    expect(issuePathProps(null)).toEqual({});
  });

  it("finds the issue at a field, errors first", () => {
    const issues = [
      { level: "warning", path: ["sizes", "M", "weight"], message: "More than 10% from the indicative weight." },
      { level: "error", path: ["sizes", "M", "boxes", 11, "box"], message: "Box 2336 is not in the carton list." },
      { level: "warning", path: ["sizes", "M", "boxes", 11, "box"], message: "Box used twice." },
    ];
    expect(findIssue(issues, ["sizes", "M", "boxes", 11, "box"])?.message).toBe("Box 2336 is not in the carton list.");
    expect(findIssue(issues, ["sizes", "M", "weight"])?.level).toBe("warning");
    expect(findIssue(issues, ["sizes", "S", "weight"])).toBeUndefined();
    expect(findIssue(null, ["sizes"])).toBeUndefined();
  });

  it("falls back from the exact path to its parents", () => {
    expect(issuePathCandidates(["sizes", "M", "boxes", 3])).toEqual([
      '["sizes","M","boxes",3]',
      '["sizes","M","boxes"]',
      '["sizes","M"]',
      '["sizes"]',
    ]);
    expect(issuePathCandidates([])).toEqual([]);
  });

  it("marks a notice so the link lands on the message, outside the Tab order", () => {
    expect(issueNoticeProps(["sizes", "M", "values"])).toEqual({
      "data-issue-path": '["sizes","M","values"]',
      tabIndex: -1,
    });
    expect(issueNoticeProps(null)).toEqual({});
  });

  describe("the element a link lands on", () => {
    const panel = { key: issuePathKey(["sizes", "M"]), focusesItself: false };
    const notice = { key: issuePathKey(["sizes", "M"]), focusesItself: true };
    const cell = (row: number) => ({ key: issuePathKey(["sizes", "M", "values", row]), focusesItself: true });
    const past = { key: issuePathKey(["sizes", "M", "values"]), focusesItself: true };

    it("takes the exact path first", () => {
      expect(issueTargetIndex([panel, cell(0), cell(1)], ["sizes", "M", "values", 1])).toBe(2);
    });

    it("falls back to the nearest marked parent: a reading past the grid lands on its notice", () => {
      expect(issueTargetIndex([panel, cell(0), cell(1), past], ["sizes", "M", "values", 15])).toBe(3);
      expect(issueTargetIndex([panel, cell(0)], ["sizes", "M", "values", 15])).toBe(0);
    });

    it("prefers a notice to the container marked with the same path", () => {
      expect(issueTargetIndex([panel, cell(0), notice], ["sizes", "M"])).toBe(2);
      expect(issueTargetIndex([panel, cell(0)], ["sizes", "M"])).toBe(0);
    });

    it("finds nothing for a path nothing is marked with", () => {
      expect(issueTargetIndex([panel], ["sizes", "S", "values", 0])).toBe(-1);
      expect(issueTargetIndex([], [])).toBe(-1);
    });
  });
});

describe("specOutcome", () => {
  it("is not done without a value, NA without a limit", () => {
    expect(specOutcome(null, { kind: "min", min: 14 })).toBe("not_done");
    expect(specOutcome(Number.NaN, { kind: "min", min: 14 })).toBe("not_done");
    expect(specOutcome(2.9, { kind: "na" })).toBe("na");
    expect(specOutcome(2.9, undefined)).toBe("na");
  });

  it("judges the value against the spec", () => {
    expect(specOutcome(15.2, { kind: "min", min: 14 })).toBe("pass");
    expect(specOutcome(13.9, { kind: "min", min: 14 })).toBe("fail");
    expect(specOutcome(0.48, { kind: "max", max: 5 })).toBe("pass");
  });

  it("judges at the shown precision", () => {
    // 13.996 shows as 14.00 at two decimals, so it meets ≥ 14.00.
    expect(specOutcome(13.996, { kind: "min", min: 14 }, 2)).toBe("pass");
    expect(specOutcome(13.996, { kind: "min", min: 14 })).toBe("fail");
  });
});
