import { describe, expect, it } from "vitest";
import {
  ADDED_CARTON_ROWS,
  CARTONS_PER_PAGE,
  cartonPageOf,
  cartonRows,
  cartonRowsShown,
  clearCartonRow,
  MIN_CARTON_ROWS,
  nextCartonRow,
  pastedCartons,
  pasteCartons,
  pasteMessage,
  readCartonNumber,
  readTypedCarton,
  refusalMessage,
  setCartonRow,
  splitCartonText,
  withoutTrailingBlanks,
} from "./edit";
import { CartonSamplingDataSchema, emptyCartonSampling, MAX_CARTONS_PER_SIZE, type CartonSamplingData } from "./schema";

/** Size M with three cartons in rows 1 to 3, and XS saved for a size no longer ordered. */
const SAVED: CartonSamplingData = { sizes: { XS: { cartonNumbers: [7] }, M: { cartonNumbers: [32, 578, 1186] } } };

/** The rows of size M. */
const rowsOfM = (data: CartonSamplingData) => cartonRows(data, "M");

describe("carton table: what is typed or pasted", () => {
  it("splits a pasted list on spaces, tabs, new lines, commas and semicolons", () => {
    expect(splitCartonText("32 578,1186;2389\n2865\t7\r\n 8 ,, ; ")).toEqual(["32", "578", "1186", "2389", "2865", "7", "8"]);
    // A spreadsheet column.
    expect(splitCartonText("1186\r\n2389\r\n")).toEqual(["1186", "2389"]);
    expect(splitCartonText(" , ;\n")).toEqual([]);
  });

  it("reads a carton number as a whole number from 1, digits only", () => {
    expect(readCartonNumber("525")).toBe(525);
    expect(readCartonNumber(" 0525 ")).toBe(525);
    for (const bad of ["", "0", "000", "-3", "+3", "52.5", "52,5", "5a", "2 42", "1e3", "١٢", "99999999999999999999"]) {
      expect(readCartonNumber(bad), bad).toBeNull();
    }
  });

  it("takes one number per row: typed text holding several is refused, never split (6.2 rule 1)", () => {
    expect(readTypedCarton("525")).toEqual({ kind: "carton", carton: 525 });
    expect(readTypedCarton(" 0525, ")).toEqual({ kind: "carton", carton: 525 });
    expect(readTypedCarton("52.5")).toEqual({ kind: "refused", refusal: { reason: "not_a_carton", raw: "52.5" } });
    expect(readTypedCarton("abc")).toEqual({ kind: "refused", refusal: { reason: "not_a_carton", raw: "abc" } });
    expect(readTypedCarton(" 2 42 ")).toEqual({ kind: "refused", refusal: { reason: "several", raw: "2 42" } });
    expect(readTypedCarton("32,578")).toEqual({ kind: "refused", refusal: { reason: "several", raw: "32,578" } });
    // Nothing typed empties the row.
    expect(readTypedCarton("   ")).toEqual({ kind: "empty" });
    expect(readTypedCarton(",;")).toEqual({ kind: "empty" });
    expect(readTypedCarton("")).toEqual({ kind: "empty" });
  });

  it("fills rows from a paste of several numbers; one number is pasted into the row as text", () => {
    expect(pastedCartons("32\n578")).toEqual(["32", "578"]);
    expect(pastedCartons("32, 578; 1186 2389")).toEqual(["32", "578", "1186", "2389"]);
    expect(pastedCartons("525")).toBeNull();
    expect(pastedCartons(" 525\n")).toBeNull();
    expect(pastedCartons("")).toBeNull();
  });
});

