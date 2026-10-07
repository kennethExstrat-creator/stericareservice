// The numbers-only rule as NumericCell applies it (BUILD_SPEC 6.2 rule 1):
// what is stored, what is shown and what is said when a cell is left.
import { describe, expect, it } from "vitest";
import { readDecimal } from "@/lib/stats";
import {
  commitChange,
  commitEntry,
  entryKeyAction,
  entryText,
  readEntry,
  rejectionMessage,
  showsEntryError,
  type InvalidEntry,
} from "./numeric-entry";

const SPACE_ERROR = "One number per cell: remove the space, e.g. 2.42.";
const rejected = (raw: string, error = SPACE_ERROR): InvalidEntry => ({ raw, error });

describe("commitEntry", () => {
  it("stores a number", () => {
    expect(commitEntry("2.42")).toEqual({ value: 2.42, invalid: null });
    expect(commitEntry(" 243 ")).toEqual({ value: 243, invalid: null });
    expect(commitEntry("2,42")).toEqual({ value: 2.42, invalid: null });
  });

  it("stores blank as no value", () => {
    expect(commitEntry("")).toEqual({ value: null, invalid: null });
    expect(commitEntry("   ")).toEqual({ value: null, invalid: null });
  });

  it('rejects "2 42": nothing is stored and the text is kept exactly as typed', () => {
    expect(commitEntry("2 42")).toEqual({ value: null, invalid: rejected("2 42") });
    expect(commitEntry(" 2 42 ").invalid?.raw).toBe(" 2 42 ");
  });

  it("never stores text", () => {
    for (const raw of ["abc", "12mm", "2.4.2", "1e3", "NaN", "Infinity", "9".repeat(400)]) {
      const entry = commitEntry(raw);
      expect(entry.value, raw).toBeNull();
      expect(entry.invalid?.raw, raw).toBe(raw);
    }
  });

  it("rejects a number outside the measure's limits", () => {
    expect(commitEntry("401", { min: 0, max: 400 })).toEqual({
      value: null,
      invalid: rejected("401", "Must be 400 or less."),
    });
    expect(commitEntry("-1", { min: 0 }).invalid?.error).toBe("Must be 0 or more.");
    expect(commitEntry("400", { min: 0, max: 400 })).toEqual({ value: 400, invalid: null });
  });

  it("refuses the minimum itself when it is exclusive: a force or a length is more than 0", () => {
    expect(commitEntry("0", { min: 0, minExclusive: true })).toEqual({
      value: null,
      invalid: rejected("0", "Must be more than 0."),
    });
    expect(commitEntry("-2", { min: 0, minExclusive: true }).invalid?.error).toBe("Must be more than 0.");
    expect(commitEntry("0.001", { min: 0, minExclusive: true })).toEqual({ value: 0.001, invalid: null });
    expect(commitEntry("0", { min: 0 })).toEqual({ value: 0, invalid: null });
    // The maximum still applies, and blank is still no value.
    expect(commitEntry("6", { min: 0, max: 5, minExclusive: true }).invalid?.error).toBe("Must be 5 or less.");
    expect(commitEntry("", { min: 0, minExclusive: true })).toEqual({ value: null, invalid: null });
  });
});

describe("readEntry", () => {
  it("is lib/stats' readDecimal without an exclusive minimum", () => {
    expect(readEntry("2 42")).toEqual(readDecimal("2 42"));
    expect(readEntry("3", { min: 4 })).toEqual(readDecimal("3", { min: 4 }));
    expect(readEntry("3", { minExclusive: true })).toEqual({ ok: true, value: 3 });
  });
});

