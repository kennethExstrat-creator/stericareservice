import { describe, expect, it } from "vitest";
import type { GlossaryEntry } from "@/lib/schemas/ai-settings";
import { MESSAGES } from "./defects";
import {
  SHORTFORM_MESSAGES,
  applyShortformChange,
  buildShortformItems,
  entryOf,
  newCodeFor,
  pickerOptions,
  readOriginal,
  readShortformForm,
  shortformsByCode,
  type LibraryCode,
} from "./shortforms";

const defect = (short: string, codes: string[], meaning = `${short} meaning`, confirmed = true): GlossaryEntry => ({
  short,
  meaning,
  confirmed,
  kind: "defect",
  codes,
});
const term = (short: string, meaning = `${short} meaning`): GlossaryEntry => ({ short, meaning, confirmed: true, kind: "term", codes: [] });

const code = (value: string, name: string, active = true): LibraryCode => ({ code: value, name, active });

/** Part of the seeded library (supabase/seed.sql). */
const LIBRARY: LibraryCode[] = [
  code("hole_crotch", "Hole between fingers (crotch)"),
  code("hole_finger", "Hole in finger"),
  code("thin_body_area", "Thin area on glove body"),
  code("hole_palm", "Hole in palm"),
  code("bead_defective", "Defective bead"),
  code("bead_poor", "Poor beading"),
  code("stain", "Stain"),
  code("old_stain", "Old stain", false),
];

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const one of Array.isArray(value) ? value : [value]) data.append(name, one);
  }
  return data;
}

describe("the list", () => {
  it("sorts by shortform, numbers in order, and names each code with its state", () => {
    const items = buildShortformItems(
      [defect("TG10", []), term("TG9"), defect("bf", ["hole_crotch"]), defect("Stain", ["stain", "old_stain", "gone_code"])],
      LIBRARY,
    );
    expect(items.map((item) => item.short)).toEqual(["bf", "Stain", "TG9", "TG10"]);
    expect(items[1].codes).toEqual([
      { code: "stain", name: "Stain", state: "ok" },
      { code: "old_stain", name: "Old stain", state: "inactive" },
      { code: "gone_code", name: null, state: "unknown" },
    ]);
    // Searched by the shortform, the meaning, each code and its name.
    expect(items[0].search).toBe("bf bf meaning hole crotch hole between fingers (crotch)");
    // What the panel sends back as the version it opened.
    expect(entryOf(items[1])).toEqual(defect("Stain", ["stain", "old_stain", "gone_code"]));
  });

  it("lists each code's shortforms, IB under both bead codes", () => {
    const byCode = shortformsByCode([
      defect("IB", ["bead_defective", "bead_poor"]),
      defect("DB", ["bead_defective"]),
      term("WTT"),
    ]);
    expect(Object.fromEntries(byCode)).toEqual({ bead_defective: ["DB", "IB"], bead_poor: ["IB"] });
  });
});

describe("the code picker", () => {
  it("suggests codes from the shortform's words, then offers every other active code", () => {
    const { suggested, others } = pickerOptions(LIBRARY, [], "BF Between Finger: watertight hole between the fingers", "");
    expect(suggested.map((option) => option.code)[0]).toBe("hole_crotch");
    expect(suggested.length).toBeLessThanOrEqual(3);
    expect([...suggested, ...others].map((option) => option.code).sort()).toEqual(
      LIBRARY.filter((option) => option.active).map((option) => option.code).sort(),
    );
  });

  it("suggests by code and name only, never every code that shares a word of its description", () => {
    expect(pickerOptions(LIBRARY, [], "SKV Skin Visual: a visual defect of the glove skin", "").suggested).toEqual([]);
    expect(pickerOptions(LIBRARY, [], "IB Improper Beading: Defective Bead when major, Poor Beading when minor", "").suggested.map((option) => option.code)).toEqual([
      "bead_poor",
      "bead_defective",
    ]);
  });

  it("never offers a code already chosen, nor an inactive one, and narrows by code or name", () => {
    const { suggested, others } = pickerOptions(LIBRARY, ["hole_crotch"], "", "");
    expect(suggested).toEqual([]);
    expect(others.map((option) => option.code)).not.toContain("hole_crotch");
    expect(others.map((option) => option.code)).not.toContain("old_stain");
    expect(pickerOptions(LIBRARY, [], "", "bead").others.map((option) => option.code)).toEqual(["bead_defective", "bead_poor"]);
    expect(pickerOptions(LIBRARY, [], "", "poor BEAD").others.map((option) => option.code)).toEqual(["bead_poor"]);
    expect(pickerOptions(LIBRARY, [], "", "hole_palm").others.map((option) => option.code)).toEqual(["hole_palm"]);
  });

  it("names a new code after the meaning's first words", () => {
    const taken = new Set(LIBRARY.map((option) => option.code));
    expect(newCodeFor("SKV", "Skin Visual: a visual defect of the glove skin", taken)).toEqual({ code: "skin_visual", name: "Skin Visual" });
    expect(newCodeFor("FM", "Flow Mark", taken)).toEqual({ code: "flow_mark", name: "Flow Mark" });
    // Four words at most, without the small words that end them.
    expect(newCodeFor("TS", "Thin Spot on the glove body", taken)).toEqual({ code: "thin_spot", name: "Thin Spot" });
    expect(newCodeFor("X", "Stain", taken)).toEqual({ code: "stain_2", name: "Stain" });
    expect(newCodeFor("PH", "", taken)).toEqual({ code: "ph", name: "PH" });
    expect(newCodeFor("", " ", taken)).toBeNull();
  });
});