describe("carton table: rows and pages", () => {
  it("shows a row per case the plan samples, at least 10, more when more are saved or asked for, at most a size's", () => {
    expect(MIN_CARTON_ROWS).toBe(10);
    expect(cartonRowsShown(50, 0)).toBe(50);
    expect(cartonRowsShown(13, 0)).toBe(13);
    // A plan of 5 cases still offers 10 rows; so does no plan yet.
    expect(cartonRowsShown(5, 0)).toBe(10);
    expect(cartonRowsShown(null, 0)).toBe(10);
    expect(cartonRowsShown(0, 0)).toBe(10);
    // Saved past the plan: every saved row shows.
    expect(cartonRowsShown(50, 63)).toBe(63);
    expect(cartonRowsShown(null, 12)).toBe(12);
    // Add 10 Rows.
    expect(ADDED_CARTON_ROWS).toBe(10);
    expect(cartonRowsShown(50, 50, 60)).toBe(60);
    expect(cartonRowsShown(50, 70, 60)).toBe(70);
    expect(cartonRowsShown(3000, 0)).toBe(MAX_CARTONS_PER_SIZE);
    expect(cartonRowsShown(50, 0, MAX_CARTONS_PER_SIZE + 10)).toBe(MAX_CARTONS_PER_SIZE);
  });

  it("pages the table 10 rows at a time", () => {
    expect(CARTONS_PER_PAGE).toBe(10);
    expect(cartonPageOf(0)).toBe(0);
    expect(cartonPageOf(9)).toBe(0);
    expect(cartonPageOf(10)).toBe(1);
    expect(cartonPageOf(19)).toBe(1);
    expect(cartonPageOf(49)).toBe(4);
    expect(cartonPageOf(-1)).toBe(0);
  });

  it("moves Enter to the next row and Shift+Enter to the one before, never past the rows shown", () => {
    expect(nextCartonRow(0, 50, 1)).toBe(1);
    // The last row of page 1: on to the first of page 2.
    expect(nextCartonRow(9, 50, 1)).toBe(10);
    expect(nextCartonRow(10, 50, -1)).toBe(9);
    // The last row: Enter adds no row.
    expect(nextCartonRow(49, 50, 1)).toBeNull();
    expect(nextCartonRow(0, 50, -1)).toBeNull();
  });
});

