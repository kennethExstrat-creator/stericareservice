import { afterEach, describe, expect, it, vi } from "vitest";

const applyDescriptions = vi.fn();
vi.mock("./media-store", () => ({ mediaStore: () => ({ applyDescriptions }) }));

import { DESCRIBE_MESSAGES, type DescribePhotos, type DescribePhotosResult } from "@/lib/inspections/photos/descriptions";
import { PhotoDescribeRun, type DescribeRunState } from "./describe-store";

const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const ids = (count: number) => Array.from({ length: count }, (_, index) => `photo-${index + 1}`);
const RIG = { text: "Test rig", kind: "context" as const, defect: null, location: null, clarity: 0.8, check: "watertight" as const };

/** Answers each batch with a description per photo, and remembers what it was asked. */
function describer(answer?: (batch: string[], call: number) => DescribePhotosResult) {
  const calls: string[][] = [];
  const describe = vi.fn<DescribePhotos>(async (_inspection, batch) => {
    calls.push(batch);
    return answer?.(batch, calls.length) ?? { ok: true, photos: batch.map((id) => ({ id, description: RIG, describedAt: "2026-10-27T02:00:00Z" })) };
  });
  return { describe, calls };
}

/** Every state the run went through. */
function watch(run: PhotoDescribeRun): DescribeRunState[] {
  const states: DescribeRunState[] = [];
  run.subscribe(() => states.push(run.getSnapshot()));
  return states;
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("PhotoDescribeRun", () => {
  it("describes four photos a call, one call at a time, counting down, each batch into the media store", async () => {
    const run = new PhotoDescribeRun(INSPECTION);
    const states = watch(run);
    const { describe, calls } = describer();
    await run.run(describe, ids(9));
    expect(calls).toEqual([ids(4), ids(8).slice(4), ["photo-9"]]);
    expect(states).toEqual([
      { status: "describing", count: 9 },
      { status: "describing", count: 5 },
      { status: "describing", count: 1 },
      { status: "idle" },
    ]);
    expect(applyDescriptions).toHaveBeenCalledTimes(3);
    expect(describe).toHaveBeenCalledWith(INSPECTION, ids(4));
  });

  it("sends a photo once a page, and starts nothing while a run is on", async () => {
    const run = new PhotoDescribeRun(INSPECTION);
    const { describe, calls } = describer();
    const first = run.run(describe, ids(2));
    await run.run(describe, ids(3));
    await first;
    await run.run(describe, ids(3));
    expect(calls).toEqual([ids(2), ["photo-3"]]);
  });

  it("stops at a failure, says why, and sends what it did not describe again on Try Again", async () => {
    const run = new PhotoDescribeRun(INSPECTION);
    const states = watch(run);
    const { describe, calls } = describer((batch, call) =>
      call === 2 ? { ok: false, error: "Steri-AI is busy. Wait a minute and try again." } : { ok: true, photos: [] },
    );
    await run.run(describe, ids(6));
    expect(states.at(-1)).toEqual({ status: "failed", message: "Steri-AI is busy. Wait a minute and try again." });
    // A failure holds until Try Again.
    await run.run(describe, ids(6));
    expect(calls).toHaveLength(2);

    await run.retry(describe, ids(6));
    expect(calls.slice(2)).toEqual([ids(6).slice(4)]);
    expect(run.getSnapshot()).toEqual({ status: "idle" });
  });

  it("reads a request that never came back as no answer", async () => {
    const run = new PhotoDescribeRun(INSPECTION);
    await run.run(vi.fn<DescribePhotos>(async () => Promise.reject(new TypeError("Failed to fetch"))), ids(1));
    expect(run.getSnapshot()).toEqual({ status: "failed", message: DESCRIBE_MESSAGES.noAnswer });
  });

  it("stops without a word when the server cannot describe photos yet, and does not ask again", async () => {
    const run = new PhotoDescribeRun(INSPECTION);
    const { describe, calls } = describer(() => ({ ok: false, error: DESCRIBE_MESSAGES.notReady, quiet: true }));
    await run.run(describe, ids(5));
    expect(run.getSnapshot()).toEqual({ status: "idle" });
    await run.run(describe, ids(5));
    expect(calls).toEqual([ids(4)]);
  });
});
