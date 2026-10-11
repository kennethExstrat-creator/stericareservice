import { describe, expect, it } from "vitest";
import {
  addCartons,
  pastedCartons,
  pasteMessage,
  readCartonNumber,
  readTypedCarton,
  refusalMessage,
  removeCarton,
  splitCartonText,
} from "./edit";
import { CartonSamplingDataSchema, emptyCartonSampling, MAX_CARTONS_PER_SIZE, type CartonSamplingData } from "./schema";

/** Size M with three cartons, and XS saved for a size no longer ordered. */
const SAVED: CartonSamplingData = { sizes: { XS: { cartonNumbers: [7] }, M: { cartonNumbers: [32, 578, 1186] } } };

describe("carton list: what is typed or pasted", () => {
  it("splits a pasted list on spaces, tabs, new lines, commas and semicolons", () => {
    expect(splitCartonText("32 578,1186;2389\n2865\t7\r\n 8 ,, ; ")).toEqual(["32", "578", "1186", "2389", "2865", "7", "8"]);
    // A spreadsheet column, and a row copied with no-break spaces.
    expect(splitCartonText("1186\r\n2389\r\n")).toEqual(["1186", "2389"]);
    expect(splitCartonText("32 578")).toEqual(["32", "578"]);
    expect(splitCartonText(" , ;\n")).toEqual([]);
  });

  it("reads a carton number as a whole number from 1, digits only", () => {
    expect(readCartonNumber("525")).toBe(525);
    expect(readCartonNumber(" 0525 ")).toBe(525);
    for (const bad of ["", "0", "000", "-3", "+3", "52.5", "52,5", "5a", "2 42", "1e3", "١٢", "99999999999999999999"]) {
      expect(readCartonNumber(bad), bad).toBeNull();
    }
  });

  it("takes one typed number at a time: typed text holding several is refused, never split (6.2 rule 1)", () => {
    expect(readTypedCarton("525")).toEqual({ kind: "entry", raw: "525" });
    expect(readTypedCarton(" 525, ")).toEqual({ kind: "entry", raw: "525" });
    // One entry, which addCartons refuses.
    expect(readTypedCarton("52.5")).toEqual({ kind: "entry", raw: "52.5" });
    expect(readTypedCarton(" 2 42 ")).toEqual({ kind: "refused", refusal: { reason: "several", raw: "2 42" } });
    expect(readTypedCarton("32,578")).toEqual({ kind: "refused", refusal: { reason: "several", raw: "32,578" } });
    expect(readTypedCarton("   ")).toEqual({ kind: "empty" });
    expect(readTypedCarton(",;")).toEqual({ kind: "empty" });
  });

  it("adds a paste of several numbers at once; one number is pasted into the field as text", () => {
    expect(pastedCartons("32\n578")).toEqual(["32", "578"]);
    expect(pastedCartons("32, 578; 1186 2389")).toEqual(["32", "578", "1186", "2389"]);
    expect(pastedCartons("525")).toBeNull();
    expect(pastedCartons(" 525\n")).toBeNull();
    expect(pastedCartons("")).toBeNull();
  });
});