describe("carton table edits", () => {
  it("stores a number in its row, the rows before it empty, and keeps every other size", () => {
    const { data, refusal } = setCartonRow(SAVED, "M", 5, 2389);
    expect(refusal).toBeNull();
    // Row 6: rows 4 and 5 stay empty, nothing moves up.
    expect(rowsOfM(data)).toEqual([32, 578, 1186, null, null, 2389]);
    expect(data.sizes.XS).toBe(SAVED.sizes.XS);
    expect(setCartonRow(emptyCartonSampling(), "S", 0, 51).data).toEqual({ sizes: { S: { cartonNumbers: [51] } } });
    expect(CartonSamplingDataSchema.parse(data)).toEqual(data);
    // A number replaces the one its row held.
    expect(rowsOfM(setCartonRow(SAVED, "M", 1, 600).data)).toEqual([32, 600, 1186]);
  });

  it("refuses a number another row of the size holds, saying which row, and saves nothing (6.2 rule 6)", () => {
    const { data, refusal } = setCartonRow(SAVED, "M", 4, 578);
    expect(data).toBe(SAVED);
    expect(refusal).toEqual({ reason: "listed", raw: "578", carton: 578, index: 1 });
    // The row holding it already: nothing to do, nothing refused.
    expect(setCartonRow(SAVED, "M", 1, 578)).toEqual({ data: SAVED, refusal: null });
    // Unique per size: another size may hold the same number.
    expect(rowsOfM(setCartonRow(SAVED, "XS", 1, 578).data)).toEqual([32, 578, 1186]);
    expect(setCartonRow(SAVED, "XS", 1, 578).data.sizes.XS.cartonNumbers).toEqual([7, 578]);
  });

  it("empties a row when its text is cleared: the rows below keep their place, empty rows at the end go", () => {
    const filled: CartonSamplingData = { sizes: { M: { cartonNumbers: [32, 578, 1186, 2389] } } };
    expect(rowsOfM(setCartonRow(filled, "M", 1, null).data)).toEqual([32, null, 1186, 2389]);
    expect(rowsOfM(clearCartonRow(filled, "M", 1))).toEqual([32, null, 1186, 2389]);
    // The last row: it and the empty rows before it are not stored.
    const gap: CartonSamplingData = { sizes: { M: { cartonNumbers: [32, null, null, 2389] } } };
    expect(rowsOfM(clearCartonRow(gap, "M", 3))).toEqual([32]);
    expect(rowsOfM(clearCartonRow(clearCartonRow(gap, "M", 0), "M", 3))).toEqual([]);
    expect(withoutTrailingBlanks([null, 3, null, null])).toEqual([null, 3]);
  });

  it("changes nothing when nothing changes: the same data comes back, so nothing is saved", () => {
    expect(setCartonRow(SAVED, "M", 0, 32).data).toBe(SAVED);
    // An empty row emptied, past the saved rows or in a size never touched.
    expect(clearCartonRow(SAVED, "M", 7)).toBe(SAVED);
    expect(clearCartonRow(SAVED, "L", 0)).toBe(SAVED);
    expect(clearCartonRow({ sizes: { M: { cartonNumbers: [32, null, 578] } } }, "M", 1)).toEqual({
      sizes: { M: { cartonNumbers: [32, null, 578] } },
    });
    expect(setCartonRow(SAVED, "M", -1, 5).data).toBe(SAVED);
    expect(setCartonRow(SAVED, "M", 1.5, 5).data).toBe(SAVED);
  });

  it("shows a list saved before in rows 1 to n, and a grid's blanks in their rows; an edit moves nothing", () => {
    // Saved in the order entered, without gaps: rows 1 to 3.
    expect(rowsOfM(SAVED)).toEqual([32, 578, 1186]);
    expect(rowsOfM(setCartonRow(SAVED, "M", 3, 2389).data)).toEqual([32, 578, 1186, 2389]);
    // Saved from the 10 x 5 grid: the blanks stay where they were.
    const grid: CartonSamplingData = { sizes: { M: { cartonNumbers: [32, null, 578, null, null, 1186] } } };
    expect(rowsOfM(setCartonRow(grid, "M", 1, 2389).data)).toEqual([32, 2389, 578, null, null, 1186]);
    expect(rowsOfM(clearCartonRow(grid, "M", 2))).toEqual([32, null, null, null, null, 1186]);
    // A number between the blanks is still held: refused, the saved list left as it was.
    expect(setCartonRow(grid, "M", 3, 578)).toEqual({
      data: grid,
      refusal: { reason: "listed", raw: "578", carton: 578, index: 2 },
    });
    // A list saved with a repeat keeps it; a row holding it may keep it.
    const twice: CartonSamplingData = { sizes: { M: { cartonNumbers: [525, 578, 525] } } };
    expect(setCartonRow(twice, "M", 2, 525).data).toBe(twice);
    expect(setCartonRow(twice, "M", 4, 525).refusal).toEqual({ reason: "listed", raw: "525", carton: 525, index: 0 });
  });

  it("never stores a row past what a size holds", () => {
    const { data, refusal } = setCartonRow(SAVED, "M", MAX_CARTONS_PER_SIZE, 5000);
    expect(data).toBe(SAVED);
    expect(refusal).toEqual({ reason: "full", raw: "5000", carton: 5000 });
    const last = setCartonRow(SAVED, "M", MAX_CARTONS_PER_SIZE - 1, 5000).data;
    expect(rowsOfM(last)).toHaveLength(MAX_CARTONS_PER_SIZE);
    expect(CartonSamplingDataSchema.safeParse(last).success).toBe(true);
  });
});

