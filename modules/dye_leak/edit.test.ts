import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { batchDataChanges, createDataUpdater } from "@/components/qc/data-updater";
import { withNoLeaks, withSizeValues } from "./edit";
import { DyeLeakDataSchema, emptyDyeLeak, type DyeLeakData } from "./schema";

// 7.5 is saved but no longer ordered: every edit keeps it (6.2 rule 4).
const SAVED: DyeLeakData = {
  sizes: {
    "6.5": { pouchesTested: 13, pouchesFailed: null, notes: null },
    "7.5": { pouchesTested: 13, pouchesFailed: 2, notes: "Channel at the seal." },
  },
};

describe("dye_leak edits", () => {
  it("sets values of one size, keeping its other values and every other size", () => {
    const next = withSizeValues(SAVED, "6.5", { pouchesFailed: 1 });
    expect(next.sizes).toEqual({
      "6.5": { pouchesTested: 13, pouchesFailed: 1, notes: null },
      "7.5": SAVED.sizes["7.5"],
    });
    expect(withSizeValues(next, "6.5", { pouchesTested: null }).sizes["6.5"]?.pouchesTested).toBeNull();
    expect(SAVED.sizes["6.5"]?.pouchesFailed).toBeNull();
  });

  it("starts a size that has nothing saved yet", () => {
    expect(withSizeValues(emptyDyeLeak(), "7.0", { notes: "Methylene blue." }).sizes).toEqual({
      "7.0": { pouchesTested: null, pouchesFailed: null, notes: "Methylene blue." },
    });
  });

  it("records no leaks in one tap, with the plan as the pouches tested while none are entered", () => {
    expect(withNoLeaks(emptyDyeLeak(), "7.0", 13).sizes["7.0"]).toEqual({ pouchesTested: 13, pouchesFailed: 0, notes: null });
    expect(withNoLeaks(SAVED, "6.5", 20).sizes["6.5"]).toEqual({ pouchesTested: 13, pouchesFailed: 0, notes: null });
    expect(withNoLeaks(emptyDyeLeak(), "7.0", null).sizes["7.0"]).toEqual({
      pouchesTested: null,
      pouchesFailed: 0,
      notes: null,
    });
  });

  it("always gives data the schema accepts", () => {
    for (const next of [withSizeValues(SAVED, "7.0", { pouchesTested: 8 }), withNoLeaks(SAVED, "6.5", 13)]) {
      expect(DyeLeakDataSchema.parse(next)).toEqual(next);
    }
  });
});

describe("dye_leak edits through the capture kit's updater (docs/CAPTURE_KIT.md)", () => {
  function screen(initial: DyeLeakData) {
    const changes: DyeLeakData[] = [];
    const updater = createDataUpdater(initial, (next) => changes.push(next));
    return { update: updater.update, changes };
  }

  it("keeps two changes made in one tick: a count tapped and a note committed as the size turns", () => {
    const { update, changes } = screen(SAVED);
    update((current) => withSizeValues(current, "6.5", { pouchesFailed: 0 }));
    update((current) => withSizeValues(current, "6.5", { notes: "No dye inside." }));
    expect(changes.at(-1)?.sizes["6.5"]).toEqual({ pouchesTested: 13, pouchesFailed: 0, notes: "No dye inside." });
    expect(changes.at(-1)?.sizes["7.5"]).toEqual(SAVED.sizes["7.5"]);
  });

  it("does not overwrite a count entered earlier in the same event with the plan", () => {
    const { update, changes } = screen(emptyDyeLeak());
    batchDataChanges(() => {
      update((current) => withSizeValues(current, "7.0", { pouchesTested: 10 }));
      update((current) => withNoLeaks(current, "7.0", 13));
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.sizes["7.0"]).toEqual({ pouchesTested: 10, pouchesFailed: 0, notes: null });
  });

  it("is how the capture screen writes: through useDataUpdater, never onChange itself", () => {
    const source = readFileSync(new URL("./Capture.tsx", import.meta.url), "utf8");
    expect(source).toContain("useDataUpdater(data, onChange)");
    expect(source).not.toMatch(/\bonChange\s*(\?\.)?\(/);
  });
});