describe("carton list edits", () => {
  it("adds after the size's numbers, in the order given, and keeps every other size", () => {
    const { data, added, refused } = addCartons(SAVED, "M", ["2389", "2865"]);
    expect(data.sizes.M.cartonNumbers).toEqual([32, 578, 1186, 2389, 2865]);
    expect(added).toEqual([2389, 2865]);
    expect(refused).toEqual([]);
    expect(data.sizes.XS).toBe(SAVED.sizes.XS);
    expect(addCartons(emptyCartonSampling(), "S", ["51"]).data).toEqual({ sizes: { S: { cartonNumbers: [51] } } });
    expect(CartonSamplingDataSchema.parse(data)).toEqual(data);
  });

  it("refuses a number the size already lists, or one given twice, and adds the rest (6.2 rule 6)", () => {
    const { data, added, refused } = addCartons(SAVED, "M", ["578", "2389", "0578", "2389", "2865"]);
    expect(data.sizes.M.cartonNumbers).toEqual([32, 578, 1186, 2389, 2865]);
    expect(added).toEqual([2389, 2865]);
    expect(refused).toEqual([
      { reason: "listed", raw: "578", carton: 578 },
      { reason: "listed", raw: "0578", carton: 578 },
      { reason: "listed", raw: "2389", carton: 2389 },
    ]);
    // Unique per size: another size may list the same number.
    expect(addCartons(SAVED, "XS", ["578"]).data.sizes.XS.cartonNumbers).toEqual([7, 578]);
  });

  it("refuses text that is no carton number, and adds a number above the order quantity, which calc fails", () => {
    const { data, refused } = addCartons(SAVED, "M", ["abc", "0", "52.5", "9999"]);
    expect(data.sizes.M.cartonNumbers).toEqual([32, 578, 1186, 9999]);
    expect(refused.map((entry) => [entry.reason, entry.raw])).toEqual([
      ["not_a_carton", "abc"],
      ["not_a_carton", "0"],
      ["not_a_carton", "52.5"],
    ]);
  });

  it("changes nothing when nothing is added: the same data comes back, so nothing is saved", () => {
    expect(addCartons(SAVED, "M", ["32"]).data).toBe(SAVED);
    expect(addCartons(SAVED, "M", ["x", " "]).data).toBe(SAVED);
    expect(addCartons(SAVED, "M", []).data).toBe(SAVED);
  });

  it("stores a list saved from the grid without its blanks once it is edited", () => {
    const grid: CartonSamplingData = { sizes: { M: { cartonNumbers: [32, null, 578, null, null, 1186] } } };
    expect(addCartons(grid, "M", ["2389"]).data.sizes.M.cartonNumbers).toEqual([32, 578, 1186, 2389]);
    // A number between the blanks is still listed: refused, and the saved list is left as it was.
    expect(addCartons(grid, "M", ["578"]).data).toBe(grid);
    expect(removeCarton(grid, "M", 2, 578).sizes.M.cartonNumbers).toEqual([32, 1186]);
  });

  it("never stores more numbers than the schema keeps", () => {
    const full: CartonSamplingData = {
      sizes: { M: { cartonNumbers: Array.from({ length: MAX_CARTONS_PER_SIZE - 1 }, (_, index) => index + 1) } },
    };
    const { data, added, refused } = addCartons(full, "M", ["5000", "5001"]);
    expect(added).toEqual([5000]);
    expect(refused).toEqual([{ reason: "full", raw: "5001", carton: 5001 }]);
    expect(data.sizes.M.cartonNumbers).toHaveLength(MAX_CARTONS_PER_SIZE);
    expect(CartonSamplingDataSchema.safeParse(data).success).toBe(true);
  });

  it("removes the carton a chip shows, found by its number when the latest data has moved it", () => {
    expect(removeCarton(SAVED, "M", 1, 578).sizes.M.cartonNumbers).toEqual([32, 1186]);
    // The screen still shows 578 at place 1, but 32 was removed meanwhile.
    const moved: CartonSamplingData = { sizes: { M: { cartonNumbers: [578, 1186] } } };
    expect(removeCarton(moved, "M", 1, 578).sizes.M.cartonNumbers).toEqual([1186]);
    // Already gone: nothing is removed twice.
    expect(removeCarton(SAVED, "M", 1, 2389)).toBe(SAVED);
    expect(removeCarton(SAVED, "L", 0, 32)).toBe(SAVED);
    expect(removeCarton(SAVED, "M", 0, 32).sizes.XS).toBe(SAVED.sizes.XS);
    // The last one leaves an empty list.
    expect(removeCarton(SAVED, "XS", 0, 7).sizes.XS).toEqual({ cartonNumbers: [] });
  });
});

describe("carton list messages", () => {
  it("says in a short sentence why an entry was not added", () => {
    expect(refusalMessage({ reason: "listed", raw: "525", carton: 525 })).toBe("Carton 525 is already in the list.");
    expect(refusalMessage({ reason: "not_a_carton", raw: "52.5" })).toBe("“52.5” is not a carton number: whole numbers from 1 only.");
    expect(refusalMessage({ reason: "several", raw: "2 42" })).toBe(
      "“2 42” is more than one number. Add one carton at a time, or paste the list.",
    );
    expect(refusalMessage({ reason: "full", raw: "5001", carton: 5001 })).toBe(
      "Carton 5001 is not added: a size holds at most 2,000 carton numbers.",
    );
  });

  it("sums up a paste: how many were added, then what was left out, by why", () => {
    expect(pasteMessage(8, [])).toBe("Added 8 carton numbers.");
    expect(pasteMessage(1, [])).toBe("Added 1 carton number.");
    const { added, refused } = addCartons(SAVED, "M", ["32", "578", "abc", "2389", "x1"]);
    expect(pasteMessage(added.length, refused)).toBe(
      "Added 1 carton number. Already in the list: 32, 578. Not carton numbers: “abc”, “x1”.",
    );
    // The same list pasted twice: each number named once.
    const again = addCartons(SAVED, "M", ["32", "578", "1186", "32", "578", "1186"]);
    expect(pasteMessage(again.added.length, again.refused)).toBe("No carton numbers added. Already in the list: 32, 578, 1186.");
    const many = addCartons({ sizes: { M: { cartonNumbers: [1, 2, 3, 4, 5, 6, 7] } } }, "M", ["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(pasteMessage(many.added.length, many.refused)).toBe(
      "Added 1 carton number. Already in the list: 1, 2, 3, 4, 5 and 2 more.",
    );
  });
});
