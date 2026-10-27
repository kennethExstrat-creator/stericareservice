import { describe, expect, it } from "vitest";
import { describingLine, photosToDescribe, type DescribablePhoto } from "./descriptions";

function photo(id: string, patch: Partial<DescribablePhoto> = {}): DescribablePhoto {
  return {
    id,
    moduleKey: "media_samples",
    target: null,
    flagged: false,
    includeInReport: false,
    takenAt: null,
    createdAt: "2026-10-27T01:00:00.000000+00:00",
    describedAt: null,
    ...patch,
  };
}

describe("photosToDescribe", () => {
  it("sends the defect photos first, then those marked In Report, then the rest, each in the order taken", () => {
    const photos = [
      photo("warehouse", { moduleKey: "media_warehouse", takenAt: "2026-10-27T08:00:00+08:00" }),
      photo("rig", { moduleKey: "watertight", target: "size:M", takenAt: "2026-10-27T08:30:00+08:00" }),
      photo("in-report", { moduleKey: "labeling", includeInReport: true, takenAt: "2026-10-27T09:00:00+08:00" }),
      photo("defect-late", { moduleKey: "media_defects", takenAt: "2026-10-27T10:00:00+08:00" }),
      photo("hole", { moduleKey: "watertight", target: "size:M/defect:hole_palm", takenAt: "2026-10-27T09:30:00+08:00" }),
      // No capture time: when it was uploaded, 09:15 in Malaysia, before the hole's 09:30.
      photo("visual", { moduleKey: "visual", target: "size:S/defect:thin_spot", takenAt: null, createdAt: "2026-10-27T01:15:00+00:00" }),
    ];
    expect(photosToDescribe(photos).map((entry) => entry.id)).toEqual(["visual", "hole", "defect-late", "in-report", "warehouse", "rig"]);
  });

  it("leaves out what the report never shows or Steri-AI has looked at: Media's Other, a flagged original, a photo described", () => {
    const photos = [
      photo("other", { moduleKey: null }),
      photo("other-in-report", { moduleKey: null, includeInReport: true }),
      photo("heic", { moduleKey: "media_defects", flagged: true }),
      photo("described", { describedAt: "2026-10-27T02:00:00+00:00" }),
      photo("sample"),
    ];
    expect(photosToDescribe(photos).map((entry) => entry.id)).toEqual(["other-in-report", "sample"]);
  });
});

describe("describingLine", () => {
  it("counts the photos left", () => {
    expect(describingLine(4)).toBe("Steri-AI is describing 4 photos…");
    expect(describingLine(1)).toBe("Steri-AI is describing 1 photo…");
  });
});
