// The parts of landing on the last field without the DOM: the stored spot,
// which loads land, and which field on screen matches. The DOM side
// (use-landing-spot.ts) is covered by e2e/autosave.
import { describe, expect, it } from "vitest";
import {
  isReturnLoad,
  landingStorageKey,
  matchLandingField,
  nthOfSignature,
  parsePathKey,
  readLandingSpot,
  writeLandingSpot,
  type FieldSignature,
  type LandingSpot,
} from "./landing-spot";

const INSPECTION = "00000000-0000-4000-8000-0000000000aa";
const OWNER = { userId: "00000000-0000-4000-8000-0000000000bb", inspectionId: INSPECTION };

const SPOT: LandingSpot = {
  v: 1,
  section: "tensile",
  path: '["sizes","L","tensileStrength"]',
  name: "Tensile strength (MPa)",
  nth: 0,
};

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

describe("the stored spot", () => {
  it("reads back what was written, per user and inspection", () => {
    const storage = memoryStorage();
    expect(writeLandingSpot(storage, OWNER, SPOT)).toBe(true);
    expect(readLandingSpot(storage, OWNER)).toEqual(SPOT);
    expect(readLandingSpot(storage, { ...OWNER, inspectionId: "another-inspection" })).toBeNull();
    // Another account signed in on the same tab (a shared iPad) never lands on it.
    expect(readLandingSpot(storage, { ...OWNER, userId: "another-user" })).toBeNull();
    expect([...storage.items.keys()]).toEqual([landingStorageKey(OWNER)]);
    expect(landingStorageKey(OWNER)).toBe(`stericare:capture-landing:${OWNER.userId}:${INSPECTION}`);
  });

  it("reads a spot an earlier version stored with a size, without it", () => {
    const storage = memoryStorage();
    storage.items.set(landingStorageKey(OWNER), JSON.stringify({ ...SPOT, size: "L" }));
    expect(readLandingSpot(storage, OWNER)).toEqual(SPOT);
  });

  it("is null when missing, unreadable or of another version", () => {
    const storage = memoryStorage();
    expect(readLandingSpot(storage, OWNER)).toBeNull();
    storage.items.set(landingStorageKey(OWNER), "{not json");
    expect(readLandingSpot(storage, OWNER)).toBeNull();
    storage.items.set(landingStorageKey(OWNER), JSON.stringify({ ...SPOT, v: 2 }));
    expect(readLandingSpot(storage, OWNER)).toBeNull();
    storage.items.set(landingStorageKey(OWNER), JSON.stringify({ ...SPOT, section: "" }));
    expect(readLandingSpot(storage, OWNER)).toBeNull();
  });

  it("does without storage, or storage that refuses (private mode, full)", () => {
    expect(readLandingSpot(null, OWNER)).toBeNull();
    expect(writeLandingSpot(null, OWNER, SPOT)).toBe(false);
    const refusing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readLandingSpot(refusing, OWNER)).toBeNull();
    expect(writeLandingSpot(refusing, OWNER, SPOT)).toBe(false);
  });
});

describe("which loads land on the spot", () => {
  const path = `/inspections/${INSPECTION}`;
  const url = `https://qc.example.test${path}?module=tensile`;

  it("lands after a reload, Back or Forward into a dropped page, or a discarded tab, of this screen", () => {
    expect(isReturnLoad({ type: "reload", url }, path)).toBe(true);
    expect(isReturnLoad({ type: "back_forward", url }, path)).toBe(true);
    expect(isReturnLoad({ type: "navigate", url, wasDiscarded: true }, path)).toBe(true);
    expect(isReturnLoad({ type: "reload", url: `https://qc.example.test${path}/` }, path)).toBe(true);
  });

  it("does not when the inspection was opened afresh", () => {
    expect(isReturnLoad({ type: "navigate", url }, path)).toBe(false);
    expect(isReturnLoad({ type: "prerender", url }, path)).toBe(false);
  });

  it("does not when the document was loaded for another page and the screen opened inside the app", () => {
    expect(isReturnLoad({ type: "reload", url: "https://qc.example.test/inspections" }, path)).toBe(false);
    expect(isReturnLoad({ type: "reload", url: `https://qc.example.test${path}/photos` }, path)).toBe(false);
  });

  it("does not without a navigation entry", () => {
    expect(isReturnLoad({ type: null, url: null }, path)).toBe(false);
    expect(isReturnLoad({ type: "reload", url: "not a url" }, path)).toBe(false);
  });
});

describe("the field on screen", () => {
  const field = (path: string | null, name: string | null): FieldSignature => ({ path, name });
  const remark = field(null, "Remark");
  const fields = [
    field('["colour"]', "Glove colour"),
    field('["sizes","M","tensileStrength"]', "Tensile strength (MPa)"),
    field('["sizes","L","tensileStrength"]', "Tensile strength (MPa)"),
    remark,
    field('["boxes",0]', "Box 1"),
    remark,
  ];

  it("counts which of the fields with the same path and name it is", () => {
    expect(nthOfSignature(fields, 0)).toBe(0);
    expect(nthOfSignature(fields, 2)).toBe(0);
    expect(nthOfSignature(fields, 3)).toBe(0);
    expect(nthOfSignature(fields, 5)).toBe(1);
  });

  it("is the one with the same path and name", () => {
    expect(matchLandingField(fields, SPOT)).toBe(2);
    expect(matchLandingField(fields, { path: '["colour"]', name: "Glove colour", nth: 0 })).toBe(0);
  });

  it("is the nth of several alike, or the last of them when there are fewer now", () => {
    expect(matchLandingField(fields, { path: null, name: "Remark", nth: 0 })).toBe(3);
    expect(matchLandingField(fields, { path: null, name: "Remark", nth: 1 })).toBe(5);
    expect(matchLandingField(fields, { path: null, name: "Remark", nth: 4 })).toBe(5);
  });

  it("follows the path when the label changed with the value (a picker showing its choice)", () => {
    expect(matchLandingField(fields, { path: '["boxes",0]', name: "Choose a box", nth: 0 })).toBe(4);
  });

  it("is none when its path is not on screen (another size), whatever the label", () => {
    const sizeM = fields.filter((each) => !each.path?.includes('"L"'));
    expect(matchLandingField(sizeM, SPOT)).toBe(-1);
  });

  it("goes by the name alone only for a field without a path, and only when one field has it", () => {
    expect(matchLandingField([field('["x"]', "Seal"), field('["w"]', "Weather")], { path: null, name: "Weather", nth: 0 })).toBe(1);
    expect(matchLandingField([field('["a"]', "Weather"), field('["b"]', "Weather")], { path: null, name: "Weather", nth: 0 })).toBe(-1);
    expect(matchLandingField(fields, { path: null, name: null, nth: 0 })).toBe(-1);
    expect(matchLandingField([], SPOT)).toBe(-1);
  });
});

describe("the path a module reveals", () => {
  it("is the issue path the spot's key stands for", () => {
    expect(parsePathKey('["sizes","S","boxes",2,"counts","no_cuff"]')).toEqual(["sizes", "S", "boxes", 2, "counts", "no_cuff"]);
    expect(parsePathKey('["colour"]')).toEqual(["colour"]);
  });

  it("is none for no key, or one that is not a path", () => {
    expect(parsePathKey(null)).toBeNull();
    expect(parsePathKey("[]")).toBeNull();
    expect(parsePathKey("{not json")).toBeNull();
    expect(parsePathKey('{"sizes":1}')).toBeNull();
    expect(parsePathKey('["sizes",null]')).toBeNull();
  });
});