describe("readShortformForm", () => {
  const fields = { original: "", short: " BF ", kind: "defect", codes: ["hole_crotch"], meaning: "Between Finger", confirmed: "true" };

  it("reads a new shortform, and the version an edit opened", () => {
    expect(readShortformForm(form(fields))).toEqual({
      ok: true,
      original: null,
      next: { short: "BF", kind: "defect", codes: ["hole_crotch"], meaning: "Between Finger", confirmed: true },
    });
    const opened = defect("BF", ["hole_crotch"], "Between Finger");
    const edit = readShortformForm(form({ ...fields, original: JSON.stringify(opened), confirmed: "false" }));
    expect(edit).toMatchObject({ ok: true, original: opened, next: { confirmed: false } });
  });

  it("drops the codes of an other term", () => {
    expect(readShortformForm(form({ ...fields, short: "WTT", kind: "term" }))).toMatchObject({
      ok: true,
      next: { kind: "term", codes: [] },
    });
  });

  it("names each field that is wrong", () => {
    expect(readShortformForm(form({ ...fields, short: "", meaning: " " }))).toEqual({
      ok: false,
      result: { status: "error", message: MESSAGES.checkFields, fieldErrors: { short: "Enter the shortform.", meaning: "Enter what it means." } },
    });
    expect(readShortformForm(form({ ...fields, codes: ["a", "b", "c", "d"] }))).toMatchObject({
      result: { fieldErrors: { codes: "Choose up to 3 codes." } },
    });
    expect(readShortformForm(form({ ...fields, codes: ["Hole X"] }))).toMatchObject({
      result: { fieldErrors: { codes: "“Hole X” is not an active defect code." } },
    });
  });

  it("calls a form without a kind or with an unreadable original out of date", () => {
    const stale = { ok: false, result: { status: "error", message: MESSAGES.stale } };
    expect(readShortformForm(form({ ...fields, kind: "other" }))).toEqual(stale);
    expect(readShortformForm(form({ ...fields, original: "{not json" }))).toEqual(stale);
    expect(readShortformForm(form({ ...fields, original: JSON.stringify({ short: "BF" }) }))).toEqual(stale);
    const withoutOriginal = form(fields);
    withoutOriginal.delete("original");
    expect(readShortformForm(withoutOriginal)).toEqual(stale);
    expect(readOriginal(form({ original: "" }))).toBeNull();
  });
});

describe("applyShortformChange", () => {
  const list = [defect("BF", ["hole_crotch"]), defect("IB", ["bead_defective", "bead_poor"]), term("WTT")];

  it("adds at the end", () => {
    const outcome = applyShortformChange(list, { original: null, next: defect("SKV", []) });
    expect(outcome).toEqual({ ok: true, changed: true, entries: [...list, defect("SKV", [])] });
  });

  it("changes an entry in its place, renamed too", () => {
    const outcome = applyShortformChange(list, { original: list[1], next: defect("IBX", ["bead_poor"]) });
    expect(outcome).toEqual({ ok: true, changed: true, entries: [list[0], defect("IBX", ["bead_poor"]), list[2]] });
    // Its own shortform in other capitals is no duplicate.
    expect(applyShortformChange(list, { original: list[0], next: defect("bf", ["hole_crotch"]) })).toMatchObject({ ok: true });
  });

  it("deletes, and calls a delete of an entry already gone done", () => {
    expect(applyShortformChange(list, { original: list[2], next: null })).toEqual({ ok: true, changed: true, entries: list.slice(0, 2) });
    expect(applyShortformChange(list, { original: term("PF"), next: null })).toEqual({ ok: true, changed: false, entries: list });
  });

  it("refuses a shortform already in the list, ignoring case", () => {
    const refused = { ok: false, result: { status: "error", message: MESSAGES.checkFields, fieldErrors: { short: "“wtt” is already in the list." } } };
    expect(applyShortformChange(list, { original: null, next: term("wtt") })).toEqual(refused);
    expect(applyShortformChange(list, { original: list[0], next: term("wtt") })).toEqual(refused);
  });

  it("refuses a 201st shortform, so the saved list can always be read back; a full list still takes edits", () => {
    const full = Array.from({ length: 200 }, (_, index) => term(`T${index}`));
    expect(applyShortformChange(full, { original: null, next: term("ONE_MORE") })).toEqual({
      ok: false,
      result: { status: "error", message: "Keep the list to 200 shortforms." },
    });
    expect(applyShortformChange(full, { original: full[5], next: term("T5", "Changed") })).toMatchObject({ ok: true, changed: true });
    expect(applyShortformChange(full, { original: full[5], next: null })).toMatchObject({ ok: true, changed: true });
  });

  it("refuses when the entry changed or went since the panel opened it", () => {
    const conflict = { ok: false, result: { status: "error", message: SHORTFORM_MESSAGES.conflict } };
    const opened = { ...list[0], meaning: "As it was" };
    expect(applyShortformChange(list, { original: opened, next: defect("BF", []) })).toEqual(conflict);
    expect(applyShortformChange(list, { original: { ...list[0], codes: [] }, next: null })).toEqual(conflict);
    expect(applyShortformChange(list, { original: defect("FS", []), next: defect("FS", ["hole_finger"]) })).toEqual(conflict);
    expect(applyShortformChange(list, { original: null, next: null })).toEqual({
      ok: false,
      result: { status: "error", message: MESSAGES.stale },
    });
  });
});
