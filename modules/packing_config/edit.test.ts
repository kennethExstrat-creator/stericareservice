// The packing configuration's edits, applied as Capture applies them: through
// the kit's data updater (useDataUpdater), each built from the latest data.
import { describe, expect, it } from "vitest";
import { batchDataChanges, createDataUpdater } from "@/components/qc/data-updater";
import { setCount, setPackingMode, tidyPackingMode, withWorkedOutGlovesPerCase } from "./edit";
import { emptyPackingConfig, PackingConfigDataSchema, TEXT_MAX_LENGTH, type PackingConfigData } from "./schema";

const packing = (glovesPerInner: number | null, innersPerCase: number | null, glovesPerCase: number | null): PackingConfigData => ({
  ...emptyPackingConfig(),
  glovesPerInner,
  innersPerCase,
  glovesPerCase,
});

describe("packing_config edits", () => {
  it("sets one count and leaves the others while the gloves per case cannot be worked out", () => {
    const next = setCount(emptyPackingConfig(), "glovesPerInner", 200);
    expect(next).toEqual(packing(200, null, null));
    expect(setCount(next, "glovesPerInner", 200)).toBe(next);
  });

  it("writes the product as the gloves per case once both other counts are entered (Kenneth, 27 October 2026)", () => {
    const next = setCount(packing(100, null, null), "innersPerCase", 10);
    expect(next).toEqual(packing(100, 10, 1000));
    expect(PackingConfigDataSchema.safeParse(next).success).toBe(true);
    expect(setCount(next, "innersPerCase", 10)).toBe(next);
  });

  it("works it out again at every edit of either count, over a stored one that is not the product (data saved before)", () => {
    expect(setCount(packing(100, 10, 1000), "innersPerCase", 12)).toEqual(packing(100, 12, 1200));
    expect(setCount(packing(100, 10, 1000), "glovesPerInner", 50)).toEqual(packing(50, 10, 500));
    expect(setCount(packing(200, 10, 2500), "innersPerCase", 12)).toEqual(packing(200, 12, 2400));
    // The same count again still puts the product in place of one that is not it.
    expect(setCount(packing(200, 10, 2500), "glovesPerInner", 200)).toEqual(packing(200, 10, 2000));
  });

  it("keeps the gloves per case when either count is cleared, and takes it typed while one is missing", () => {
    const cleared = setCount(packing(200, 10, 2000), "innersPerCase", null);
    expect(cleared).toEqual(packing(200, null, 2000));
    const typed = setCount(cleared, "glovesPerCase", 1800);
    expect(typed).toEqual(packing(200, null, 1800));
    expect(setCount(typed, "innersPerCase", 10)).toEqual(packing(200, 10, 2000));
    // A document that states only the gloves per case.
    expect(setCount(emptyPackingConfig(), "glovesPerCase", 2000)).toEqual(packing(null, null, 2000));
  });

  it("keeps the packing mode as typed, then trims it once it is left", () => {
    const typed = setPackingMode(emptyPackingConfig(), " 10 dispenser boxes ");
    expect(typed.packingMode).toBe(" 10 dispenser boxes ");
    expect(tidyPackingMode(typed).packingMode).toBe("10 dispenser boxes");
    expect(tidyPackingMode(setPackingMode(typed, "   ")).packingMode).toBeNull();
    expect(setPackingMode(typed, "").packingMode).toBeNull();
    const tidy = tidyPackingMode(typed);
    expect(tidyPackingMode(tidy)).toBe(tidy);
  });

  it("cuts the packing mode to the schema's limit, never through a character, so the data always loads", () => {
    const typed = setPackingMode(emptyPackingConfig(), "x".repeat(TEXT_MAX_LENGTH + 240));
    expect(typed.packingMode).toBe("x".repeat(TEXT_MAX_LENGTH));
    expect(PackingConfigDataSchema.safeParse(typed).success).toBe(true);
    expect(PackingConfigDataSchema.safeParse(tidyPackingMode(typed)).success).toBe(true);
    // An emoji is two UTF-16 units: one that would straddle the limit is left out whole.
    const straddling = `${"x".repeat(TEXT_MAX_LENGTH - 1)}\u{1F9E4}`;
    expect(setPackingMode(emptyPackingConfig(), straddling).packingMode).toBe("x".repeat(TEXT_MAX_LENGTH - 1));
  });

  it("stores the three counts pasted as one run in one change, none lost", () => {
    const changes: PackingConfigData[] = [];
    const updater = createDataUpdater(emptyPackingConfig(), (next) => changes.push(next));
    // A paste of "200, 10, 2000" into the first count: each field stores its value inside one batch.
    batchDataChanges(() => {
      updater.update((current) => setCount(current, "glovesPerInner", 200));
      updater.update((current) => setCount(current, "innersPerCase", 10));
      updater.update((current) => setCount(current, "glovesPerCase", 2000));
    });
    expect(changes).toEqual([{ glovesPerInner: 200, innersPerCase: 10, glovesPerCase: 2000, packingMode: null }]);
  });

  it("keeps a third pasted value that is not the product as pasted, for calc to warn about", () => {
    const changes: PackingConfigData[] = [];
    const updater = createDataUpdater(emptyPackingConfig(), (next) => changes.push(next));
    batchDataChanges(() => {
      updater.update((current) => setCount(current, "glovesPerInner", 200));
      updater.update((current) => setCount(current, "innersPerCase", 10));
      updater.update((current) => setCount(current, "glovesPerCase", 2500));
    });
    expect(changes).toEqual([packing(200, 10, 2500)]);
  });

  it("fills a gloves per case Steri-AI left empty beside both counts with their product, and leaves any other", () => {
    expect(withWorkedOutGlovesPerCase(packing(100, 10, null))).toEqual(packing(100, 10, 1000));
    const stated = packing(100, 10, 1200);
    expect(withWorkedOutGlovesPerCase(stated)).toBe(stated);
    const half = packing(100, null, null);
    expect(withWorkedOutGlovesPerCase(half)).toBe(half);
  });
});
