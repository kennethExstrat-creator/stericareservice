// The header's edits, applied as Capture applies them: through the kit's
// data updater (useDataUpdater), each built from the latest data.
import { describe, expect, it } from "vitest";
import { createDataUpdater } from "@/components/qc/data-updater";
import { STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { headerData } from "./__fixtures__/examples";
import { followFactoryAddress, setDate, setText, tidyText } from "./edit";
import { emptyHeader, HEADER_TEXT_FIELDS, HeaderDataSchema, TEXT_MAX_LENGTH, type HeaderData } from "./schema";

const FILLED = headerData(STD_EG_EXAMPLE.header);

describe("header edits", () => {
  it("keeps text as typed, spaces between words included, and blank as null", () => {
    expect(setText(emptyHeader(), "poNo", "PO-0001 ")).toEqual({ ...emptyHeader(), poNo: "PO-0001 " });
    expect(setText(FILLED, "poNo", "").poNo).toBeNull();
  });

  it("trims a field once it is left, and leaves a tidy one as it was", () => {
    expect(tidyText({ ...FILLED, poNo: "  PO-0001 (SO-0001) " }, "poNo").poNo).toBe("PO-0001 (SO-0001)");
    expect(tidyText({ ...FILLED, factoryGloveCode: "   " }, "factoryGloveCode").factoryGloveCode).toBeNull();
    expect(tidyText(FILLED, "poNo")).toBe(FILLED);
  });

  it("keeps only a date the schema accepts: a five-digit year being typed is no date (6.2 rule 3)", () => {
    expect(setDate(emptyHeader(), "mfgDate", "2025-04-01").mfgDate).toBe("2025-04-01");
    for (const value of ["20255-04-01", "+020255-04-01", "", null]) {
      const next = setDate(FILLED, "mfgDate", value);
      expect(next.mfgDate).toBeNull();
      expect(HeaderDataSchema.safeParse(next).success).toBe(true);
    }
  });

  it("cuts text to the schema's limit, never through a character, so the header always loads", () => {
    for (const field of HEADER_TEXT_FIELDS) {
      const next = setText(FILLED, field, "x".repeat(TEXT_MAX_LENGTH + 240));
      expect(next[field]).toBe("x".repeat(TEXT_MAX_LENGTH));
      expect(HeaderDataSchema.safeParse(next).success).toBe(true);
      expect(HeaderDataSchema.safeParse(tidyText(setText(FILLED, field, ` ${"x".repeat(TEXT_MAX_LENGTH)}`), field)).success).toBe(
        true,
      );
    }
    // An emoji is two UTF-16 units: one that would straddle the limit is left out whole.
    const straddling = `${"x".repeat(TEXT_MAX_LENGTH - 1)}\u{1F9E4}`;
    expect(setText(FILLED, "productName", straddling).productName).toBe("x".repeat(TEXT_MAX_LENGTH - 1));
  });

  it("returns the data itself when nothing changes, so no change is saved", () => {
    expect(setText(FILLED, "poNo", FILLED.poNo ?? "")).toBe(FILLED);
    expect(setDate(FILLED, "expiryDate", FILLED.expiryDate)).toBe(FILLED);
  });

  it("keeps both of two changes made in one event: a field tidied on blur and the next one typed", () => {
    const changes: HeaderData[] = [];
    const updater = createDataUpdater<HeaderData>({ ...emptyHeader(), poNo: "PO-0001 " }, (next) => changes.push(next));
    updater.update((current) => tidyText(current, "poNo"));
    updater.update((current) => setText(current, "productCode", "P"));
    updater.update((current) => setDate(current, "mfgDate", "2025-04-01"));
    expect(changes.at(-1)).toEqual({ ...emptyHeader(), poNo: "PO-0001", productCode: "P", mfgDate: "2025-04-01" });
  });

  describe("the factory address when the manufacturer changes", () => {
    const OLD = "Lot 1, Jalan Placeholder 1,\nTown A, Malaysia";
    const NEW = "Lot 2, Jalan Placeholder 2,\nTown B, Malaysia";

    it("takes the new factory's address while the field still holds the old one's", () => {
      expect(followFactoryAddress({ ...FILLED, factoryAddress: OLD }, OLD, NEW)).toEqual({ ...FILLED, factoryAddress: NEW });
      // As the field keeps it once left: trimmed.
      expect(followFactoryAddress({ ...FILLED, factoryAddress: OLD }, ` ${OLD}\n`, ` ${NEW} `).factoryAddress).toBe(NEW);
    });

    it("fills a blank field, and clears the old factory's address when the new one has none", () => {
      expect(followFactoryAddress(emptyHeader(), OLD, NEW).factoryAddress).toBe(NEW);
      expect(followFactoryAddress(emptyHeader(), null, NEW).factoryAddress).toBe(NEW);
      expect(followFactoryAddress({ ...FILLED, factoryAddress: OLD }, OLD, null).factoryAddress).toBeNull();
      expect(followFactoryAddress({ ...FILLED, factoryAddress: OLD }, OLD, "   ").factoryAddress).toBeNull();
    });

    it("never overwrites an address the inspector changed", () => {
      const typed = { ...FILLED, factoryAddress: "Warehouse C, Town C" };
      expect(followFactoryAddress(typed, OLD, NEW)).toBe(typed);
      // The old factory had no address, so whatever is there was typed.
      expect(followFactoryAddress(typed, null, NEW)).toBe(typed);
    });

    it("returns the data itself when nothing changes, and keeps no more than the schema keeps", () => {
      const blank = emptyHeader();
      expect(followFactoryAddress(blank, OLD, null)).toBe(blank);
      const same = { ...FILLED, factoryAddress: NEW };
      expect(followFactoryAddress(same, NEW, NEW)).toBe(same);
      const long = followFactoryAddress(blank, null, "x".repeat(TEXT_MAX_LENGTH + 10));
      expect(long.factoryAddress).toBe("x".repeat(TEXT_MAX_LENGTH));
      expect(HeaderDataSchema.safeParse(long).success).toBe(true);
    });
  });
});
