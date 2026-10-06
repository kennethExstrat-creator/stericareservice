import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { batchDataChanges, createDataUpdater } from "@/components/qc/data-updater";
import { withLoadingValues } from "./edit";
import { emptyLoading, LoadingDataSchema, type LoadingData } from "./schema";

const SAVED: LoadingData = { containerNo: "CSQU3054383", sealNo: null, cartonsLoaded: null, cartonCondition: null };

describe("loading edits", () => {
  it("sets some values, keeping the others", () => {
    expect(withLoadingValues(SAVED, { sealNo: "SL-0001" })).toEqual({ ...SAVED, sealNo: "SL-0001" });
    expect(withLoadingValues(SAVED, { containerNo: null }).containerNo).toBeNull();
    expect(SAVED.sealNo).toBeNull();
  });

  it("always gives data the schema accepts", () => {
    const next = withLoadingValues(emptyLoading(), { cartonsLoaded: 1530, cartonCondition: "Dry." });
    expect(LoadingDataSchema.parse(next)).toEqual(next);
  });
});

describe("loading edits through the capture kit's updater (docs/CAPTURE_KIT.md)", () => {
  it("keeps two changes made in one tick: a count committed on blur as the seal no. is typed", () => {
    const changes: LoadingData[] = [];
    const { update } = createDataUpdater(SAVED, (next) => changes.push(next));
    update((current) => withLoadingValues(current, { cartonsLoaded: 2900 }));
    update((current) => withLoadingValues(current, { sealNo: "SL-0001" }));
    expect(changes.at(-1)).toEqual({ ...SAVED, cartonsLoaded: 2900, sealNo: "SL-0001" });
  });

  it("hands a batch of changes to onChange once, every change in it", () => {
    const changes: LoadingData[] = [];
    const { update } = createDataUpdater(emptyLoading(), (next) => changes.push(next));
    batchDataChanges(() => {
      update((current) => withLoadingValues(current, { containerNo: "CSQU3054383" }));
      update((current) => withLoadingValues(current, { cartonsLoaded: 1530 }));
    });
    expect(changes).toEqual([{ ...emptyLoading(), containerNo: "CSQU3054383", cartonsLoaded: 1530 }]);
  });

  it("is how the capture screen writes: through useDataUpdater, never onChange itself", () => {
    const source = readFileSync(new URL("./Capture.tsx", import.meta.url), "utf8");
    expect(source).toContain("useDataUpdater(data, onChange)");
    expect(source).not.toMatch(/\bonChange\s*(\?\.)?\(/);
  });
});
