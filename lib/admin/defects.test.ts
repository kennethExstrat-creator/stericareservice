import { describe, expect, it } from "vitest";
import { moduleConfig, templateModuleKeys } from "@/lib/coverage/templates";
import type { TemplateCode } from "@/lib/coverage/types";
import {
  ActiveTargetSchema,
  DefectCodeSchema,
  EditTargetSchema,
  LabelTargetSchema,
  MESSAGES,
  MapChoiceSchema,
  MapTargetSchema,
  NewDefectCodeSchema,
  addCodeHref,
  addPrefill,
  buildCodeItems,
  buildInspectionLabels,
  buildLabelMaps,
  canMap,
  countLabel,
  countUnmapped,
  currentVersions,
  defectsCounts,
  deleteBlocker,
  describeCodeInsertError,
  describeMappingProblem,
  fieldErrors,
  filterLabelMaps,
  findOneOffLabels,
  inspectionHref,
  labelCount,
  listOf,
  mapOneOffLabel,
  matchesSearch,
  mentionsCode,
  normaliseCode,
  readCount,
  searchText,
  sizeLabel,
  suggestCodes,
  suggestNewCode,
  templateEditorHref,
  templateLabels,
  templatesMentioning,
  whereLabel,
  type DefectCodeRow,
  type InspectionLabels,
  type InspectionQueryRow,
  type LabelTarget,
  type TemplateRecord,
} from "./defects";

/* ------------------------------------------------------------------ *
 * Fixtures: the seed templates as resolved, and inspection data in the
 * canonical shape of docs/DATA_DICTIONARY.md
 * ------------------------------------------------------------------ */

/** A seed template as `templates.resolved` holds it: every module with its whole config (a copy: tests change it). */
function resolvedOf(code: TemplateCode) {
  return {
    format: 2,
    code,
    name: `${code} template`,
    chain: [code],
    bases: [],
    modules: templateModuleKeys(code).map((key) => ({
      key,
      include: true,
      title: key,
      labels: {},
      config: structuredClone(moduleConfig(code, key) ?? {}),
    })),
    customModules: [],
    report: { title: "Report", showClientLogo: false },
    sourceFile: null,
  };
}

function record(
  code: string,
  version: number,
  status: TemplateRecord["status"],
  resolved: unknown,
  id = `${code}-${version}`,
): TemplateRecord {
  return {
    id,
    code,
    version,
    status,
    name: `${code} template`,
    labels: resolved === null ? null : templateLabels(resolved),
    definition: { code, name: `${code} template` },
    resolved,
  };
}

const code = (value: string, active = true, name = value.replace(/_/g, " ")): DefectCodeRow => ({
  code: value,
  name,
  description: null,
  active,
  updated_at: "2026-10-06T01:02:03.123456+00:00",
});

const visualData = () => ({
  modules: {
    visual: {
      comment: "Looked fine overall.",
      sizes: {
        M: {
          critical: { inspected: 80, counts: {}, unmapped: [] },
          major: { inspected: 80, counts: { stain: 1 }, unmapped: [{ label: "Torn cuff", count: 2 }] },
          minor: { inspected: 80, counts: {}, unmapped: [{ label: "  Sticky   edge ", count: 1 }] },
        },
      },
    },
  },
  custom: {},
});

const target = (overrides: Partial<LabelTarget> = {}): LabelTarget => ({
  module: "visual",
  kind: "unmapped",
  size: "M",
  path: ["major"],
  label: "Torn cuff",
  ...overrides,
});

/* ------------------------------------------------------------------ *
 * Codes
 * ------------------------------------------------------------------ */

describe("codes", () => {
  it("turns what an admin types into a code", () => {
    expect(normaliseCode("  Torn Cuff ")).toBe("torn_cuff");
    expect(normaliseCode("pin-hole  near thumb")).toBe("pin_hole_near_thumb");
    expect(DefectCodeSchema.parse("Torn cuff")).toBe("torn_cuff");
  });

  it("refuses codes the database would refuse, in plain words", () => {
    const message = (value: string) => DefectCodeSchema.safeParse(value).error?.issues[0]?.message;
    expect(message("")).toBe("Enter a code.");
    expect(message("2nd_spot")).toBe("Start the code with a letter, e.g. torn_cuff.");
    expect(message("_spot")).toBe("Start the code with a letter, e.g. torn_cuff.");
    expect(message("stain!/!")).toBe("Use only lower case letters, digits and underscores: remove “!” “/”.");
    expect(message("a".repeat(65))).toBe("Keep the code to 64 characters or fewer.");
    expect(DefectCodeSchema.safeParse("thin_spot_2").success).toBe(true);
  });

  it("reads a new code's name on one line and an empty description as none", () => {
    const parsed = NewDefectCodeSchema.parse({ code: "torn_cuff", name: "  Torn \n cuff ", description: "  \n " });
    expect(parsed).toEqual({ code: "torn_cuff", name: "Torn cuff", description: null });
    const missing = NewDefectCodeSchema.safeParse({ code: "", name: "", description: "" });
    expect(fieldErrors(missing.error!)).toEqual({ code: "Enter a code.", name: "Enter a name." });
  });

  it("keeps an edit to the version it was opened on, as Postgres writes it", () => {
    expect(EditTargetSchema.safeParse({ code: "stain", version: "2026-10-06T01:02:03.123456+00:00" }).success).toBe(true);
    expect(EditTargetSchema.safeParse({ code: "stain", version: "" }).error?.issues[0]?.message).toBe(MESSAGES.stale);
    expect(EditTargetSchema.safeParse({ code: "Stain", version: "2026-10-06T01:02:03Z" }).success).toBe(false);
    expect(ActiveTargetSchema.parse({ code: "stain", active: "false" })).toEqual({ code: "stain", active: false });
    expect(ActiveTargetSchema.safeParse({ code: "stain", active: "no" }).success).toBe(false);
  });

  it("says why a new code was refused next to the code field", () => {
    expect(describeCodeInsertError("stain", { code: "23505" })).toEqual({
      field: "code",
      message: "There is already a code stain.",
    });
    expect(describeCodeInsertError("stain", { code: "42501" }).field).toBeUndefined();
    expect(describeCodeInsertError("stain", { code: "XX000" }).message).toBe("The code stain could not be added. Try again.");
  });
});

