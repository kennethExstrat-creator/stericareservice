// Section 06, Freedom from Holes & Visual Inspection, from the placeholder
// example reports (STD_EG: size M only; SAFEDON_EG: sizes XS to L) and the
// four-size inspection on STD_EG's template (sizes S to XL) as the model
// builds it, and from those exports changed the way an inspection can be: a
// size over its limit, a critical defect, a hand split, a defect not in the
// list, nothing entered yet, five sizes, the blocks switched off, lists long
// enough to fill a column. The defect photos: which (described by Steri-AI,
// rings drawn, tagged or named; never the setting), in what order (the
// clearest first, one per defect), captioned how, and where (only the room
// the tables leave, never a page of their own: INS-2026-2442's four Product
// Defects photos).
import { describe, expect, it } from "vitest";
import { buildReportModel, type ReportSectionPlanEntry } from "../model";
import { makeSafedonExport, makeStdEgExport, withReportOptions } from "../__fixtures__/exports";
import type { InspectionExport } from "@/lib/schemas/export";
import { FOUR_SIZE_ONE_OFF, fourSizeExport, fourSizeProductDefectsExport, PHOTO_SIZE, placeholderPhoto } from "./__fixtures__/holes-visual";
import { DEFECT_PHOTOS_MAX, defectPhotosOf, lineCount, type DefectRow, type DefectTable, type HolesVisualContent, type HolesVisualSlot } from "./holes-visual";

function sectionOf(doc: InspectionExport): HolesVisualContent & { pageCount: number } {
  const content = buildReportModel(doc).sections.holesVisual;
  if (!content) throw new Error("Section 06 was not built.");
  return content;
}

function entryOf(doc: InspectionExport): ReportSectionPlanEntry {
  const entry = buildReportModel(doc).plan.find((candidate) => candidate.key === "holesVisual");
  if (entry?.kind !== "section") throw new Error("Section 06 is not planned.");
  return entry;
}

/** A module's JSON, to change as a test needs. */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function moduleJson(doc: InspectionExport, key: string): { data: Json; computed: Json; config: Json; labels: Record<string, string> } {
  const found = doc.modules.find((module) => module.key === key);
  if (!found) throw new Error(`No ${key} module.`);
  return found as unknown as { data: Json; computed: Json; config: Json; labels: Record<string, string> };
}

const rowsOf = (table: DefectTable | null) => (table?.rows ?? []).map((row) => [row.kind, row.label, ...row.values.map((value) => value.text)]);
const row = (table: DefectTable | null, label: string): DefectRow | undefined => table?.rows.find((entry) => entry.label === label);
const slotsOf = (slots: readonly HolesVisualSlot[]) => slots.map((slot) => (slot.kind === "table" ? `${slot.table.key}${slot.continued ? " (continued)" : ""}` : `photos ${slot.photos.length}`));

describe("STD_EG: one size", () => {
  const doc = makeStdEgExport();
  const section = sectionOf(doc);

  it("leads with what was checked and that the size stayed inside every limit", () => {
    expect(section.lead).toBe("Watertight and visual checks on the same 500 gloves. Size M stayed inside every acceptance limit.");
  });

  it("sets each check against its limit: the watertight test and the visual classes, by the design's names, with calc's limits", () => {
    expect(section.limits?.columns.map((column) => [column.label, column.aql])).toEqual([
      ["Freedom from Holes", "AQL 1.5"],
      ["Visual: Major", "AQL 2.5"],
      ["Visual: Minor", "AQL 4.0"],
      ["Visual: Critical", "AQL 0.0"],
    ]);
    expect(section.limits?.rows).toEqual([
      {
        size: "M",
        label: "M",
        n: "n = 500",
        cells: [
          { key: "holes", found: 1, accept: 14, reject: 15, status: "pass" },
          { key: "major", found: 8, accept: 21, reject: 22, status: "pass" },
          { key: "minor", found: 0, accept: 21, reject: 22, status: "pass" },
          { key: "critical", found: 0, accept: 0, reject: 1, status: "pass" },
        ],
      },
    ]);
  });

  it("lists the pinholes by the template's locations, an empty 'Other :' as Other, the rows around them in the design's words", () => {
    expect(rowsOf(section.tables.pinholes)).toEqual([
      ["samples", "Samples Tested", "500"],
      ["defect", "Between Fingers (Crotch)", "0"],
      ["defect", "Palm", "0"],
      ["defect", "Finger", "1"],
      ["defect", "Cuff", "0"],
      ["defect", "Other", "0"],
      ["total", "Total Found", "1"],
      ["limits", "Accept / Reject", "14 / 15"],
    ]);
    expect(row(section.tables.pinholes, "Finger")?.values[0].tone).toBe("found");
    expect(row(section.tables.pinholes, "Palm")?.values[0].tone).toBe("zero");
  });

  it("lists the critical defects under AQL 0.0 · Accept 0, and the major and minor defects class by class", () => {
    expect(section.tables.critical).toMatchObject({ title: "Visual: Critical Defects", firstHeader: "AQL 0.0 · Accept 0", aside: null });
    expect(rowsOf(section.tables.critical)).toEqual([
      ["defect", "Embedded Insects", "0"],
      ["defect", "Embedded Metal Debris", "0"],
      ["total", "Total Critical", "0"],
    ]);
    const visual = section.tables.visual;
    expect(visual).toMatchObject({ title: "Visual: Major & Minor Defects", firstHeader: "Defect" });
    expect(rowsOf(visual).slice(0, 3)).toEqual([
      ["samples", "Samples Inspected", "500"],
      ["group", "Major"],
      ["defect", "Thin Area Between Fingers (Crotch)", "2"],
    ]);
    expect(visual?.rows.find((entry) => entry.kind === "group")?.detail).toBe("AQL 2.5");
    expect(rowsOf(visual).filter(([kind]) => kind !== "defect")).toEqual([
      ["samples", "Samples Inspected", "500"],
      ["group", "Major"],
      ["total", "Total Major", "8"],
      ["limits", "Accept / Reject", "21 / 22"],
      ["group", "Minor"],
      ["total", "Total Minor", "0"],
      ["limits", "Accept / Reject", "21 / 22"],
    ]);
    // Every defect the template lists, in its order and words, the class's own wording for one it shares.
    expect(rowsOf(visual).filter(([kind]) => kind === "defect").map(([, label]) => label)).toContain("Defective Beads");
    // STD_EG v7 adds Ring Mark, last of its majors (5a081a9).
    expect(rowsOf(visual).filter(([kind]) => kind === "defect").map(([, label]) => label)).toContain("Ring Mark");
    expect(rowsOf(visual).filter(([kind]) => kind === "defect")).toHaveLength(18);
  });

  it("shows the defect photos marked In Report, captioned by the inspector", () => {
    expect(section.photos.map((photo) => photo.caption)).toEqual(["Pin hole on a finger after the watertight test", "Thin spot on glove body"]);
  });

  it("fits one page as the design lays it out: the holes, the critical defects and the photos left, the visual table right", () => {
    expect(section.pageCount).toBe(1);
    expect(section.pages[0].layout).toBe("columns");
    expect(section.pages[0].columns.map(slotsOf)).toEqual([["pinholes", "critical", "photos 2"], ["visual"]]);
    expect(entryOf(doc)).toMatchObject({ built: true, pageCount: 1, kicker: "Section 06" });
  });
});

