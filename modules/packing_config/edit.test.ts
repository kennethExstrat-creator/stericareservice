// The packing configuration's edits, applied as Capture applies them: through
// the kit's data updater (useDataUpdater), each built from the latest data.
import { describe, expect, it } from "vitest";
import { batchDataChanges, createDataUpdater } from "@/components/qc/data-updater";
import { setCount, setPackingMode, tidyPackingMode } from "./edit";
import { emptyPackingConfig, PackingConfigDataSchema, TEXT_MAX_LENGTH, type PackingConfigData } from "./schema";

describe("packing_config edits", () => {
  it("sets one count and leaves the others", () => {
    const next = setCount({ ...emptyPackingConfig(), glovesPerInner: 200 }, "innersPerCase", 10);
    expect(next).toEqual({ ...emptyPackingConfig(), glovesPerInner: 200, innersPerCase: 10 });
    expect(setCount(next, "innersPerCase", 10)).toBe(next);
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
});