/* ------------------------------------------------------------------ *
 * Template labels
 * ------------------------------------------------------------------ */

describe("templateLabels", () => {
  it("reads STD_EG's visual defects per class, in report order, with their severity", () => {
    const labels = templateLabels(resolvedOf("STD_EG"))!;
    const visual = labels.labels.filter((label) => label.section === "visual");
    expect(visual[0]).toEqual({ section: "visual", defectClass: "critical", code: "embedded_insect", label: "Embedded Insects" });
    // One code, two severities in one template (BUILD_SPEC 4.2 rule 4).
    expect(visual.filter((label) => label.code === "bead_defective")).toEqual([
      { section: "visual", defectClass: "major", code: "bead_defective", label: "Defective bead" },
      { section: "visual", defectClass: "minor", code: "bead_defective", label: "Defective beads" },
    ]);
    expect(labels.classAql).toEqual({ critical: 0, major: 2.5, minor: 4 });
    expect(labels.classesOff).toEqual([]);
  });

  it("reads hole locations first and the Safedon dispensing defects last", () => {
    const labels = templateLabels(resolvedOf("SAFEDON_EG"))!;
    expect(labels.labels.map((label) => label.section)).toEqual(
      [...labels.labels.map((label) => label.section)].sort(
        (a, b) => ["watertight", "visual", "dispensing_safedon"].indexOf(a) - ["watertight", "visual", "dispensing_safedon"].indexOf(b),
      ),
    );
    expect(labels.labels.filter((label) => label.section === "watertight").map((label) => label.label)).toEqual([
      "Between fingers",
      "Palm",
      "Cuff",
      "Finger",
      "Glove burst",
      "Other :",
    ]);
    expect(labels.labels.find((label) => label.code === "stain")?.label).toBe("Stain");
    expect(labels.labels.filter((label) => label.section === "dispensing_safedon").map((label) => label.code)).toEqual([
      "no_cuff",
      "finger_out",
      "multiple_out",
      "stuck",
      "sticky",
      "faulty_cuff",
    ]);
  });

  it("leaves out modules and classes the template switches off", () => {
    const resolved = resolvedOf("STD_EG");
    for (const entry of resolved.modules) if (entry.key === "watertight") entry.include = false;
    const visual = resolved.modules.find((entry) => entry.key === "visual")!;
    (visual.config as { classes: Record<string, { include: boolean }> }).classes.minor.include = false;

    const labels = templateLabels(resolved)!;
    expect(labels.labels.some((label) => label.section === "watertight")).toBe(false);
    expect(labels.labels.some((label) => label.defectClass === "minor")).toBe(false);
    expect(labels.classesOff).toEqual(["minor"]);
  });

  it("falls back to the module's label for a code, most specific first, then the code", () => {
    const labels = templateLabels({
      modules: [
        {
          key: "visual",
          include: true,
          labels: { "minor.bead_defective": "Defective beads", bead_defective: "Defective bead" },
          config: {
            classes: {
              major: { include: true, aql: 2.5, defects: [{ code: "bead_defective" }, { code: "lump_big", label: " " }] },
              minor: { include: true, aql: 4, defects: [{ code: "bead_defective", label: "" }, "not an item", { label: "no code" }] },
            },
          },
        },
      ],
    })!;
    expect(labels.labels.map((label) => `${label.defectClass}:${label.label}`)).toEqual([
      "major:Defective bead",
      "major:lump_big",
      "minor:Defective beads",
    ]);
  });

  it("is null for anything that is not a resolved template", () => {
    expect(templateLabels(null)).toBeNull();
    expect(templateLabels({ code: "STD_EG" })).toBeNull();
    expect(templateLabels({ modules: [] })).toEqual({ labels: [], classesOff: [], classAql: {} });
  });
});