describe("SAFEDON_EG: four sizes", () => {
  const section = sectionOf(makeSafedonExport());

  it("leads with the gloves of every size together", () => {
    expect(section.lead).toBe("Watertight and visual checks on the same 560 gloves. Every size stayed inside its acceptance limit.");
    expect(section.sizes.map((size) => size.label)).toEqual(["XS", "S", "M", "L"]);
    expect(section.limits?.rows.map((entry) => [entry.label, entry.n])).toEqual([
      ["XS", "n = 80"],
      ["S", "n = 200"],
      ["M", "n = 200"],
      ["L", "n = 80"],
    ]);
  });

  it("keeps each size's own limits and counts, the template's own locations among them", () => {
    expect(section.limits?.rows.map((entry) => entry.cells.map((cell) => `${cell.found}/${cell.accept}/${cell.reject}`))).toEqual([
      ["1/3/4", "0/5/6", "0/7/8", "0/0/1"],
      ["0/7/8", "0/10/11", "0/14/15", "0/0/1"],
      ["0/7/8", "0/10/11", "0/14/15", "0/0/1"],
      ["1/3/4", "0/5/6", "0/7/8", "0/0/1"],
    ]);
    expect(rowsOf(section.tables.pinholes)).toContainEqual(["defect", "Glove Burst", "0", "0", "0", "1"]);
    expect(rowsOf(section.tables.pinholes)).toContainEqual(["limits", "Accept / Reject", "3 / 4", "7 / 8", "7 / 8", "3 / 4"]);
  });

  it("fits one page: the grid's 11 mm rows leave the right column room for the visual table whole", () => {
    expect(section.pageCount).toBe(1);
    expect(section.pages.map((page) => page.columns.map(slotsOf))).toEqual([[["pinholes", "critical"], ["visual"]]]);
    const visual = section.pages[0].columns[1][0];
    if (visual.kind !== "table") throw new Error("A table expected.");
    expect(visual.table.rows.at(-1)?.key).toBe("minor:limits");
    // The size columns are wide enough for the widest figure, "14 / 15".
    expect(visual.widths.value * 4 + visual.widths.label).toBeCloseTo(100, 1);
    expect(visual.widths.value).toBeGreaterThan(14);
  });

  it("continues on a second page on Letter, the visual table breaking between its classes: Major beside the holes, Minor after", () => {
    const letter = sectionOf(withReportOptions(makeSafedonExport(), { pageSize: "letter" }));
    expect(letter.pages.map((page) => page.columns.map(slotsOf))).toEqual([
      [["pinholes", "critical"], ["visual"]],
      [["visual (continued)"], []],
    ]);
    const [first, second] = [letter.pages[0].columns[1][0], letter.pages[1].columns[0][0]];
    if (first.kind !== "table" || second.kind !== "table") throw new Error("Tables expected.");
    expect(first.table.rows.at(-1)?.key).toBe("major:limits");
    expect(second.table.rows[0]).toMatchObject({ kind: "group", label: "Minor", detail: "AQL 4.0" });
    expect(second.table.rows[0].continued).toBeUndefined();
    // On a page of its own, a class keeps the table's heading.
    expect(second.heading).toBe(true);
  });
});