describe("carton table: a pasted list", () => {
  it("fills the row pasted into and the rows below, in the order pasted, and keeps every other size", () => {
    const { data, placed, replaced, refused } = pasteCartons(SAVED, "M", 3, ["2389", "2865", "3001"]);
    expect(rowsOfM(data)).toEqual([32, 578, 1186, 2389, 2865, 3001]);
    expect(placed).toEqual([
      { index: 3, carton: 2389 },
      { index: 4, carton: 2865 },
      { index: 5, carton: 3001 },
    ]);
    expect(replaced).toBe(0);
    expect(refused).toEqual([]);
    expect(data.sizes.XS).toBe(SAVED.sizes.XS);
    expect(CartonSamplingDataSchema.parse(data)).toEqual(data);
    // Into an empty size's row 1, and past the rows shown: the table grows with the rows saved.
    const many = pasteCartons(emptyCartonSampling(), "S", 0, Array.from({ length: 63 }, (_, offset) => String(offset + 1)));
    expect(cartonRows(many.data, "S")).toHaveLength(63);
    expect(cartonRowsShown(50, cartonRows(many.data, "S").length)).toBe(63);
  });

  it("starts in an empty row past the saved ones, leaving the rows between empty", () => {
    expect(rowsOfM(pasteCartons(SAVED, "M", 5, ["2389", "2865"]).data)).toEqual([32, 578, 1186, null, null, 2389, 2865]);
  });

  it("leaves out text that is no carton number, a number another row holds and a repeat, in the order pasted, closing up", () => {
    const { data, placed, refused } = pasteCartons(SAVED, "M", 3, ["2389", "abc", "578", "2865", "2389", "0"]);
    // The numbers kept fill rows 4 and 5: nothing left out leaves a gap.
    expect(rowsOfM(data)).toEqual([32, 578, 1186, 2389, 2865]);
    expect(placed.map((entry) => entry.index)).toEqual([3, 4]);
    expect(refused).toEqual([
      { reason: "not_a_carton", raw: "abc" },
      { reason: "listed", raw: "578", carton: 578, index: 1 },
      // Given twice in the paste: the row its first went to.
      { reason: "listed", raw: "2389", carton: 2389, index: 3 },
      { reason: "not_a_carton", raw: "0" },
    ]);
  });

  it("pastes over the rows it fills, as a spreadsheet does: their numbers are no repeats", () => {
    const filled: CartonSamplingData = { sizes: { M: { cartonNumbers: [32, 578, 1186] } } };
    // The same list in another order, into row 1: every row replaced, nothing refused.
    const again = pasteCartons(filled, "M", 0, ["1186", "32", "578"]);
    expect(rowsOfM(again.data)).toEqual([1186, 32, 578]);
    expect(again.refused).toEqual([]);
    expect(again.replaced).toBe(3);
    // Into row 2: 32 stays in row 1, so the pasted 32 is a repeat; 1186 is pasted over.
    const over = pasteCartons(filled, "M", 1, ["32", "900", "1186"]);
    expect(rowsOfM(over.data)).toEqual([32, 900, 1186]);
    expect(over.refused).toEqual([{ reason: "listed", raw: "32", carton: 32, index: 0 }]);
    expect(over.replaced).toBe(1);
  });

  it("takes a number held in a row the paste no longer reaches as a repeat", () => {
    // Rows 1 to 4. "2389 32 1186" into row 1 would fill rows 1 to 3, but 2389 stays in row 4, so it
    // is left out; filling rows 1 and 2 leaves 1186 in row 3, so it is left out too; 32 fills row 1,
    // which held it: nothing to save.
    const filled: CartonSamplingData = { sizes: { M: { cartonNumbers: [32, 578, 1186, 2389] } } };
    const { data, placed, replaced, refused } = pasteCartons(filled, "M", 0, ["2389", "32", "1186"]);
    expect(data).toBe(filled);
    expect(placed).toEqual([{ index: 0, carton: 32 }]);
    expect(replaced).toBe(0);
    expect(refused).toEqual([
      { reason: "listed", raw: "2389", carton: 2389, index: 3 },
      { reason: "listed", raw: "1186", carton: 1186, index: 2 },
    ]);
    // Without the number left out, the rows the paste reaches are pasted over.
    const shorter = pasteCartons(filled, "M", 0, ["2389", "578", "900"]);
    expect(rowsOfM(shorter.data)).toEqual([578, 900, 1186, 2389]);
    expect(shorter.refused).toEqual([{ reason: "listed", raw: "2389", carton: 2389, index: 3 }]);
    expect(shorter.replaced).toBe(2);
  });

  it("changes nothing when it fills no row, and never stores a row past what a size holds", () => {
    const none = pasteCartons(SAVED, "M", 3, ["578", "x", "32"]);
    expect(none.data).toBe(SAVED);
    expect(none.placed).toEqual([]);
    expect(none.refused.map((entry) => entry.reason)).toEqual(["listed", "not_a_carton", "listed"]);
    expect(pasteCartons(SAVED, "M", 3, []).data).toBe(SAVED);
    // Two rows left: the third number is past them.
    const nearly = pasteCartons(emptyCartonSampling(), "M", MAX_CARTONS_PER_SIZE - 2, ["5000", "5001", "5002", "5000"]);
    expect(nearly.placed).toEqual([
      { index: MAX_CARTONS_PER_SIZE - 2, carton: 5000 },
      { index: MAX_CARTONS_PER_SIZE - 1, carton: 5001 },
    ]);
    expect(nearly.refused).toEqual([
      { reason: "full", raw: "5002", carton: 5002 },
      { reason: "listed", raw: "5000", carton: 5000, index: MAX_CARTONS_PER_SIZE - 2 },
    ]);
    expect(rowsOfM(nearly.data)).toHaveLength(MAX_CARTONS_PER_SIZE);
    expect(CartonSamplingDataSchema.safeParse(nearly.data).success).toBe(true);
  });
});