describe("template versions", () => {
  it("shows each template code once: its active version, else its newest", () => {
    const rows = [
      record("STD_EG", 1, "retired", null),
      record("STD_EG", 2, "active", null),
      record("STD_EG", 3, "draft", null),
      record("A_DRAFT", 1, "draft", null),
      record("A_DRAFT", 2, "draft", null),
      record("OLD", 1, "retired", null),
    ];
    expect(currentVersions(rows).map((row) => `${row.code} v${row.version}`)).toEqual(["A_DRAFT v2", "OLD v1", "STD_EG v2"]);
  });

  it("checks every label's code against the codes, and counts what needs attention", () => {
    const resolved = resolvedOf("STD_EG");
    const visual = resolved.modules.find((entry) => entry.key === "visual")!;
    const classes = (visual.config as { classes: Record<string, { defects: { code: string; label: string }[] }> }).classes;
    classes.major.defects = [...classes.major.defects, { code: "not_a_code", label: "Torn cuff" }];
    const codes = [...new Set(templateLabels(resolved)!.labels.map((label) => label.code))]
      .filter((value) => value !== "not_a_code")
      .map((value) => code(value, value !== "lump_big"));

    const [map] = buildLabelMaps([record("STD_EG", 1, "active", resolved)], codes);
    expect(map.resolved).toBe(true);
    expect(map.sections.map((section) => section.section)).toEqual(["watertight", "visual"]);
    const rows = map.sections.flatMap((section) => section.rows);
    expect(rows.find((row) => row.code === "not_a_code")).toMatchObject({ state: "unknown", codeName: null });
    expect(rows.find((row) => row.code === "lump_big")).toMatchObject({ state: "inactive", codeName: "lump big" });
    expect(rows.find((row) => row.code === "stain")).toMatchObject({ state: "ok", label: "Oil stain" });
    expect(map.attention).toBe(2);
  });

  it("shows a version that has not resolved without labels", () => {
    const [map] = buildLabelMaps([record("NEW", 1, "draft", null)], []);
    expect(map).toMatchObject({ resolved: false, sections: [], attention: 0 });
  });

  it("finds labels by wording, code, class or template, and drops templates with none left", () => {
    const maps = buildLabelMaps(
      [record("STD_EG", 1, "active", resolvedOf("STD_EG")), record("SAFEDON_EG", 1, "active", resolvedOf("SAFEDON_EG"))],
      [code("stain", true, "Stain")],
    );
    const total = labelCount(maps);
    expect(filterLabelMaps(maps, "  ")).toHaveLength(2);
    expect(labelCount(filterLabelMaps(maps, ""))).toBe(total);

    const stain = filterLabelMaps(maps, "stain");
    // "Oil stain", "Small dirt / stain" in STD_EG; "Stain", "Small dirt / stain" in SAFEDON_EG.
    expect(stain.map((map) => [map.code, map.sections.flatMap((section) => section.rows.map((row) => row.label))])).toEqual([
      ["SAFEDON_EG", ["Stain", "Small dirt / stain"]],
      ["STD_EG", ["Oil stain", "Small dirt / stain"]],
    ]);
    expect(labelCount(filterLabelMaps(maps, "safedon stain"))).toBe(2);
    expect(filterLabelMaps(maps, "glove_burst").map((map) => map.code)).toEqual(["SAFEDON_EG"]);
    expect(labelCount(filterLabelMaps(maps, "critical"))).toBe(4);
    expect(filterLabelMaps(maps, "nothing like this")).toEqual([]);
  });
});

describe("the code list", () => {
  const templates = [
    record("STD_EG", 1, "retired", resolvedOf("STD_EG")),
    record("STD_EG", 2, "active", { modules: [] }),
    record("SAFEDON_EG", 1, "active", resolvedOf("SAFEDON_EG")),
  ];

  it("names the templates whose current version maps a label to each code", () => {
    const items = buildCodeItems([code("stain"), code("lump_big"), code("torn_cuff"), code("zz_old", false)], templates);
    expect(items.map((item) => item.code)).toEqual(["lump_big", "stain", "torn_cuff", "zz_old"]);
    const byCode = new Map(items.map((item) => [item.code, item]));
    // STD_EG v2 lists nothing: only SAFEDON_EG uses stain now, but STD_EG v1 still mentions it.
    expect(byCode.get("stain")).toMatchObject({ usedBy: ["SAFEDON_EG"], inTemplates: ["SAFEDON_EG v1", "STD_EG v1"] });
    expect(byCode.get("lump_big")).toMatchObject({ usedBy: [], inTemplates: ["STD_EG v1"] });
    expect(byCode.get("torn_cuff")).toMatchObject({ usedBy: [], inTemplates: [] });
    expect(byCode.get("stain")?.updatedAt).toBe("2026-10-06T01:02:03.123456+00:00");
  });

  it("never deletes a code a template version mentions", () => {
    expect(deleteBlocker({ inTemplates: [] })).toBeNull();
    expect(deleteBlocker({ inTemplates: ["STD_EG v1"] })).toBe(
      "STD_EG v1 uses it, so it cannot be deleted. Deactivate it instead.",
    );
    expect(deleteBlocker({ inTemplates: ["SAFEDON_EG v1", "STD_EG v1"] })).toBe(
      "SAFEDON_EG v1 and STD_EG v1 use it, so it cannot be deleted. Deactivate it instead.",
    );
  });

  it("finds a code in a definition too, before the template resolves", () => {
    const draft: TemplateRecord = { ...record("NEW", 1, "draft", null), definition: { modules: [{ config: { x: ["torn_cuff"] } }] } };
    expect(templatesMentioning([draft], "torn_cuff")).toEqual(["NEW v1"]);
  });

  it("lists long lists short", () => {
    expect(listOf(["A"])).toBe("A");
    expect(listOf(["A", "B", "C"])).toBe("A, B and C");
    expect(listOf(["A", "B", "C", "D", "E", "F", "G"])).toBe("A, B, C, D, E and 2 more");
  });
});