describe("four sizes on STD_EG's template: S to XL, 200, 315, 200 and 125 gloves", () => {
  const defects = (section: HolesVisualContent, cls: string) => (section.tables.visual?.rows ?? []).filter((entry) => entry.kind === "defect" && entry.key.startsWith(`${cls}:`));
  /** The first page's columns, a table's piece by its first and last rows. */
  const firstPage = (section: HolesVisualContent) =>
    section.pages[0].columns.map((column) => column.map((slot) => (slot.kind === "table" ? `${slot.table.key}: ${slot.table.rows[0].key} to ${slot.table.rows.at(-1)?.key}` : "photos")));

  it("lists version 6's eleven major defects and its ring mark not in the list, six minor and two critical", () => {
    const section = sectionOf(fourSizeExport());
    expect(section.limits?.rows.map((entry) => [entry.label, entry.n])).toEqual([
      ["S", "n = 200"],
      ["M", "n = 315"],
      ["L", "n = 200"],
      ["XL", "n = 125"],
    ]);
    expect(defects(section, "major")).toHaveLength(12);
    expect(defects(section, "major").at(-1)).toMatchObject({ label: FOUR_SIZE_ONE_OFF, note: "Defect Not in the List" });
    expect(defects(section, "minor")).toHaveLength(6);
    expect(rowsOf(section.tables.critical).filter(([kind]) => kind === "defect")).toHaveLength(2);
  });

  it("prints one page, the Minor class under the critical defects without the table's heading (Kenneth, 27 October 2026)", () => {
    const section = sectionOf(fourSizeExport());
    expect(section.pageCount).toBe(1);
    expect(firstPage(section)).toEqual([
      ["pinholes: pinholes:tested to pinholes:limits", "critical: critical:embedded_insect to critical:total", "visual: minor:group to minor:limits"],
      ["visual: visual:inspected to major:limits"],
    ]);
    const [major, minor] = [section.pages[0].columns[1][0], section.pages[0].columns[0][2]];
    if (major.kind !== "table" || minor.kind !== "table") throw new Error("Tables expected.");
    expect([major.heading, minor.heading]).toEqual([true, false]);
    expect(minor.table.rows[0]).toMatchObject({ kind: "group", label: "Minor", detail: "AQL 4.0" });
  });

  it("prints one page on version 7 too, Ring Mark a major of the template's", () => {
    const section = sectionOf(fourSizeExport({ version: 7 }));
    expect(defects(section, "major").at(-1)).toMatchObject({ key: "major:ring_mark", label: "Ring Mark" });
    expect(defects(section, "major").some((entry) => entry.note)).toBe(false);
    expect(section.pageCount).toBe(1);
    expect(firstPage(section)[0].at(-1)).toBe("visual: minor:group to minor:limits");
  });
});

/* ------------------------------------------------------------------ *
 * Inspections the examples do not show
 * ------------------------------------------------------------------ */

/** SAFEDON_EG with size M over its holes limit (a hand split, two of the holes under "Other :"), a critical defect in S and L over its major limit. */
function failing(): InspectionExport {
  const doc = makeSafedonExport();
  const holes = moduleJson(doc, "watertight");
  holes.config.handSplit = true;
  holes.computed.sizes.M = {
    ...holes.computed.sizes.M,
    holes: { ...holes.computed.sizes.M.holes, hole_palm: 6, hole_other: 2 },
    hands: { R: { holes: { hole_palm: 4, hole_other: 2 }, total: 6 }, L: { holes: { hole_palm: 2 }, total: 2 } },
    totalDefects: 8,
    decision: "reject",
    result: "fail",
  };
  holes.data.sizes.M = {
    ...holes.data.sizes.M,
    R: { holes: { hole_palm: 4, hole_other: 2 }, otherDescription: "Glove burst", unmapped: [] },
    L: { holes: { hole_palm: 2 }, otherDescription: null, unmapped: [] },
  };
  const visual = moduleJson(doc, "visual");
  visual.computed.sizes.S.critical = { ...visual.computed.sizes.S.critical, counts: { embedded_insect: 1, embedded_metal: 0 }, total: 1, decision: "reject", result: "fail" };
  visual.computed.sizes.L.major = {
    ...visual.computed.sizes.L.major,
    counts: { ...visual.computed.sizes.L.major.counts, thin_spot: 4, bead_cracked: 1 },
    unmapped: [{ label: "Torn cuff edge", count: 1, hand: null }],
    total: 6,
    decision: "reject",
    result: "fail",
  };
  return doc;
}