describe("commitChange (NumericCell's commit decision)", () => {
  const empty = { value: null, invalid: null };

  it("stores a new reading", () => {
    expect(commitChange("2.42", empty)).toEqual({ value: 2.42 });
    expect(commitChange("2.43", { value: 2.42, invalid: null })).toEqual({ value: 2.43 });
  });

  it("clears a held reading when the new text is rejected, so a stale value never feeds a statistic", () => {
    expect(commitChange("2 42", { value: 2.42, invalid: null })).toEqual({
      value: null,
      invalid: rejected("2 42"),
    });
  });

  it("records a rejection in an empty cell without touching the value", () => {
    expect(commitChange("2 42", empty)).toEqual({ invalid: rejected("2 42") });
  });

  it("replaces one rejection with the next", () => {
    expect(commitChange("abc", { value: null, invalid: rejected("2 42") })).toEqual({
      invalid: rejected("abc", "Numbers only, e.g. 2.42."),
    });
  });

  it("clears an earlier rejection once the entry is a number", () => {
    expect(commitChange("2.42", { value: null, invalid: rejected("2 42") })).toEqual({
      value: 2.42,
      invalid: null,
    });
  });

  it("clears an earlier rejection when the cell is emptied", () => {
    expect(commitChange("", { value: null, invalid: rejected("2 42") })).toEqual({ invalid: null });
  });

  it("changes nothing when the reading is committed again", () => {
    expect(commitChange("2.42", { value: 2.42, invalid: null })).toEqual({});
    expect(commitChange("", empty)).toEqual({});
  });

  it("applies the measure's limits", () => {
    expect(commitChange("6", { value: 0.07, invalid: null }, { min: 0, max: 5 })).toEqual({
      value: null,
      invalid: rejected("6", "Must be 5 or less."),
    });
  });
});

describe("entryKeyAction", () => {
  it("commits on Enter, editing or not", () => {
    expect(entryKeyAction("Enter", true)).toBe("commit");
    expect(entryKeyAction("Enter", false)).toBe("commit");
  });

  it("reverts on Escape only while editing", () => {
    expect(entryKeyAction("Escape", true)).toBe("revert");
    expect(entryKeyAction("Escape", false)).toBeNull();
  });

  it("leaves every other key to the input or the grid", () => {
    for (const key of ["Tab", "ArrowDown", "ArrowRight", "5", ".", "Backspace"]) {
      expect(entryKeyAction(key, true), key).toBeNull();
    }
  });
});

describe("entryText", () => {
  it("shows the edit in progress first", () => {
    expect(entryText("2.4", null, 2.42)).toBe("2.4");
    expect(entryText("", rejected("2 42"), null)).toBe("");
  });

  it("shows a rejected entry as typed, never as a value", () => {
    expect(entryText(null, rejected("2 42"), null)).toBe("2 42");
  });

  it("shows the stored reading padded to the measure's decimals, never rounded", () => {
    expect(entryText(null, null, 0.1, 2)).toBe("0.10");
    expect(entryText(null, null, 0.105, 2)).toBe("0.105");
    expect(entryText(null, null, null, 2)).toBe("");
  });

  it("falls back to what the cell held once Escape drops the edit", () => {
    const held = { value: 243, invalid: null };
    expect(entryText("2 4", held.invalid, held.value)).toBe("2 4");
    // Escape: entryKeyAction says revert, the draft becomes null.
    expect(entryKeyAction("Escape", true)).toBe("revert");
    expect(entryText(null, held.invalid, held.value)).toBe("243");
    expect(entryText(null, rejected("2 42"), null)).toBe("2 42");
  });
});

describe("showsEntryError", () => {
  it("shows a rejection while the cell is not being edited", () => {
    expect(showsEntryError(rejected("2 42"), null)).toBe(true);
    expect(showsEntryError(null, null)).toBe(false);
  });

  it("clears as soon as the edit becomes a valid number, and returns if it stops being one", () => {
    expect(showsEntryError(rejected("2 42"), "2.4")).toBe(false);
    expect(showsEntryError(rejected("2 42"), "")).toBe(false);
    expect(showsEntryError(rejected("2 42"), "2.4 ")).toBe(false);
    expect(showsEntryError(rejected("2 42"), "2.4 2")).toBe(true);
  });

  it("judges the edit against the limits", () => {
    expect(showsEntryError(rejected("401", "Must be 400 or less."), "401", { max: 400 })).toBe(true);
    expect(showsEntryError(rejected("401", "Must be 400 or less."), "400", { max: 400 })).toBe(false);
    expect(showsEntryError(rejected("0", "Must be more than 0."), "0", { min: 0, minExclusive: true })).toBe(true);
    expect(showsEntryError(rejected("0", "Must be more than 0."), "0.5", { min: 0, minExclusive: true })).toBe(false);
  });
});

describe("rejectionMessage", () => {
  it("says what was not stored and why", () => {
    expect(rejectionMessage(rejected("2 42"))).toBe(`“2 42” is not stored. ${SPACE_ERROR}`);
  });

  it("names the cell for the grid's announcement, as its label does", () => {
    expect(rejectionMessage(rejected("9 5"), "Width, No. 3")).toBe(`Width, No. 3: “9 5” is not stored. ${SPACE_ERROR}`);
  });
});