describe("carton table messages", () => {
  it("says in a short sentence why a row refused an entry", () => {
    expect(refusalMessage({ reason: "listed", raw: "42", carton: 42, index: 6 })).toBe("Box/Carton #42 is already in row 7.");
    expect(refusalMessage({ reason: "not_a_carton", raw: "52.5" })).toBe("“52.5” is not a box/carton number: whole numbers from 1 only.");
    expect(refusalMessage({ reason: "several", raw: "2 42" })).toBe(
      "“2 42” is more than one number. Type one box/carton number per row, or paste the list.",
    );
    expect(refusalMessage({ reason: "full", raw: "5001", carton: 5001 })).toBe(
      "Box/Carton #5001 is not added: a size holds at most 2,000 box/carton numbers.",
    );
  });

  it("sums up a paste in one line: the rows it filled, then what was left out and why", () => {
    const all = pasteCartons(SAVED, "M", 3, ["2389", "2865", "3001"]);
    expect(pasteMessage(all)).toBe("Pasted 3 box/carton numbers into rows 4 to 6.");
    expect(pasteMessage(pasteCartons(SAVED, "M", 3, ["2389", "abc"]))).toBe(
      "Pasted 1 box/carton number into row 4. Left out: “abc” (not a box/carton number).",
    );
    const some = pasteCartons(SAVED, "M", 3, ["32", "578", "abc", "2389", "x1", "2389"]);
    expect(pasteMessage(some)).toBe(
      "Pasted 1 box/carton number into row 4. Left out: 32 (already in row 1), 578 (already in row 2), “abc” (not a box/carton number), “x1” (not a box/carton number), 2389 (already in row 4).",
    );
    // Pasted over numbers: said so.
    expect(pasteMessage(pasteCartons(SAVED, "M", 1, ["900", "901"]))).toBe(
      "Pasted 2 box/carton numbers into rows 2 to 3, replacing 2 numbers.",
    );
    // Nothing filled; the same entry twice is named once; more than five are counted.
    expect(pasteMessage(pasteCartons(SAVED, "M", 3, ["32", "32", "578"]))).toBe(
      "No box/carton numbers pasted. Left out: 32 (already in row 1), 578 (already in row 2).",
    );
    const many = pasteCartons(SAVED, "M", 3, ["a", "b", "c", "d", "e", "f", "g"]);
    expect(pasteMessage(many)).toBe(
      "No box/carton numbers pasted. Left out: “a” (not a box/carton number), “b” (not a box/carton number), “c” (not a box/carton number), “d” (not a box/carton number), “e” (not a box/carton number) and 2 more.",
    );
  });
});