describe("a size over its limit", () => {
  const section = sectionOf(failing());

  it("names the sizes that failed and the checks they failed, and says the hands are counted together", () => {
    expect(section.lead).toBe(
      "Watertight and visual checks on the same 560 gloves, right and left hands counted together. Size S failed Visual: Critical; size M failed Freedom from Holes; size L failed Visual: Major.",
    );
  });

  it("marks the failing cells, totals and any critical defect red", () => {
    const cells = section.limits?.rows.map((entry) => entry.cells.map((cell) => cell.status));
    expect(cells?.[1]).toEqual(["pass", "pass", "pass", "fail"]);
    expect(cells?.[2]).toEqual(["fail", "pass", "pass", "pass"]);
    expect(row(section.tables.pinholes, "Total Found")?.values.map((value) => value.tone)).toEqual(["total", "total", "fail", "total"]);
    expect(row(section.tables.critical, "Embedded Insects")?.values.map((value) => value.tone)).toEqual(["zero", "fail", "zero", "zero"]);
    expect(row(section.tables.visual, "Total Major")?.values.map((value) => value.tone)).toEqual(["total", "total", "total", "fail"]);
  });

  it("adds both hands up, says where the 'Other :' holes were, and notes the hand split by each table", () => {
    expect(rowsOf(section.tables.pinholes)).toContainEqual(["defect", "Palm", "0", "0", "6", "0"]);
    expect(rowsOf(section.tables.pinholes)).toContainEqual(["defect", "Other : Glove burst", "0", "0", "2", "0"]);
    expect(section.tables.pinholes?.aside).toBe("Right and left hands together");
    expect(section.tables.critical?.aside).toBeNull();
  });

  it("lists a code the template does not list, and a defect not in the list in the inspector's words, labelled", () => {
    const visual = section.tables.visual;
    expect(row(visual, "Bead Cracked")?.values.map((value) => value.text)).toEqual(["0", "0", "0", "1"]);
    expect(row(visual, "Torn cuff edge")).toMatchObject({ kind: "defect", note: "Defect Not in the List" });
    expect(row(visual, "Torn cuff edge")?.values.map((value) => value.text)).toEqual(["0", "0", "0", "1"]);
    // Both after the template's own defects, before the class's total.
    const labels = (visual?.rows ?? []).map((entry) => entry.label);
    expect(labels.indexOf("Torn cuff edge")).toBe(labels.indexOf("Total Major") - 1);
  });
});

describe("an inspection not entered yet", () => {
  function blank(): InspectionExport {
    const doc = makeSafedonExport();
    const holes = moduleJson(doc, "watertight");
    for (const size of Object.keys(holes.computed.sizes)) holes.computed.sizes[size] = { ...holes.computed.sizes[size], tested: null, accept: null, reject: null, totalDefects: 0, result: "not_done" };
    const visual = moduleJson(doc, "visual");
    for (const size of Object.keys(visual.computed.sizes)) {
      for (const cls of ["critical", "major", "minor"]) {
        const critical = cls === "critical";
        visual.computed.sizes[size][cls] = { ...visual.computed.sizes[size][cls], inspected: null, accept: critical ? 0 : null, reject: critical ? 1 : null, total: 0, result: "not_done" };
      }
    }
    return doc;
  }

  it("says nothing is recorded, prints dashes for the figures, and leaves every check not done", () => {
    const section = sectionOf(blank());
    expect(section.lead).toBe("No results are recorded yet.");
    expect(row(section.tables.pinholes, "Palm")?.values.map((value) => value.text)).toEqual(["—", "—", "—", "—"]);
    expect(row(section.tables.visual, "Accept / Reject")?.values.every((value) => value.tone === "missing")).toBe(true);
    expect(section.limits?.rows[0]).toMatchObject({ n: "n = —" });
    expect(section.limits?.rows.flatMap((entry) => entry.cells.map((cell) => cell.status)).every((status) => status === "not_done")).toBe(true);
  });

  it("says which sizes are still to do once the others are done", () => {
    const doc = makeSafedonExport();
    const holes = moduleJson(doc, "watertight");
    holes.computed.sizes.L = { ...holes.computed.sizes.L, tested: null, accept: null, reject: null, totalDefects: 0, result: "not_done" };
    expect(sectionOf(doc).lead).toBe(
      "Watertight test on 480 gloves and visual inspection on 560 gloves. No size has gone over an acceptance limit so far. Size L is not done yet.",
    );
  });
});