describe("mentionsCode", () => {
  it("finds a code as a key or a value, at any depth, and only whole", () => {
    expect(mentionsCode({ sizes: { M: { major: { counts: { stain: 1 } } } } }, "stain")).toBe(true);
    expect(mentionsCode([{ code: "stain" }], "stain")).toBe(true);
    expect(mentionsCode({ label: "Oil stain", stains: 1, n: 3 }, "stain")).toBe(false);
    expect(mentionsCode(null, "stain")).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * One-off labels
 * ------------------------------------------------------------------ */

describe("findOneOffLabels", () => {
  it("finds visual one-off labels per size and class, with their counts", () => {
    expect(findOneOffLabels(visualData())).toEqual([
      { module: "visual", kind: "unmapped", size: "M", path: ["major"], hand: null, defectClass: "major", label: "Torn cuff", count: 2 },
      { module: "visual", kind: "unmapped", size: "M", path: ["minor"], hand: null, defectClass: "minor", label: "Sticky edge", count: 1 },
    ]);
  });

  it("follows the hand split, whichever of hand and class comes first", () => {
    const data = {
      modules: {
        visual: {
          sizes: {
            "7.0": {
              major: { inspected: 32 },
              R: { major: { counts: {}, unmapped: [{ label: "Torn cuff", count: 1 }] } },
              minor: { L: { counts: {}, unmapped: [{ label: "Pinhole", count: 2 }] } },
            },
          },
        },
      },
    };
    expect(findOneOffLabels(data).map((label) => [label.path.join("/"), label.hand, label.defectClass, label.label])).toEqual([
      ["R/major", "R", "major", "Torn cuff"],
      ["minor/L", "L", "minor", "Pinhole"],
    ]);
  });

  it("adds up one label entered twice, and marks a count that is not a whole number", () => {
    const data = {
      modules: {
        visual: {
          sizes: {
            M: {
              major: {
                unmapped: [
                  { label: "Torn cuff", count: 1 },
                  { label: "torn cuff", count: 1 },
                  { label: "Torn  cuff", count: 2 },
                  { label: "Blister", count: "2 42" },
                  { label: "Blister", count: 1 },
                  { label: "   ", count: 4 },
                  { label: "Gap", count: null },
                  "not an entry",
                  { count: 3 },
                ],
              },
            },
          },
        },
      },
    };
    expect(findOneOffLabels(data).map((label) => [label.label, label.count])).toEqual([
      ["Blister", null],
      ["Gap", 0],
      ["torn cuff", 1],
      ["Torn cuff", 3],
    ]);
  });

  it("finds watertight one-off labels and the Other : row, per hand", () => {
    const data = {
      modules: {
        watertight: {
          sizes: {
            M: { tested: 80, holes: { hole_palm: 1, hole_other: 2 }, otherDescription: "Thumb tip", unmapped: [] },
            "7.5": {
              tested: 50,
              R: { holes: {}, otherDescription: " ", unmapped: [{ label: "Seam leak", count: 1 }] },
              L: { otherDescription: "Wrist" },
            },
          },
        },
      },
    };
    expect(findOneOffLabels(data)).toEqual([
      { module: "watertight", kind: "other", size: "M", path: [], hand: null, defectClass: null, label: "Thumb tip", count: 2 },
      { module: "watertight", kind: "unmapped", size: "7.5", path: ["R"], hand: "R", defectClass: null, label: "Seam leak", count: 1 },
      { module: "watertight", kind: "other", size: "7.5", path: ["L"], hand: "L", defectClass: null, label: "Wrist", count: 0 },
    ]);
  });

  it("lists watertight before visual, sizes in size order", () => {
    const data = {
      modules: {
        visual: { sizes: { XL: { major: { unmapped: [{ label: "B", count: 1 }] } }, S: { major: { unmapped: [{ label: "A", count: 1 }] } } } },
        watertight: { sizes: { L: { unmapped: [{ label: "C", count: 1 }] } } },
      },
    };
    expect(findOneOffLabels(data).map((label) => `${label.module} ${label.size} ${label.label}`)).toEqual([
      "watertight L C",
      "visual S A",
      "visual XL B",
    ]);
  });

  it("ignores data in other shapes and keys that lead out of the data", () => {
    const hostile = JSON.parse('{"modules":{"visual":{"sizes":{"__proto__":{"major":{"unmapped":[{"label":"X","count":1}]}}}}}}');
    expect(findOneOffLabels(hostile)).toEqual([]);
    expect(findOneOffLabels(null)).toEqual([]);
    expect(findOneOffLabels({ modules: { visual: { sizes: [] } } })).toEqual([]);
    expect(findOneOffLabels({ modules: { visual: { unmapped: [{ label: "No size", count: 1 }] } } })).toEqual([]);
    expect(findOneOffLabels({ modules: { dimensions: { sizes: { M: { unmapped: [{ label: "X", count: 1 }] } } } } })).toEqual([]);
    // Deeper than size, hand, class and one grouping key.
    const deep = { modules: { visual: { sizes: { M: { a: { b: { c: { d: { unmapped: [{ label: "X", count: 1 }] } } } } } } } } };
    expect(findOneOffLabels(deep)).toEqual([]);
    const grouped = { modules: { visual: { sizes: { M: { R: { classes: { major: { unmapped: [{ label: "X", count: 1 }] } } } } } } } };
    expect(findOneOffLabels(grouped).map((label) => [label.path.join("/"), label.hand, label.defectClass])).toEqual([
      ["R/classes/major", "R", "major"],
    ]);
  });

  it("says where a label is, in words", () => {
    const [major] = findOneOffLabels(visualData());
    expect(whereLabel(major)).toBe("Visual · Major");
    expect(sizeLabel(major)).toBe("Size M");
    expect(countLabel(major)).toBe("2 found");
    expect(whereLabel({ module: "watertight", kind: "other", defectClass: null })).toBe("Watertight · Other");
    expect(sizeLabel({ size: "7.0", hand: "L" })).toBe("Size 7.0 · Left hand");
    expect(countLabel({ module: "watertight", count: 1 })).toBe("1 hole");
    expect(countLabel({ module: "watertight", count: 3 })).toBe("3 holes");
    expect(countLabel({ module: "visual", count: null })).toBe("Count unreadable");
  });
});

describe("mapOneOffLabel", () => {
  it("moves a visual label's count to the code, in the same size and class", () => {
    const data = visualData();
    const before = JSON.stringify(data);
    const outcome = mapOneOffLabel(data, target(), "stain");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const major = (outcome.data as ReturnType<typeof visualData>).modules.visual.sizes.M.major;
    expect(major.counts).toEqual({ stain: 3 });
    expect(major.unmapped).toEqual([]);
    expect(outcome.change).toEqual({
      module: "visual",
      kind: "unmapped",
      size: "M",
      hand: null,
      defectClass: "major",
      label: "Torn cuff",
      count: 2,
      code: "stain",
    });
    // Pure: the input is untouched, and everything else is kept, the comment too.
    expect(JSON.stringify(data)).toBe(before);
    expect((outcome.data as ReturnType<typeof visualData>).modules.visual.comment).toBe("Looked fine overall.");
    expect((outcome.data as ReturnType<typeof visualData>).modules.visual.sizes.M.minor.unmapped).toHaveLength(1);
  });

  it("adds a code the count map does not have yet, creating the map when missing", () => {
    const data = visualData();
    delete (data.modules.visual.sizes.M.minor as { counts?: unknown }).counts;
    const outcome = mapOneOffLabel(data, target({ path: ["minor"], label: "Sticky edge" }), "sticky_pleats");
    expect(outcome.ok && (outcome.data as typeof data).modules.visual.sizes.M.minor).toEqual({
      inspected: 80,
      counts: { sticky_pleats: 1 },
      unmapped: [],
    });
  });

  it("takes every entry of the label at once, and leaves other labels", () => {
    const data = {
      modules: {
        visual: {
          sizes: {
            M: {
              major: {
                counts: { thin_spot: null },
                unmapped: [
                  { label: "Torn cuff", count: 1 },
                  { label: "Blister", count: 1 },
                  { label: " Torn  cuff", count: 2 },
                ],
              },
            },
          },
        },
      },
    };
    const outcome = mapOneOffLabel(data, target(), "thin_spot");
    expect(outcome.ok && outcome.data.modules).toEqual({
      visual: { sizes: { M: { major: { counts: { thin_spot: 3 }, unmapped: [{ label: "Blister", count: 1 }] } } } },
    });
  });

  it("removes a label counted 0 without touching the counts", () => {
    const data = { modules: { visual: { sizes: { M: { major: { unmapped: [{ label: "Gap", count: 0 }] } } } } } };
    const outcome = mapOneOffLabel(data, target({ label: "Gap" }), "stain");
    expect(outcome.ok && outcome.data.modules).toEqual({ visual: { sizes: { M: { major: { unmapped: [] } } } } });
  });

  it("follows the hand split path", () => {
    const data = {
      modules: { visual: { sizes: { "7.0": { R: { major: { counts: {}, unmapped: [{ label: "Torn cuff", count: 1 }] } } } } } },
    };
    const outcome = mapOneOffLabel(data, target({ size: "7.0", path: ["R", "major"] }), "faulty_cuff");
    expect(outcome.ok && outcome.change).toMatchObject({ hand: "R", defectClass: "major", count: 1 });
    expect(outcome.ok && outcome.data.modules).toEqual({
      visual: { sizes: { "7.0": { R: { major: { counts: { faulty_cuff: 1 }, unmapped: [] } } } } },
    });
  });

  it("moves a watertight one-off label into the holes", () => {
    const data = { modules: { watertight: { sizes: { M: { tested: 80, holes: { hole_palm: 1 }, unmapped: [{ label: "Seam", count: 1 }] } } } } };
    const outcome = mapOneOffLabel(data, target({ module: "watertight", path: [], label: "Seam" }), "hole_cuff");
    expect(outcome.ok && outcome.data.modules).toEqual({
      watertight: { sizes: { M: { tested: 80, holes: { hole_palm: 1, hole_cuff: 1 }, unmapped: [] } } },
    });
  });

  it("moves an Other : hole to the code and clears its description", () => {
    const data = {
      modules: { watertight: { sizes: { M: { tested: 80, holes: { hole_other: 2, hole_finger: 1 }, otherDescription: "Thumb tip" } } } },
    };
    const outcome = mapOneOffLabel(data, target({ module: "watertight", kind: "other", path: [], label: "Thumb tip" }), "hole_finger");
    expect(outcome.ok && outcome.data.modules).toEqual({
      watertight: { sizes: { M: { tested: 80, holes: { hole_other: 0, hole_finger: 3 }, otherDescription: null } } },
    });
    expect(outcome.ok && outcome.change).toMatchObject({ kind: "other", count: 2, code: "hole_finger" });
  });

  it("clears an Other : description with nothing counted", () => {
    const data = { modules: { watertight: { sizes: { M: { otherDescription: "Wrist" } } } } };
    const outcome = mapOneOffLabel(data, target({ module: "watertight", kind: "other", path: [], label: "Wrist" }), "hole_cuff");
    expect(outcome.ok && outcome.data.modules).toEqual({ watertight: { sizes: { M: { otherDescription: null } } } });
  });

  it("refuses what it cannot do safely", () => {
    const problem = (data: unknown, to: LabelTarget, code = "stain") => {
      const outcome = mapOneOffLabel(data, to, code);
      return outcome.ok ? "ok" : outcome.problem;
    };
    expect(problem(visualData(), target({ label: "Gone" }))).toBe("not_found");
    expect(problem(visualData(), target({ path: ["critical"] }))).toBe("not_found");
    expect(problem(visualData(), target({ size: "XL" }))).toBe("not_found");
    expect(problem({ modules: {} }, target())).toBe("not_found");
    expect(problem("text", target())).toBe("invalid_data");

    const badCount = { modules: { visual: { sizes: { M: { major: { unmapped: [{ label: "Torn cuff", count: 1.5 }] } } } } } };
    expect(problem(badCount, target())).toBe("invalid_count");
    const badExisting = {
      modules: { visual: { sizes: { M: { major: { counts: { stain: "2 42" }, unmapped: [{ label: "Torn cuff", count: 1 }] } } } } },
    };
    expect(problem(badExisting, target())).toBe("invalid_count");
    const badMap = { modules: { visual: { sizes: { M: { major: { counts: [1], unmapped: [{ label: "Torn cuff", count: 1 }] } } } } } };
    expect(problem(badMap, target())).toBe("invalid_data");

    const other = { modules: { watertight: { sizes: { M: { holes: { hole_other: 1 }, otherDescription: "Thumb" } } } } };
    const otherTarget = target({ module: "watertight", kind: "other", path: [], label: "Thumb" });
    expect(problem(other, otherTarget, "hole_other")).toBe("same_code");
    expect(problem(other, { ...otherTarget, label: "Wrist" })).toBe("not_found");
    expect(problem({ modules: { watertight: { sizes: { M: { holes: 3, otherDescription: "Thumb" } } } } }, otherTarget)).toBe(
      "invalid_data",
    );
    expect(problem({ modules: { watertight: { sizes: { M: { holes: { hole_other: -1 }, otherDescription: "Thumb" } } } } }, otherTarget)).toBe(
      "invalid_count",
    );
  });

  it("explains each problem in words", () => {
    expect(describeMappingProblem("not_found", "INS-2026-0042")).toBe(
      "This label is no longer on INS-2026-0042: someone has mapped or changed it. Reload the page.",
    );
    expect(describeMappingProblem("same_code", "INS-2026-0042")).toMatch(/already counted as Hole, other location/);
  });
});

describe("label targets from the page", () => {
  it("accepts what findOneOffLabels finds", () => {
    for (const found of findOneOffLabels(visualData())) {
      const { module, kind, size, path, label } = found;
      expect(LabelTargetSchema.safeParse({ module, kind, size, path, label }).success).toBe(true);
    }
  });

  it("refuses paths that lead out of the data, too deep, or an Other : row outside watertight", () => {
    const parse = (overrides: Record<string, unknown>) => LabelTargetSchema.safeParse({ ...target(), ...overrides }).success;
    expect(parse({ path: ["__proto__"] })).toBe(false);
    expect(parse({ size: "constructor" })).toBe(false);
    expect(parse({ path: ["a", "b", "c", "d"] })).toBe(false);
    expect(parse({ path: ["R", "classes", "major"] })).toBe(true);
    expect(parse({ kind: "other" })).toBe(false);
    expect(parse({ label: "  " })).toBe(false);
    expect(parse({ module: "dimensions" })).toBe(false);
  });

  it("reads the form's target, and calls a broken one out of date", () => {
    const inspectionId = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    const parsed = MapTargetSchema.safeParse({ inspectionId, target: JSON.stringify({ ...target(), label: " Torn  cuff " }) });
    expect(parsed.success && parsed.data.target.label).toBe("Torn cuff");
    const broken = MapTargetSchema.safeParse({ inspectionId, target: "{not json" });
    expect(broken.error?.issues[0]?.message).toBe(MESSAGES.stale);
    expect(MapTargetSchema.safeParse({ inspectionId: "nope", target: JSON.stringify(target()) }).success).toBe(false);
  });

  it("reads the choice of an existing code or a new one", () => {
    expect(MapChoiceSchema.parse({ mode: "existing", code: "stain" })).toEqual({ mode: "existing", code: "stain" });
    expect(MapChoiceSchema.parse({ mode: "new", newCode: "Torn cuff", name: "Torn cuff", description: "" })).toEqual({
      mode: "new",
      newCode: "torn_cuff",
      name: "Torn cuff",
      description: null,
    });
    const noCode = MapChoiceSchema.safeParse({ mode: "existing", code: "" });
    expect(fieldErrors(noCode.error!)).toEqual({ code: "Choose a code." });
    const badNew = MapChoiceSchema.safeParse({ mode: "new", newCode: "9", name: "", description: "" });
    expect(Object.keys(fieldErrors(badNew.error!))).toEqual(["newCode", "name"]);
    expect(MapChoiceSchema.safeParse({ mode: "other" }).success).toBe(false);
  });
});

describe("buildInspectionLabels", () => {
  const templates = [record("STD_EG", 1, "active", resolvedOf("STD_EG"), "template-1")];
  const codes = [
    code("stain", true, "Stain"),
    code("faulty_cuff", true, "Faulty cuff"),
    code("hole_cuff", true, "Hole in cuff"),
    code("old_cuff", false, "Old cuff"),
    code("torn_cuff", true, "Torn cuff"),
  ];
  const row = (
    id: string,
    status: InspectionQueryRow["status"],
    visual: unknown,
    watertight: unknown = null,
  ): InspectionQueryRow => ({
    id,
    ref_no: `INS-2026-${id}`,
    status,
    inspection_date: "2026-10-06",
    template_id: "template-1",
    inspector: { full_name: " ", email: "inspector@test.local" },
    visual,
    watertight,
  });

  it("lists inspections with one-off labels, the ones that can be mapped first", () => {
    const rows = [
      row("0003", "draft", visualData().modules.visual),
      row("0002", "submitted", { sizes: {} }),
      row("0001", "submitted", visualData().modules.visual),
      row("0000", "reopened", null, { sizes: { M: { otherDescription: "Thumb", holes: { hole_other: 1 } } } }),
    ];
    const built = buildInspectionLabels(rows, { codes, templates });
    expect(built.map((inspection) => [inspection.refNo, inspection.status])).toEqual([
      ["INS-2026-0001", "submitted"],
      ["INS-2026-0000", "reopened"],
      ["INS-2026-0003", "draft"],
    ]);
    expect(built[0]).toMatchObject({
      id: "0001",
      inspectionDate: "2026-10-06",
      inspector: "inspector@test.local",
      template: { id: "template-1", code: "STD_EG", version: 1 },
    });
  });

  it("suggests active codes for each label, and a free code to add it as", () => {
    const [inspection] = buildInspectionLabels([row("0001", "submitted", visualData().modules.visual)], { codes, templates });
    const tornCuff = inspection.labels.find((label) => label.label === "Torn cuff")!;
    // Never the inactive old_cuff; torn_cuff shares both words, so it comes first.
    expect(tornCuff.suggestions).toEqual(["torn_cuff", "faulty_cuff", "hole_cuff"]);
    // torn_cuff is taken, so the new code gets a number.
    expect(tornCuff.newCode).toBe("torn_cuff_2");
    expect(tornCuff.id).toBe("0001|visual|unmapped|M|major|Torn cuff");
  });

  it("keeps an inspection whose template is gone, without one", () => {
    const [inspection] = buildInspectionLabels([row("0001", "submitted", visualData().modules.visual)], {
      codes,
      templates: [],
    });
    expect(inspection.template).toBeNull();
    expect(inspection.labels).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ *
 * Choosing a code
 * ------------------------------------------------------------------ */

describe("suggestCodes", () => {
  const codes = [
    { code: "stain", name: "Stain", description: 'Visual. Report labels: "Oil stain" (STD_EG), "Stain" (SAFEDON_EG).' },
    { code: "dirt_small", name: "Small dirt or stain", description: null },
    { code: "bead_defective", name: "Defective bead", description: null },
    { code: "bead_poor", name: "Poor beading", description: null },
    { code: "faulty_cuff", name: "Faulty cuff", description: null },
    { code: "hole_cuff", name: "Hole in cuff", description: null },
  ];

  it("puts the codes sharing the most words first", () => {
    expect(suggestCodes("Oil stain on palm", codes)).toEqual(["stain", "dirt_small"]);
    expect(suggestCodes("Defective beads", codes)).toEqual(["bead_defective", "bead_poor"]);
  });

  it("prefers the codes the template lists in the same place when the words tie", () => {
    expect(suggestCodes("Torn cuff", codes)).toEqual(["faulty_cuff", "hole_cuff"]);
    expect(suggestCodes("Torn cuff", codes, { preferred: ["hole_cuff"] })).toEqual(["hole_cuff", "faulty_cuff"]);
  });

  it("reads the labels templates give a code", () => {
    expect(suggestCodes("Ring shaped", codes)).toEqual([]);
    const wording = new Map([["bead_poor", ["Ring-shaped bead"]]]);
    expect(suggestCodes("Ring shaped", codes, { wording })).toEqual(["bead_poor"]);
  });

  it("suggests nothing for a label without telling words", () => {
    expect(suggestCodes("Other", codes)).toEqual([]);
    expect(suggestCodes("x", codes)).toEqual([]);
    expect(suggestCodes("Glove stain", codes, { limit: 1 })).toEqual(["stain"]);
  });
});

describe("suggestNewCode", () => {
  it("writes the label in snake case", () => {
    expect(suggestNewCode("Torn cuff", "visual", new Set())).toBe("torn_cuff");
    expect(suggestNewCode("Lumps (>3 mm)", "visual", new Set())).toBe("lumps_3_mm");
    expect(suggestNewCode("Défaut sévère", "visual", new Set())).toBe("defaut_severe");
  });

  it("starts with a letter, and with hole_ for the watertight test", () => {
    expect(suggestNewCode("3 mm tear", "visual", new Set())).toBe("defect_3_mm_tear");
    expect(suggestNewCode("Thumb tip", "watertight", new Set())).toBe("hole_thumb_tip");
    expect(suggestNewCode("Hole at thumb", "watertight", new Set())).toBe("hole_at_thumb");
    expect(suggestNewCode("!!!", "visual", new Set())).toBe("defect");
  });

  it("numbers a code that is taken, and stays within 64 characters", () => {
    expect(suggestNewCode("Torn cuff", "visual", new Set(["torn_cuff", "torn_cuff_2"]))).toBe("torn_cuff_3");
    const long = suggestNewCode("word ".repeat(30), "visual", new Set());
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long).toMatch(/^[a-z][a-z0-9_]*[a-z0-9]$/);
    const taken = suggestNewCode("word ".repeat(30), "visual", new Set([long]));
    expect(taken.length).toBeLessThanOrEqual(64);
    expect(taken.endsWith("_2")).toBe(true);
    expect(DefectCodeSchema.safeParse(taken).success).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Small pieces
 * ------------------------------------------------------------------ */

describe("helpers", () => {
  it("reads counts: blank is 0, anything but a whole number is not a count", () => {
    expect([readCount(null), readCount(undefined), readCount(0), readCount(7)]).toEqual([0, 0, 0, 7]);
    expect([readCount(-1), readCount(1.5), readCount("2"), readCount(Number.NaN)]).toEqual([null, null, null, null]);
  });

  it("searches by every word, underscores as spaces", () => {
    const text = searchText("thin_spot", "Thin spot on glove body", null);
    expect(matchesSearch(text, "THIN spot")).toBe(true);
    expect(matchesSearch(text, "body thin")).toBe(true);
    expect(matchesSearch(text, "thin_spot")).toBe(true);
    expect(matchesSearch(text, "stain")).toBe(false);
    expect(matchesSearch(text, "  ")).toBe(true);
  });

  it("reads the add panel's values from a link, and ignores anything that is not a code", () => {
    expect(addPrefill({ add: "torn_cuff", name: "  Torn \n cuff " })).toEqual({ code: "torn_cuff", name: "Torn cuff" });
    expect(addPrefill({ add: ["Torn Cuff", "x"] })).toEqual({ code: "torn_cuff", name: "" });
    expect(addPrefill({ add: "9 lives" })).toBeNull();
    expect(addPrefill({ name: "Torn cuff" })).toBeNull();
    expect(addPrefill({ add: "x", name: "n".repeat(500) })?.name).toHaveLength(120);
  });

  it("links to the template editor, the inspection and a filled-in add panel", () => {
    expect(templateEditorHref("abc")).toBe("/admin/templates/abc");
    expect(inspectionHref("abc", "submitted")).toBe("/inspections/abc/review");
    expect(inspectionHref("abc", "draft")).toBe("/inspections/abc");
    expect(addCodeHref("torn_cuff", "Torn cuff & tear")).toBe("/admin/defects?add=torn_cuff&name=Torn+cuff+%26+tear");
  });

  it("maps submitted inspections only: drafts and reopened ones are still the inspector's", () => {
    expect([canMap("submitted"), canMap("draft"), canMap("reopened"), canMap("approved")]).toEqual([true, false, false, false]);
  });

  it("counts the labels an admin can map now: not Other : holes, which have a code, nor a draft's", () => {
    const inspection = (status: InspectionLabels["status"], kinds: ("unmapped" | "other")[]) =>
      ({ status, labels: kinds.map((kind) => ({ kind })) }) as unknown as InspectionLabels;
    const inspections = [
      inspection("submitted", ["unmapped", "other"]),
      inspection("submitted", ["unmapped", "unmapped"]),
      inspection("draft", ["unmapped"]),
      inspection("reopened", ["unmapped"]),
    ];
    expect(countUnmapped(inspections)).toBe(3);
    expect(
      defectsCounts({ codes: [code("stain")], templates: [record("X", 1, "active", { modules: [] })], inspections }),
    ).toEqual({ codes: 1, attention: 0, unmapped: 3 });
  });
});