describe("the options and the template", () => {
  it("leave out each block switched off", () => {
    const doc = makeStdEgExport();
    const off = (blocks: Record<string, boolean>) => sectionOf(withReportOptions(doc, { sections: { ...doc.report.sections, holesVisual: { include: true, blocks } } }));
    const some = off({ defectsAgainstLimit: false, pinholesByLocation: true, visualCritical: false, defectPhotos: false, visualMajorMinor: true });
    expect(some.limits).toBeNull();
    expect(some.tables.critical).toBeNull();
    expect(some.photos).toEqual([]);
    expect(some.pages[0].columns.map(slotsOf)).toEqual([["pinholes"], ["visual"]]);
    // The lead still says how the checks went.
    expect(some.lead).toContain("Size M stayed inside every acceptance limit.");
    const gridOnly = off({ defectsAgainstLimit: true, pinholesByLocation: false, visualCritical: false, defectPhotos: false, visualMajorMinor: false });
    expect(gridOnly.pages).toEqual([{ layout: "columns", columns: [[], []] }]);
  });

  it("follow a class the template switches off, and its own words for the classes", () => {
    const doc = makeStdEgExport();
    const visual = moduleJson(doc, "visual");
    visual.computed.classes.minor.include = false;
    visual.labels.majorCounts = "Major Defect";
    const section = sectionOf(doc);
    expect(section.limits?.columns.map((column) => column.label)).toEqual(["Freedom from Holes", "Visual: Major", "Visual: Critical"]);
    expect(section.tables.visual?.title).toBe("Visual: Major Defect");
    expect(section.tables.visual?.rows.filter((entry) => entry.kind === "group").map((entry) => entry.label)).toEqual(["Major"]);
  });

  it("show only the watertight test when the inspection has no visual inspection, its parts shared between the columns", () => {
    const doc = makeStdEgExport();
    doc.modules = doc.modules.filter((module) => module.key !== "visual");
    doc.photos = doc.photos.filter((photo) => photo.moduleKey !== "visual");
    const section = sectionOf(doc);
    expect(section.lead).toBe("Watertight test on 500 gloves. Size M stayed inside every acceptance limit.");
    expect(section.limits?.columns.map((column) => column.label)).toEqual(["Freedom from Holes"]);
    expect(section.tables.critical).toBeNull();
    expect(section.pages[0].columns.map(slotsOf)).toEqual([["pinholes"], ["photos 1"]]);
    // Photos that open a column are headed.
    expect(section.pages[0].columns[1][0]).toMatchObject({ kind: "photos", title: "Defect Photos" });
  });

  it("stack the parts across the page for more than four sizes", () => {
    const doc = makeSafedonExport();
    moduleJson(doc, "order_lots").data.sizes.XL = { qtyCases: 120, lotNumbers: [], packingSite: null };
    for (const key of ["watertight", "visual"]) {
      const json = moduleJson(doc, key);
      json.computed.sizes.XL = structuredClone(json.computed.sizes.L);
    }
    const section = sectionOf(doc);
    expect(section.sizes.map((size) => size.label)).toEqual(["XS", "S", "M", "L", "XL"]);
    expect(section.pages.map((page) => page.layout)).toEqual(["stack", "stack"]);
    expect(section.pages.map((page) => page.columns.map(slotsOf))).toEqual([[["pinholes", "critical"]], [["visual"]]]);
  });

  it("plan with the paper and the footer note: a shorter page holds less", () => {
    // Three defects not in the list make STD_EG's visual table about 162 mm: an A4 page holds it whole, Letter with a footer
    // note does not, so its Minor class moves under the critical defects, and the photos, with no room left, print in the
    // photo records alone: never a page of their own.
    const doc = makeStdEgExport();
    const visual = moduleJson(doc, "visual");
    visual.computed.sizes.M.major.unmapped = ["Torn cuff edge", "Black speck", "Sticky fingertip"].map((label) => ({ label, count: 1, hand: null }));
    expect(sectionOf(doc).pageCount).toBe(1);
    expect(sectionOf(doc).photos).toHaveLength(2);
    const letter = sectionOf(withReportOptions(doc, { pageSize: "letter", footerNote: "F".repeat(250) }));
    expect(letter.pages.map((page) => page.columns.map(slotsOf))).toEqual([[["pinholes", "critical", "visual (continued)"], ["visual"]]]);
    expect(letter.photos).toEqual([]);
  });
});

describe("the first page's columns, filled before the section goes on", () => {
  /** Defects not in the list, one each, as calc keeps them. */
  const oneOffs = (...labels: string[]) => labels.map((label) => ({ label, count: 1, hand: null }));
  const fiveMajor = oneOffs("Torn cuff edge", "Black speck", "Sticky fingertip", "Uneven rim", "Faint streak");

  it("move a class the right column cannot hold, whole, under the critical defects where it fits: the section on one page", () => {
    // The four sizes with Pinholes by Location switched off: the critical defects alone in the left column.
    const doc = fourSizeExport();
    const blocks = { ...doc.report.sections.holesVisual.blocks, pinholesByLocation: false };
    const section = sectionOf(withReportOptions(doc, { sections: { ...doc.report.sections, holesVisual: { include: true, blocks } } }));
    expect(section.pageCount).toBe(1);
    expect(section.pages[0].columns.map(slotsOf)).toEqual([["critical", "visual (continued)"], ["visual"]]);
    const [major, minor] = [section.pages[0].columns[1][0], section.pages[0].columns[0][1]];
    if (major.kind !== "table" || minor.kind !== "table") throw new Error("Tables expected.");
    expect(major.table.rows.at(-1)?.key).toBe("major:limits");
    // The whole class from its own heading, as the visual table has it.
    const rows = section.tables.visual?.rows ?? [];
    expect(minor.table.rows.map((entry) => entry.key)).toEqual(rows.slice(rows.findIndex((entry) => entry.key === "minor:group")).map((entry) => entry.key));
    expect(minor.table.rows[0].continued).toBeUndefined();
  });

  it("place the tables before the photos: a long major list on one size, the Minor class under the critical defects, no page for the photos", () => {
    const doc = makeStdEgExport();
    moduleJson(doc, "visual").computed.sizes.M.major.unmapped = fiveMajor;
    // The tables fill both columns: the photos (offered still) find no room, and print in the photo records alone.
    expect(sectionOf(doc).pages.map((page) => page.columns.map(slotsOf))).toEqual([[["pinholes", "critical", "visual (continued)"], ["visual"]]]);
    expect(defectPhotosOf(doc)).toHaveLength(2);
    expect(sectionOf(doc).photos).toEqual([]);
    doc.photos = [];
    expect(sectionOf(doc).pages.map((page) => page.columns.map(slotsOf))).toEqual([[["pinholes", "critical", "visual (continued)"], ["visual"]]]);
  });

  it("never move a class ahead of a table that goes on: critical defects too long for the left column, the Minor class after them", () => {
    const doc = makeStdEgExport();
    doc.photos = [];
    const visual = moduleJson(doc, "visual");
    visual.computed.sizes.M.major.unmapped = fiveMajor;
    visual.computed.sizes.M.critical.unmapped = oneOffs(...Array.from({ length: 14 }, (_, index) => `Foreign body ${index + 1}`));
    expect(sectionOf(doc).pages.map((page) => page.columns.map(slotsOf))).toEqual([
      [["pinholes"], ["visual"]],
      [["critical"], ["visual (continued)"]],
    ]);
  });

  it("put the photos under the visual table once it has ended, when the left column cannot hold them", () => {
    const doc = makeStdEgExport();
    moduleJson(doc, "watertight").computed.sizes.M.unmapped = oneOffs("Thumb tip", "Wrist band", "Knuckle", "Fingertip seam", "Back of hand", "Palm crease");
    moduleJson(doc, "visual").computed.classes.minor.include = false;
    const section = sectionOf(doc);
    expect(section.pages.map((page) => page.columns.map(slotsOf))).toEqual([[["pinholes", "critical"], ["visual", "photos 2"]]]);
    // Under a table, untitled.
    expect(section.pages[0].columns[1][1]).toMatchObject({ kind: "photos", title: null });
  });
});

describe("the defect photos", () => {
  const photo = (id: number, moduleKey: string, target: string | null, extra: Partial<InspectionExport["photos"][number]> = {}): InspectionExport["photos"][number] => ({
    id: `00000000-0000-4000-8000-0000000009${String(id).padStart(2, "0")}`,
    url: `https://storage.example.com/defect-${id}.jpg`,
    moduleKey,
    target,
    caption: null,
    takenAt: `2025-02-19T0${id % 10}:00:00.000Z`,
    includeInReport: false,
    flagged: false,
    description: null,
    markers: [],
    size: { ...PHOTO_SIZE },
    ...extra,
  });

  it("take holes, visual defects and Product Defects in turn, captioned by their tags in the template's words, at most four", () => {
    const doc = makeSafedonExport();
    doc.photos = [
      photo(1, "watertight", "size:M/hand:R/defect:hole_palm"),
      photo(2, "watertight", "size:S"),
      photo(3, "visual", "size:L/defect:thin_spot"),
      photo(4, "media_defects", null, { caption: "Ringed mark, thin area" }),
      photo(5, "visual", "size:S/defect:embedded_insect"),
      photo(6, "watertight", "defect:glove_burst"),
      photo(7, "visual", "defect:Torn cuff edge"),
      photo(8, "weight", "size:M"),
    ];
    const offered = defectPhotosOf(doc);
    expect(offered.map((entry) => [entry.caption, entry.strong])).toEqual([
      // Plain on Section 06's page, as TG35 page 6 sets them.
      ["Holes: Palm · Size M · Right Hand", false],
      ["Thin Spot · Size L", false],
      ["Ringed mark, thin area", false],
      ["Holes: Glove Burst", false],
    ]);
    expect(offered).toHaveLength(DEFECT_PHOTOS_MAX);
    // A watertight photo with no defect tagged, and a weight photo, are no defect photos.
    expect(offered.map((entry) => entry.url)).not.toContain("https://storage.example.com/defect-2.jpg");
    // The page prints the first that fit under the critical defects: a row of two beside SAFEDON_EG's visual table.
    const section = sectionOf(doc);
    expect(section.photos).toEqual(offered.slice(0, 2));
    expect(section.pages.map((page) => page.columns.map(slotsOf))).toEqual([[["pinholes", "critical", "photos 2"], ["visual"]]]);
  });

  it("keep to the photos marked In Report once there are some, never a flagged original, nor a Product Defects photo that says nothing", () => {
    const doc = makeSafedonExport();
    doc.photos = [
      photo(1, "visual", "defect:thin_spot", { includeInReport: true }),
      photo(2, "visual", "defect:stain"),
      photo(3, "media_defects", null, { includeInReport: true }),
      photo(4, "watertight", "defect:hole_finger", { includeInReport: true, flagged: true }),
    ];
    // The Product Defects photo names no defect: no caption saying "Product Defects" in Section 06, only the photo records.
    expect(defectPhotosOf(doc).map((entry) => entry.caption)).toEqual(["Thin Spot"]);
  });

  it("name a Product Defects photo's tagged defect by the template's list", () => {
    const doc = makeSafedonExport();
    doc.photos = [photo(1, "media_defects", "size:XS/defect:bead_blister")];
    expect(sectionOf(doc).photos.map((entry) => entry.caption)).toEqual(["Bead Blister · Size XS"]);
  });

  it("are left out when there are none", () => {
    const section = sectionOf(makeSafedonExport());
    expect(section.photos).toEqual([]);
    expect(section.pages.flatMap((page) => page.columns.flat()).some((slot) => slot.kind === "photos")).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Which defect photos, in what order, captioned how (Kenneth, 27 October
 * 2026: "loop in AI to identify properly rather than squeezing in all
 * photos without analyzing")
 * ------------------------------------------------------------------ */

describe("the defect photos Steri-AI describes, rings drawn, and the inspector's words", () => {
  type Photo = InspectionExport["photos"][number];
  let next = 0;
  const photo = (moduleKey: string, target: string | null, extra: Partial<Photo> = {}): Photo => {
    next += 1;
    return {
      id: `00000000-0000-4000-8000-${String(950000 + next).padStart(12, "0")}`,
      url: `https://storage.example.com/described-${next}.jpg`,
      moduleKey,
      target,
      caption: null,
      takenAt: `2025-04-11T04:${String(next % 60).padStart(2, "0")}:00.000Z`,
      includeInReport: false,
      flagged: false,
      description: null,
      markers: [],
      size: { ...PHOTO_SIZE },
      ...extra,
    };
  };
  const defect = (text: string, code: string | null, location: string | null, clarity: number): Photo["description"] => ({ text, kind: "defect", defect: code, location, clarity, check: null });
  const setting = (text: string): Photo["description"] => ({ text, kind: "context", defect: null, location: null, clarity: 0.95, check: null });
  const ring = { x: 0.5, y: 0.5, r: 0.05 };
  const captions = (doc: InspectionExport) => defectPhotosOf(doc).map((entry) => entry.caption);
  const withPhotos = (doc: InspectionExport, ...list: Photo[]) => Object.assign(doc, { photos: list });

  it("offer those Steri-AI describes first, the clearest first, one per defect, never the setting", () => {
    const tagged = photo("watertight", "size:M/defect:hole_palm");
    const doc = withPhotos(
      makeStdEgExport(),
      tagged,
      photo("media_defects", null, { description: defect("Pinhole, palm area", "hole_palm", "hole_palm", 0.62) }),
      photo("media_defects", null, { description: defect("Pinhole at palm", "hole_palm", "hole_palm", 0.91) }),
      photo("media_defects", null, { description: setting("Test rig") }),
      photo("visual", "size:M/defect:thin_spot", { description: defect("Thin spot", "thin_spot", null, 0.8) }),
    );
    // The clearer of the two palm pinholes; the tagged palm pinhole is the same defect; the rig is the setting.
    expect(captions(doc)).toEqual(["Pinhole at palm", "Thin spot"]);
    expect(defectPhotosOf(doc).map((entry) => entry.id)).not.toContain(tagged.id);
  });

  it("let Steri-AI's setting overrule a defect tagged as the photo was taken, but never a ring the inspector drew", () => {
    const doc = withPhotos(
      makeStdEgExport(),
      photo("watertight", "size:M/defect:hole_finger", { description: setting("Test rig") }),
      photo("visual", "size:M/defect:thin_spot", { description: setting("Inspection bench"), markers: [ring] }),
    );
    expect(captions(doc)).toEqual(["Inspection bench"]);
  });

  it("offer undescribed photos that still name a defect after the described: rings drawn first, each in its own place, then the rest in turn", () => {
    const tagged = photo("visual", "size:M/defect:thin_spot");
    const firstRing = photo("media_defects", null, { markers: [ring] });
    const secondRing = photo("media_defects", null, { markers: [ring, { x: 0.2, y: 0.3, r: 0.04 }] });
    const described = photo("media_defects", null, { description: defect("Ringed mark, thin area", "thin_crotch_ring", null, 0.55) });
    const silent = photo("media_defects", null);
    const doc = withPhotos(makeStdEgExport(), tagged, firstRing, secondRing, described, silent);
    expect(defectPhotosOf(doc).map((entry) => entry.id)).toEqual([described.id, firstRing.id, secondRing.id, tagged.id]);
    // A ringed photo with nothing to say has no caption; the tagged one is named by the template's list, plain on this page.
    expect(defectPhotosOf(doc).map((entry) => [entry.caption, entry.strong])).toEqual([
      ["Ringed mark, thin area", false],
      [null, false],
      [null, false],
      ["Thin Spot on Glove Body · Size M", false],
    ]);
    // The rings travel with the photo, its natural pixels to place them.
    expect(defectPhotosOf(doc)[2]).toMatchObject({ markers: secondRing.markers, size: PHOTO_SIZE });
  });

  it("caption a photo by the inspector's own words first, then Steri-AI's, then its tags or its size; never by Media's category", () => {
    const doc = withPhotos(
      makeSafedonExport(),
      photo("media_defects", null, { caption: "Hole near the thumb", description: defect("Pinhole, side finger", "hole_finger", "hole_finger", 0.9) }),
      photo("media_defects", null, { description: defect("Pinhole, between fingers", "hole_crotch", "hole_crotch", 0.8) }),
      photo("watertight", "size:S/hand:L/defect:hole_cuff"),
      photo("media_defects", "size:XS", { markers: [ring] }),
    );
    expect(defectPhotosOf(doc).map((entry) => [entry.caption, entry.strong])).toEqual([
      ["Hole near the thumb", false],
      ["Pinhole, between fingers", false],
      ["Size XS", false],
      ["Holes: Cuff · Size S · Left Hand", false],
    ]);
    expect(JSON.stringify(sectionOf(doc))).not.toContain("Product Defects");
  });

  it("take a Media photo of another category only where Steri-AI places its defect in either check", () => {
    const doc = withPhotos(
      makeStdEgExport(),
      photo("media_samples", null, { description: defect("Thin spot", "thin_spot", null, 0.7) }),
      photo("media_samples", null, { description: defect("Torn carton corner", null, null, 0.9) }),
      photo("media_warehouse", null, { markers: [ring] }),
    );
    expect(captions(doc)).toEqual(["Thin spot"]);
  });
});

/* ------------------------------------------------------------------ *
 * Where the photos go: only where the tables leave room
 * ------------------------------------------------------------------ */

describe("the defect photos' place on the section's own pages", () => {
  /** No page the section prints holds photos alone while it has tables to print. */
  const noPhotoPage = (section: HolesVisualContent) => section.pages.every((page) => page.columns.flat().some((slot) => slot.kind === "table"));

  it("never make a page of their own: INS-2026-2442's four Product Defects photos, undescribed, print in the photo records alone", () => {
    const doc = fourSizeProductDefectsExport();
    const section = sectionOf(doc);
    expect(section.pageCount).toBe(1);
    expect(defectPhotosOf(doc)).toEqual([]);
    expect(section.photos).toEqual([]);
    expect(noPhotoPage(section)).toBe(true);
  });

  it("offer INS-2026-2442's photos once described: the two pinholes and the ringed mark, the clearest first, the test rig never; no room, so the records", () => {
    const doc = fourSizeProductDefectsExport({ described: true });
    expect(defectPhotosOf(doc).map((entry) => entry.caption)).toEqual(["Pinhole, between fingers", "Pinhole, palm area", "Ringed mark, thin area"]);
    // The four sizes fill both columns: a row of two would need 43 mm under the major defects, which have 41 mm left.
    const section = sectionOf(doc);
    expect(section.pageCount).toBe(1);
    expect(section.photos).toEqual([]);
  });

  it("keep the four sizes on one page with four defect photos added: they wait in the photo records", () => {
    const doc = fourSizeExport();
    doc.photos = [
      placeholderPhoto(11, { moduleKey: "watertight", target: "size:M/defect:hole_palm" }),
      placeholderPhoto(12, { moduleKey: "watertight", target: "size:S/defect:hole_finger" }),
      placeholderPhoto(13, { moduleKey: "visual", target: "size:M/defect:thin_spot" }),
      placeholderPhoto(14, { moduleKey: "visual", target: "size:XL/defect:stain" }),
    ];
    const section = sectionOf(doc);
    expect(defectPhotosOf(doc)).toHaveLength(4);
    expect(section.pageCount).toBe(1);
    expect(section.photos).toEqual([]);
    expect(section.pages[0].columns.map(slotsOf)).toEqual([["pinholes", "critical", "visual (continued)"], ["visual"]]);
  });

  it("sit under the tables on a continued page that exists anyway, in the column the tables leave empty, headed", () => {
    const doc = withReportOptions(makeSafedonExport(), { pageSize: "letter" });
    doc.photos = makeStdEgExport().photos;
    const section = sectionOf(doc);
    expect(section.pages.map((page) => page.columns.map(slotsOf))).toEqual([
      [["pinholes", "critical"], ["visual"]],
      [["visual (continued)"], ["photos 2"]],
    ]);
    expect(section.pages[1].columns[1][0]).toMatchObject({ kind: "photos", title: "Defect Photos" });
  });

  it("sit four across under the tables on a stacked page, the last table's", () => {
    const doc = makeSafedonExport();
    doc.photos = makeStdEgExport().photos;
    moduleJson(doc, "order_lots").data.sizes.XL = { qtyCases: 120, lotNumbers: [], packingSite: null };
    for (const key of ["watertight", "visual"]) {
      const json = moduleJson(doc, key);
      json.computed.sizes.XL = structuredClone(json.computed.sizes.L);
    }
    const section = sectionOf(doc);
    expect(section.pages.map((page) => page.columns.map(slotsOf))).toEqual([[["pinholes", "critical"]], [["visual", "photos 2"]]]);
    expect(section.pages[1].columns[0][1]).toMatchObject({ kind: "photos", columns: 4, title: null });
  });

  it("never come before a table that goes on: a column whose table continues on the next page takes none", () => {
    // Long critical defects move to page 2 whole: page 1's left column, room under the holes and all, takes no photo; on
    // page 2 both columns have room for the row, and the one with more left takes it.
    const doc = makeStdEgExport();
    const visual = moduleJson(doc, "visual");
    visual.computed.sizes.M.major.unmapped = ["Torn cuff edge", "Black speck", "Sticky fingertip", "Uneven rim", "Faint streak"].map((label) => ({ label, count: 1, hand: null }));
    visual.computed.sizes.M.critical.unmapped = Array.from({ length: 14 }, (_, index) => ({ label: `Foreign body ${index + 1}`, count: 1, hand: null }));
    const section = sectionOf(doc);
    expect(section.pages.map((page) => page.columns.map(slotsOf))).toEqual([
      [["pinholes"], ["visual"]],
      [["critical"], ["visual (continued)", "photos 2"]],
    ]);
    expect(noPhotoPage(section)).toBe(true);
  });
});

describe("lineCount: the room a label takes", () => {
  it("wraps by Outfit's widths, word by word, a word longer than the line within it", () => {
    expect(lineCount("Thin Area on Glove Body", 40, 9)).toBe(1);
    expect(lineCount("Thin Area Between Fingers (Crotch)", 36.8, 9)).toBe(2);
    expect(lineCount('Total Number of "Critical Defects" Found', 36.8, 9, "bold")).toBe(2);
    expect(lineCount("Pneumonoultramicroscopicsilicovolcanoconiosis", 20, 9)).toBe(4);
    expect(lineCount("", 30, 9)).toBe(1);
  });
});
